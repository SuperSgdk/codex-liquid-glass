const MAIN_URL = /^app:\/\/-\/index\.html(?:\?[^#]*)?$/;

export function validatePort(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Port must be an integer between 1 and 65535.');
  }
  return port;
}

export function selectMainTarget(targets, port) {
  validatePort(port);
  if (!Array.isArray(targets)) throw new Error('The debugger returned an invalid target list.');
  const matches = targets.filter(target => target?.type === 'page' && typeof target.url === 'string' && MAIN_URL.test(target.url));
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one Codex main renderer, found ${matches.length}. Close extra Codex windows normally and inspect again.`);
  }
  const target = matches[0];
  if (typeof target.id !== 'string' || !target.id) throw new Error('The Codex target has no id.');
  let socketUrl;
  try { socketUrl = new URL(target.webSocketDebuggerUrl); }
  catch { throw new Error('The Codex target has no valid debugger WebSocket URL.'); }
  if (socketUrl.protocol !== 'ws:' || socketUrl.hostname !== '127.0.0.1' || Number(socketUrl.port) !== port || socketUrl.username || socketUrl.password || socketUrl.hash || socketUrl.search || !/^\/devtools\/page\/[^/]+$/.test(socketUrl.pathname)) {
    throw new Error('Refusing a debugger endpoint outside the requested loopback port.');
  }
  // Query parameters can contain conversation or workspace routes. Keep only
  // the renderer location in any downstream diagnostics.
  const publicUrl = new URL(target.url);
  publicUrl.search = '';
  publicUrl.hash = '';
  return { id: target.id, url: publicUrl.href, webSocketDebuggerUrl: socketUrl.href };
}

export async function findMainTarget({ port = 9223, timeoutMs = 5000 } = {}) {
  validatePort(port);
  let response;
  try {
    response = await fetch(`http://127.0.0.1:${port}/json/list`, { redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new Error(`No usable debugger on 127.0.0.1:${port}. A normal Codex exit and explicit debug launch is required; this command never launches or restarts the app.`);
  }
  if (!response.ok) throw new Error(`Debugger discovery returned HTTP ${response.status}.`);
  return selectMainTarget(await response.json(), port);
}

export class CdpClient {
  #socket;
  #pending = new Map();
  #nextId = 1;
  #timeoutMs;
  #closed = false;

  constructor(socket, timeoutMs) {
    this.#socket = socket;
    this.#timeoutMs = timeoutMs;
    socket.addEventListener('message', event => this.#receive(event.data));
    socket.addEventListener('close', () => this.#rejectPending('Debugger connection closed.'));
    socket.addEventListener('error', () => this.#rejectPending('Debugger connection failed.'));
  }

  static async connect(url, { timeoutMs = 5000 } = {}) {
    if (typeof WebSocket !== 'function') throw new Error('Node.js 22 or newer is required for the native WebSocket client.');
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const finish = (error) => {
        clearTimeout(timer);
        socket.removeEventListener('open', onOpen);
        socket.removeEventListener('error', onError);
        socket.removeEventListener('close', onClose);
        if (error) { socket.close(); reject(error); }
        else resolve();
      };
      const onOpen = () => finish();
      const onError = () => finish(new Error('Unable to connect to the Codex debugger.'));
      const onClose = () => finish(new Error('The Codex debugger closed before connection.'));
      const timer = setTimeout(() => finish(new Error('Timed out connecting to the Codex debugger.')), timeoutMs);
      socket.addEventListener('open', onOpen, { once: true });
      socket.addEventListener('error', onError, { once: true });
      socket.addEventListener('close', onClose, { once: true });
    });
    return new CdpClient(socket, timeoutMs);
  }

  #receive(data) {
    let message;
    try { message = JSON.parse(data); } catch { return; }
    const pending = this.#pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.#pending.delete(message.id);
    if (message.error) pending.reject(new Error(`CDP ${pending.method} failed: ${message.error.message ?? message.error.code}`));
    else pending.resolve(message.result);
  }

  #rejectPending(message) {
    this.#closed = true;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      const error = new Error(`${message} The outcome of ${pending.method} may be unknown.`);
      error.outcomeUnknown = pending.sent;
      pending.reject(error);
    }
    this.#pending.clear();
  }

  send(method, params = {}) {
    if (this.#closed || this.#socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('The debugger connection is not open.'));
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const pending = { method, resolve, reject, sent: false, timer: null };
      pending.timer = setTimeout(() => {
        this.#pending.delete(id);
        const error = new Error(`CDP ${method} timed out. Its outcome may be unknown; do not blindly retry.`);
        error.outcomeUnknown = pending.sent;
        reject(error);
      }, this.#timeoutMs);
      this.#pending.set(id, pending);
      try {
        this.#socket.send(JSON.stringify({ id, method, params }));
        pending.sent = true;
      } catch (error) {
        clearTimeout(pending.timer);
        this.#pending.delete(id);
        reject(error);
      }
    });
  }

  async evaluate(expression) {
    const response = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: false });
    if (response?.exceptionDetails) {
      throw new Error(`Skin evaluation failed: ${response.exceptionDetails.exception?.description ?? response.exceptionDetails.text ?? 'JavaScript exception'}`);
    }
    if (response?.result?.unserializableValue) throw new Error('Skin status was not a serializable value.');
    return response?.result?.value;
  }

  close() {
    if (!this.#closed) this.#rejectPending('Debugger client closed.');
    // An error event may have rejected commands before the transport closes.
    if (this.#socket.readyState === WebSocket.OPEN || this.#socket.readyState === WebSocket.CONNECTING) {
      this.#socket.close();
    }
  }
}
