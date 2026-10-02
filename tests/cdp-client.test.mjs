import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { CdpClient, findMainTarget, selectMainTarget } from '../scripts/cdp-client.mjs';

// A disposable protocol peer on its own ephemeral port. It never evaluates
// expressions and does not connect to, start, or inspect a real Codex process.
async function makeDebuggerFixture(onCommand = () => {}) {
  const sockets = new Set();
  const commands = [];
  const waiters = new Set();
  let targets = [];
  const server = createServer((request, response) => {
    if (request.url !== '/json/list') { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(targets));
  });
  server.on('connection', socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  server.on('upgrade', (request, socket, head) => {
    if (request.url !== '/devtools/page/FIXTURE_MAIN') { socket.destroy(); return; }
    const accept = createHash('sha1').update(`${request.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const sendFrame = (payload, opcode = 1) => {
      const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
      const header = Buffer.alloc(data.length < 126 ? 2 : 4);
      header[0] = 0x80 | opcode;
      header[1] = data.length < 126 ? data.length : 126;
      if (data.length >= 126) header.writeUInt16BE(data.length, 2);
      socket.write(Buffer.concat([header, data]));
    };
    const send = message => sendFrame(JSON.stringify(message));
    let buffer = head;
    const consume = chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 2) {
        const opcode = buffer[0] & 0x0f;
        let length = buffer[1] & 0x7f;
        const masked = Boolean(buffer[1] & 0x80);
        let position = 2;
        if (length === 126) {
          if (buffer.length < 4) return;
          length = buffer.readUInt16BE(2);
          position = 4;
        } else if (length === 127) {
          if (buffer.length < 10) return;
          length = Number(buffer.readBigUInt64BE(2));
          position = 10;
        }
        if (length > 1024 * 1024) { socket.destroy(); return; }
        const payloadStart = position + (masked ? 4 : 0);
        if (buffer.length < payloadStart + length) return;
        const payload = Buffer.from(buffer.subarray(payloadStart, payloadStart + length));
        if (masked) {
          const mask = buffer.subarray(position, position + 4);
          for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
        }
        buffer = buffer.subarray(payloadStart + length);
        if (opcode === 8) { sendFrame(payload, 8); socket.end(); return; }
        if (opcode === 9) { sendFrame(payload, 10); continue; }
        if (opcode !== 1) continue;
        const command = JSON.parse(payload.toString());
        commands.push(command);
        for (const waiter of waiters) {
          if (commands.length >= waiter.count) {
            clearTimeout(waiter.timer);
            waiters.delete(waiter);
            waiter.resolve();
          }
        }
        onCommand(command, send, commands);
      }
    };
    socket.on('data', consume);
    consume(Buffer.alloc(0));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const mainTarget = {
    id: 'FIXTURE_MAIN', type: 'page', url: 'app://-/index.html?initialRoute=%2F',
    webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/FIXTURE_MAIN`,
  };
  targets = [mainTarget];
  return {
    port, mainTarget, commands,
    setTargets(value) { targets = value; },
    waitForCommands(count) {
      if (commands.length >= count) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const waiter = { count, resolve, timer: null };
        waiter.timer = setTimeout(() => { waiters.delete(waiter); reject(new Error('Fixture did not receive the expected commands.')); }, 1000);
        waiters.add(waiter);
      });
    },
    async dispose() {
      for (const waiter of waiters) clearTimeout(waiter.timer);
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => server.close(resolve));
    },
  };
}

test('HTTP discovery selects the native main page while ignoring browser, iframe and auxiliary windows', async t => {
  const fixture = await makeDebuggerFixture();
  t.after(() => fixture.dispose());
  fixture.setTargets([
    { ...fixture.mainTarget, id: 'WEB', url: 'http://127.0.0.1:4785/' },
    { ...fixture.mainTarget, id: 'IFRAME', type: 'iframe' },
    { ...fixture.mainTarget, id: 'WORKER', type: 'worker' },
    { ...fixture.mainTarget, id: 'DETACHED', url: 'app://-/detached-window.html' },
    { ...fixture.mainTarget, id: 'PET', url: 'app://-/avatar-overlay.html' },
    fixture.mainTarget,
  ]);
  const selected = await findMainTarget({ port: fixture.port });
  assert.equal(selected.id, 'FIXTURE_MAIN');
  assert.equal(selected.url, 'app://-/index.html', 'Discovery must not expose private renderer routes.');
  assert.equal(selected.webSocketDebuggerUrl, fixture.mainTarget.webSocketDebuggerUrl);
  assert.deepEqual(Object.keys(selected).sort(), ['id', 'url', 'webSocketDebuggerUrl']);
  assert.equal(fixture.commands.length, 0, 'Discovery must not send renderer commands.');
  fixture.setTargets([fixture.mainTarget, { ...fixture.mainTarget, id: 'SECOND_MAIN' }]);
  await assert.rejects(findMainTarget({ port: fixture.port }), /exactly one Codex main renderer, found 2/);
  fixture.setTargets([{ ...fixture.mainTarget, type: 'iframe' }]);
  await assert.rejects(findMainTarget({ port: fixture.port }), /found 0/);
});

test('target selection refuses other origins, ports and debugger channels even when the page URL looks native', () => {
  const target = { id: 'MAIN', type: 'page', url: 'app://-/index.html', webSocketDebuggerUrl: 'ws://127.0.0.1:9223/devtools/page/MAIN' };
  const unsafeEndpoints = [
    'ws://localhost:9223/devtools/page/MAIN',
    'ws://192.168.1.2:9223/devtools/page/MAIN',
    'ws://[::1]:9223/devtools/page/MAIN',
    'ws://127.0.0.1:9224/devtools/page/MAIN',
    'wss://127.0.0.1:9223/devtools/page/MAIN',
    'ws://user:pass@127.0.0.1:9223/devtools/page/MAIN',
    'ws://127.0.0.1:9223/devtools/browser/MAIN',
    'ws://127.0.0.1:9223/devtools/page/MAIN?other=1',
    'ws://127.0.0.1:9223/devtools/page/MAIN#fragment',
  ];
  for (const endpoint of unsafeEndpoints) {
    assert.throws(() => selectMainTarget([{ ...target, webSocketDebuggerUrl: endpoint }], 9223), /Refusing/, endpoint);
  }
  for (const url of ['https://example.com/', 'app://other/index.html', 'app://-/index.html#other', 'app://-/detached-window.html']) {
    assert.throws(() => selectMainTarget([{ ...target, url }], 9223), /found 0/, url);
  }
});

test('native WebSocket protocol correlates reversed responses and ignores unrelated events', async t => {
  const fixture = await makeDebuggerFixture((command, send, commands) => {
    if (commands.length !== 2) return;
    send({ method: 'Runtime.executionContextCreated', params: { fixtureOnly: true } });
    send({ id: 99999, result: { fixtureOnly: 'unrelated response' } });
    for (const pending of [...commands].reverse()) {
      send({ id: pending.id, result: { result: { value: { fixtureExpression: pending.params.expression } } } });
    }
  });
  t.after(() => fixture.dispose());
  const client = await CdpClient.connect(fixture.mainTarget.webSocketDebuggerUrl, { timeoutMs: 1000 });
  t.after(() => client.close());
  const first = client.evaluate('fixture-first-status');
  const second = client.evaluate('fixture-second-status');
  assert.deepEqual(await Promise.all([first, second]), [{ fixtureExpression: 'fixture-first-status' }, { fixtureExpression: 'fixture-second-status' }]);
  assert.notEqual(fixture.commands[0].id, fixture.commands[1].id);
  for (const command of fixture.commands) {
    assert.equal(command.method, 'Runtime.evaluate');
    assert.equal(command.params.returnByValue, true);
    assert.equal(command.params.awaitPromise, true);
    assert.equal(command.params.userGesture, false);
  }
});

test('a mutation timeout reports an unknown outcome without sending a retry; status can still be checked', async t => {
  const fixture = await makeDebuggerFixture((command, send) => {
    if (command.params.expression === 'fixture-status-only') {
      send({ id: command.id, result: { result: { value: { fixtureMutationRequests: 1 } } } });
    }
  });
  t.after(() => fixture.dispose());
  const client = await CdpClient.connect(fixture.mainTarget.webSocketDebuggerUrl, { timeoutMs: 80 });
  t.after(() => client.close());
  await assert.rejects(client.evaluate('fixture-unanswered-mutation'), error => error.outcomeUnknown === true && /do not blindly retry/.test(error.message));
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(fixture.commands.length, 1, 'The timed out mutation must only be sent once.');
  const state = await client.evaluate('fixture-status-only');
  assert.deepEqual(state, { fixtureMutationRequests: 1 });
  assert.deepEqual(fixture.commands.map(command => command.params.expression), ['fixture-unanswered-mutation', 'fixture-status-only']);
});

test('closing rejects all outstanding commands and prevents new traffic', async t => {
  const fixture = await makeDebuggerFixture();
  t.after(() => fixture.dispose());
  const client = await CdpClient.connect(fixture.mainTarget.webSocketDebuggerUrl, { timeoutMs: 1000 });
  t.after(() => client.close());
  const isUnknownClose = error => error.outcomeUnknown === true && /closed/.test(error.message);
  const firstRejection = assert.rejects(client.send('Fixture.pendingOne'), isUnknownClose);
  const secondRejection = assert.rejects(client.send('Fixture.pendingTwo'), isUnknownClose);
  await fixture.waitForCommands(2);
  client.close();
  await Promise.all([firstRejection, secondRejection]);
  await assert.rejects(client.send('Fixture.shouldNeverReachPeer'), /not open/);
  client.close();
  assert.deepEqual(fixture.commands.map(command => command.method), ['Fixture.pendingOne', 'Fixture.pendingTwo']);
});
