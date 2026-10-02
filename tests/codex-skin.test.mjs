import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { applyExpression, readinessExpression, runCommand } from '../scripts/codex-skin.mjs';

const target = { id: 'FIXTURE_MAIN', url: 'app://-/index.html?initialRoute=private-conversation#private-workspace', webSocketDebuggerUrl: 'ws://127.0.0.1:9223/devtools/page/FIXTURE_MAIN' };
const args = { command: 'apply', port: 9223, timeoutMs: 1000 };
const plain = value => JSON.parse(JSON.stringify(value));

// No browser, app or debugger connection is involved. The controlled clock
// exercises the renderer-side wait and cleanup without waiting in real time.
function rendererFixture(overrides = {}) {
  let elapsed = 0;
  const context = {
    window: {},
    document: { head: {}, body: {}, readyState: 'complete', querySelector: () => ({}) },
    Date: { now: () => elapsed },
    setTimeout(callback, delay) { elapsed += delay; queueMicrotask(callback); },
    ...overrides,
  };
  return { context, elapsed: () => elapsed, evaluate: expression => runInNewContext(expression, context) };
}

test('inspect redacts both private query parameters and fragments', async () => {
  let closed = 0;
  const client = {
    send: async () => ({ product: 'Fixture/1' }),
    evaluate: async () => ({ runtimePresent: false }),
    close: () => closed++,
  };
  const result = await runCommand({ ...args, command: 'inspect' }, { findTarget: async () => target, connect: async () => client });
  assert.equal(result.exitCode, 0);
  assert.equal(result.result.target.url, 'app://-/index.html');
  assert.doesNotMatch(JSON.stringify(result), /private-conversation|private-workspace|initialRoute/);
  assert.equal(closed, 1);
});

test('readiness waits for the main surface and finishes within a bounded interval', async () => {
  const renderer = rendererFixture();
  renderer.context.document.querySelector = selector => {
    assert.equal(selector, 'main[data-app-shell-main-surface="default"]');
    return renderer.elapsed() >= 150 ? {} : null;
  };
  assert.deepEqual(plain(await renderer.evaluate(readinessExpression(1000))), { ready: true });
  assert.equal(renderer.elapsed(), 150);
  renderer.context.document.querySelector = () => null;
  const start = renderer.elapsed();
  assert.deepEqual(plain(await renderer.evaluate(readinessExpression(1000))), { ready: false });
  assert.equal(renderer.elapsed() - start, 750);
});

test('apply does not inject when the main surface is unavailable', async () => {
  const expressions = [];
  let closed = 0;
  const client = {
    evaluate: async expression => { expressions.push(expression); return { ready: false }; },
    close: () => closed++,
  };
  await assert.rejects(runCommand(args, { runtimeSource: 'FIXTURE_MUTATION', findTarget: async () => target, connect: async () => client }), /no skin was applied/);
  assert.equal(expressions.length, 1);
  assert.doesNotMatch(expressions[0], /FIXTURE_MUTATION/);
  assert.equal(closed, 1);
});

test('apply verifies an active main surface even when the current page has no composer', async () => {
  const renderer = rendererFixture();
  let disposed = 0;
  renderer.context.makeRuntime = () => ({
    getStatus: () => ({ active: true, matched: { main: renderer.elapsed() >= 100 ? 1 : 0, composer: 0, sidebar: 0 } }),
    dispose: () => disposed++,
  });
  const state = plain(await renderer.evaluate(applyExpression('window.__CODEX_GLASS__ = makeRuntime();', 1000)));
  assert.equal(state.applied, true);
  assert.equal(state.status.matched.main, 1);
  assert.equal(state.status.matched.composer, 0);
  assert.equal(disposed, 0);
  assert.equal(renderer.elapsed(), 100);
});

test('a present global with zero matches fails and disposes only the installed runtime', async () => {
  const renderer = rendererFixture();
  let disposed = 0;
  renderer.context.makeRuntime = () => ({
    getStatus: () => ({ active: true, matched: { main: 0, composer: 0, sidebar: 0 } }),
    dispose() { disposed++; if (renderer.context.window.__CODEX_GLASS__ === this) delete renderer.context.window.__CODEX_GLASS__; },
  });
  const state = plain(await renderer.evaluate(applyExpression('window.__CODEX_GLASS__ = makeRuntime();', 1000)));
  assert.equal(state.applied, false);
  assert.equal(state.runtimePresent, false);
  assert.deepEqual(state.cleanup, { removed: true });
  assert.match(state.reason, /main surface/);
  assert.equal(disposed, 1);
  assert.equal(renderer.elapsed(), 750);
});

test('verification does not clean up a runtime replaced by another owner', async () => {
  const renderer = rendererFixture();
  let disposed = 0;
  const replacement = { dispose() { disposed++; } };
  renderer.context.makeRuntime = () => ({
    getStatus() { renderer.context.window.__CODEX_GLASS__ = replacement; return { active: false, matched: { main: 0 } }; },
    dispose() { disposed++; },
  });
  const state = plain(await renderer.evaluate(applyExpression('window.__CODEX_GLASS__ = makeRuntime();', 1000)));
  assert.equal(state.applied, false);
  assert.equal(state.cleanup.removed, false);
  assert.equal(renderer.context.window.__CODEX_GLASS__, replacement);
  assert.equal(disposed, 0);
});

test('an incompatible preexisting global is preserved before any injection', async () => {
  const previous = { unrelated: true };
  const renderer = rendererFixture({ window: { __CODEX_GLASS__: previous } });
  let injected = false;
  renderer.context.makeRuntime = () => { injected = true; };
  await assert.rejects(renderer.evaluate(applyExpression('window.__CODEX_GLASS__ = makeRuntime();', 1000)), /it was not changed/);
  assert.equal(injected, false);
  assert.equal(renderer.context.window.__CODEX_GLASS__, previous);
});

test('a timed out injection reconnects for status without repeating mutation or cleanup', async () => {
  const unknown = Object.assign(new Error('Fixture mutation timeout'), { outcomeUnknown: true });
  const firstExpressions = [];
  const verificationExpressions = [];
  let connections = 0;
  const clients = [
    { evaluate: async expression => { firstExpressions.push(expression); if (firstExpressions.length === 1) return { ready: true }; throw unknown; }, close() {} },
    { evaluate: async expression => { verificationExpressions.push(expression); return { runtimePresent: true, status: { active: true, matched: { main: 1 } } }; }, close() {} },
  ];
  const result = await runCommand(args, { runtimeSource: 'FIXTURE_MUTATION', findTarget: async () => target, connect: async () => clients[connections++] });
  assert.equal(result.exitCode, 2);
  assert.equal(result.result.outcome, 'unknown');
  assert.equal(result.result.mutationStarted, true);
  assert.equal(result.result.verification.status.matched.main, 1);
  assert.equal(firstExpressions.filter(expression => expression.includes('FIXTURE_MUTATION')).length, 1);
  assert.equal(verificationExpressions.length, 1);
  assert.doesNotMatch(verificationExpressions[0], /FIXTURE_MUTATION|\.dispose\(/);
});

test('a renderer change after timeout prevents checking or mutating a different target', async () => {
  const unknown = Object.assign(new Error('Fixture mutation timeout'), { outcomeUnknown: true });
  let discoveries = 0;
  let connections = 0;
  let evaluations = 0;
  const client = { evaluate: async () => { if (++evaluations === 1) return { ready: true }; throw unknown; }, close() {} };
  const result = await runCommand(args, { runtimeSource: 'FIXTURE_MUTATION', findTarget: async () => (++discoveries === 1 ? target : { ...target, id: 'REPLACEMENT' }), connect: async () => { connections++; return client; } });
  assert.equal(result.exitCode, 2);
  assert.deepEqual(result.result.verification, { verified: false, reason: 'The main renderer changed; its previous state cannot be verified.' });
  assert.equal(connections, 1);
  assert.equal(evaluations, 2);
});
