import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { CdpClient, findMainTarget, validatePort } from './cdp-client.mjs';

const STATUS_EXPRESSION = `(() => {
  const runtime = window.__CODEX_GLASS__;
  if (runtime == null) return { runtimePresent: false };
  if (typeof runtime.getStatus !== 'function') throw new Error('An incompatible __CODEX_GLASS__ global exists.');
  return { runtimePresent: true, status: runtime.getStatus() };
})()`;

const REMOVE_EXPRESSION = `(async () => {
  const runtime = window.__CODEX_GLASS__;
  if (runtime != null) {
    if (typeof runtime.dispose !== 'function') throw new Error('An incompatible __CODEX_GLASS__ global exists.');
    await runtime.dispose();
  }
  return { runtimePresent: window.__CODEX_GLASS__ != null };
})()`;

const MAIN_SELECTOR = 'main[data-app-shell-main-surface="default"]';

export function readinessExpression(timeoutMs) {
  // Finish before the CDP command timeout, so unsupported UI is a known result.
  const waitMs = Math.max(1, timeoutMs - 250);
  return `(async () => {
    const deadline = Date.now() + ${waitMs};
    do {
      if (document.head && document.body && document.readyState !== 'loading' && document.querySelector(${JSON.stringify(MAIN_SELECTOR)})) return { ready: true };
      await new Promise(resolve => setTimeout(resolve, Math.min(50, Math.max(1, deadline - Date.now()))));
    } while (Date.now() < deadline);
    return { ready: false };
  })()`;
}

export function applyExpression(runtimeSource, timeoutMs) {
  const waitMs = Math.max(1, timeoutMs - 250);
  return `(async () => {
    const previous = window.__CODEX_GLASS__;
    if (previous != null && (typeof previous.getStatus !== 'function' || typeof previous.dispose !== 'function')) throw new Error('An incompatible __CODEX_GLASS__ global exists; it was not changed.');
    ${runtimeSource}
    ;
    const runtime = window.__CODEX_GLASS__;
    if (runtime == null || runtime === previous || typeof runtime.getStatus !== 'function' || typeof runtime.dispose !== 'function') return { applied: false, runtimePresent: runtime != null, reason: 'The bundle did not install a new compatible skin runtime.' };
    const deadline = Date.now() + ${waitMs};
    let status;
    let reason = 'The skin did not match the Codex main surface before the wait expired. The current interface may be unsupported.';
    try {
      do {
        if (window.__CODEX_GLASS__ !== runtime) { reason = 'The skin runtime was replaced during verification.'; break; }
        status = runtime.getStatus();
        if (status?.active === true && Number.isInteger(status?.matched?.main) && status.matched.main > 0) return { applied: true, runtimePresent: true, status };
        await new Promise(resolve => setTimeout(resolve, Math.min(50, Math.max(1, deadline - Date.now()))));
      } while (Date.now() < deadline);
    } catch {
      reason = 'The installed skin could not provide its status.';
    }
    // Never dispose a replacement/global owned by another injection. The skin
    // handle restores the exact attributes, styles and nodes it owns.
    let cleanup = { removed: false, reason: 'The runtime was replaced; no replacement was changed.' };
    if (window.__CODEX_GLASS__ === runtime) {
      try {
        await runtime.dispose();
        cleanup = { removed: window.__CODEX_GLASS__ !== runtime };
      } catch { cleanup = { removed: false, reason: 'The owned runtime could not be disposed.' }; }
    }
    return { applied: false, runtimePresent: window.__CODEX_GLASS__ != null, status, reason, cleanup };
  })()`;
}

function parseArgs(args) {
  let command = 'inspect';
  let explicitCommand = false;
  let port = 9223;
  let timeoutMs = 5000;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (['--inspect', '--apply', '--remove'].includes(arg)) {
      if (explicitCommand) throw new Error('Use exactly one of --inspect, --apply, or --remove.');
      command = arg.slice(2);
      explicitCommand = true;
    } else if (arg === '--port' || arg === '--timeout-ms') {
      const raw = args[++i];
      if (!raw || !/^\d+$/.test(raw)) throw new Error(`${arg} requires an integer.`);
      const value = Number(raw);
      if (arg === '--port') port = validatePort(value);
      else {
        if (!Number.isInteger(value) || value < 1000 || value > 30000) throw new Error('--timeout-ms must be between 1000 and 30000.');
        timeoutMs = value;
      }
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return { command, port, timeoutMs };
}

function report(value) { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); }

export async function runCommand(args, {
  runtimeSource,
  findTarget = findMainTarget,
  connect = (url, options) => CdpClient.connect(url, options),
} = {}) {
  const target = await findTarget(args);
  let client = await connect(target.webSocketDebuggerUrl, args);
  let mutationStarted = false;
  try {
    if (args.command === 'inspect') {
      const version = await client.send('Browser.getVersion');
      const state = await client.evaluate(STATUS_EXPRESSION);
      // Also redact injected fixture/custom discovery output defensively.
      const publicUrl = new URL(target.url);
      publicUrl.search = ''; publicUrl.hash = '';
      return { exitCode: 0, result: { command: 'inspect', target: { id: target.id, url: publicUrl.href }, browserProduct: version.product, ...state } };
    }
    try {
      if (args.command === 'apply') {
        if (typeof runtimeSource !== 'string' || !runtimeSource.trim()) throw new Error('The skin runtime bundle is empty.');
        const readiness = await client.evaluate(readinessExpression(args.timeoutMs));
        if (!readiness?.ready) throw new Error('The Codex main surface did not appear within the wait limit. The interface may be unsupported or still loading; no skin was applied.');
        mutationStarted = true;
        const state = await client.evaluate(applyExpression(runtimeSource, args.timeoutMs));
        if (!state?.applied) return { exitCode: 1, result: { command: 'apply', targetId: target.id, outcome: 'incompatible', ...state } };
        return { exitCode: 0, result: { command: 'apply', targetId: target.id, ...state } };
      }
      mutationStarted = true;
      const state = await client.evaluate(REMOVE_EXPRESSION);
      if (state?.runtimePresent) throw new Error('dispose() returned but the skin global still exists; removal is unverified.');
      return { exitCode: 0, result: { command: 'remove', targetId: target.id, removed: true, ...state } };
    } catch (error) {
      if (!error.outcomeUnknown) throw error;
      client.close();
      client = null;
      let verification;
      try {
        const currentTarget = await findTarget(args);
        if (currentTarget.id !== target.id) throw new Error('The main renderer changed; its previous state cannot be verified.');
        client = await connect(currentTarget.webSocketDebuggerUrl, args);
        verification = await client.evaluate(STATUS_EXPRESSION);
      } catch (verificationError) {
        verification = { verified: false, reason: verificationError.message };
      }
      return { exitCode: 2, result: { command: args.command, outcome: 'unknown', mutationStarted, error: error.message, verification, instruction: 'Inspect the reported status before choosing another command. The mutation was not retried.' } };
    }
  } finally { client?.close(); }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write('Usage: node scripts/codex-skin.mjs [--inspect | --apply | --remove] [--port 9223] [--timeout-ms 5000]\nDefault: inspect only. Never launches, exits, restarts, or modifies installed Codex files.\n');
    return;
  }
  let runtimeSource;
  if (args.command === 'apply') {
    const runtimePath = fileURLToPath(new URL('../dist/codex-glass.runtime.js', import.meta.url));
    try { runtimeSource = await readFile(runtimePath, 'utf8'); }
    catch { throw new Error('dist/codex-glass.runtime.js is missing. Build the reviewed skin first.'); }
    if (!runtimeSource.trim()) throw new Error('The skin runtime bundle is empty.');
  }
  const { result, exitCode } = await runCommand(args, { runtimeSource });
  report(result);
  process.exitCode = exitCode;
}

// Importing this file is inert, which also permits isolated protocol tests.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
