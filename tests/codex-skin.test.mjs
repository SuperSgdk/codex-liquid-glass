import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { applyExpression, readinessExpression, runCommand } from '../scripts/codex-skin.mjs';
import { selectMainTarget } from '../scripts/cdp-client.mjs';

const target = { id: 'FIXTURE_MAIN', url: 'app://-/index.html?initialRoute=private-conversation#private-workspace', webSocketDebuggerUrl: 'ws://127.0.0.1:9223/devtools/page/FIXTURE_MAIN' };
const args = { command: 'apply', port: 9223, timeoutMs: 1000 };
const plain = value => JSON.parse(JSON.stringify(value));
const startupContextError = (message = 'Execution context was destroyed.') => Object.assign(new Error(`CDP Runtime.evaluate failed: ${message}`), { code: -32000, method: 'Runtime.evaluate', cdpMessage: message });

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

test('readiness waits only for DOM mount hosts and finishes within a bounded interval', async () => {
  const renderer = rendererFixture();
  Object.defineProperty(renderer.context.document, 'body', { get: () => renderer.elapsed() >= 150 ? {} : null, configurable: true });
  renderer.context.document.readyState = 'loading';
  renderer.context.document.querySelector = () => { throw new Error('The main surface is not ready yet and must not gate mounting.'); };
  assert.deepEqual(plain(await renderer.evaluate(readinessExpression(1000))), { ready: true });
  assert.equal(renderer.elapsed(), 150);
  renderer.context.document.head = null;
  const start = renderer.elapsed();
  assert.deepEqual(plain(await renderer.evaluate(readinessExpression(1000))), { ready: false });
  assert.equal(renderer.elapsed() - start, 750);
});

test('apply does not inject when DOM mount hosts are unavailable', async () => {
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

test('apply installs before the native main is ready, then verifies the later main exactly once', async () => {
  const renderer = rendererFixture();
  const mainReadyAt = 400;
  const nativeLoadingEndsAt = 900;
  Object.defineProperty(renderer.context.document, 'body', { get: () => renderer.elapsed() >= 100 ? {} : null });
  Object.defineProperty(renderer.context.document, 'readyState', { get: () => renderer.elapsed() >= nativeLoadingEndsAt ? 'complete' : 'loading' });
  renderer.context.document.querySelector = () => renderer.elapsed() >= mainReadyAt ? {} : null;
  const installations = [];
  let disposed = 0;
  renderer.context.makeRuntime = () => {
    installations.push(renderer.elapsed());
    assert.equal(renderer.context.document.readyState, 'loading');
    assert.equal(renderer.context.document.querySelector(), null);
    return {
      getStatus: () => ({ mounted: true, active: true, matched: { main: renderer.elapsed() >= mainReadyAt ? 1 : 0 } }),
      dispose: () => disposed++,
    };
  };
  const client = { evaluate: renderer.evaluate, close() {} };
  const result = await runCommand(args, {
    runtimeSource: 'window.__CODEX_GLASS__ = makeRuntime();', findTarget: async () => target, connect: async () => client,
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.result.status.matched.main, 1);
  assert.deepEqual(installations, [100], 'Install as soon as head and body exist, before native main/complete readiness.');
  assert.equal(renderer.elapsed(), mainReadyAt, 'Success still waits for a matched main, rather than only an installed global.');
  assert.equal(nativeLoadingEndsAt - installations[0], 800, 'This fixture removes 800 ms of unnecessary pre-install wait.');
  assert.equal(disposed, 0);
});

test('early installation still cleans up an unsupported main instead of claiming success', async () => {
  const renderer = rendererFixture({ document: { head: {}, body: {}, readyState: 'loading', querySelector: () => null } });
  let installedAt;
  let disposed = 0;
  renderer.context.makeRuntime = () => {
    installedAt = renderer.elapsed();
    return {
      getStatus: () => ({ mounted: true, active: true, matched: { main: 0 } }),
      dispose() { disposed++; delete renderer.context.window.__CODEX_GLASS__; },
    };
  };
  const result = await runCommand(args, {
    runtimeSource: 'window.__CODEX_GLASS__ = makeRuntime();', findTarget: async () => target,
    connect: async () => ({ evaluate: renderer.evaluate, close() {} }),
  });
  assert.equal(installedAt, 0);
  assert.equal(result.exitCode, 1);
  assert.equal(result.result.applied, false);
  assert.equal(result.result.runtimePresent, false);
  assert.equal(disposed, 1);
  assert.equal(renderer.elapsed(), 750);
  assert.deepEqual(plain(result.result.cleanup), { removed: true });
});

test('startup context recovery rediscovers the same main target and injects exactly once', async () => {
  for (const message of ['Execution context was destroyed.', 'Cannot find default execution context']) {
    const expressions = [];
    const discoveries = [];
    let connections = 0;
    let closed = 0;
    const client = {
      evaluate: async expression => {
        expressions.push(expression);
        if (expressions.length === 1) throw startupContextError(message);
        return expression.includes('FIXTURE_MUTATION') ? { applied: true } : { ready: true };
      },
      close: () => closed++,
    };
    const result = await runCommand(args, {
      runtimeSource: 'FIXTURE_MUTATION',
      findTarget: async options => { discoveries.push(options); return target; },
      connect: async () => { connections++; return client; },
    });
    assert.equal(result.exitCode, 0);
    assert.equal(expressions.length, 3);
    assert.equal(expressions.filter(expression => expression.includes('FIXTURE_MUTATION')).length, 1);
    assert.equal(discoveries.length, 2);
    assert.equal(discoveries[0].waitForMain, true);
    assert.equal(discoveries[1].waitForMain, false);
    assert.ok(discoveries[1].timeoutMs > 0 && discoveries[1].timeoutMs < args.timeoutMs);
    assert.equal(connections, 1);
    assert.equal(closed, 1);
  }
});

test('persistent startup context errors exhaust the original limit without injection', { timeout: 1500 }, async () => {
  const expressions = [];
  const discoveries = [];
  const shortArgs = { ...args, timeoutMs: 90 };
  const client = {
    evaluate: async expression => { expressions.push(expression); throw startupContextError(); },
    close() {},
  };
  const started = performance.now();
  await assert.rejects(runCommand(shortArgs, {
    runtimeSource: 'FIXTURE_MUTATION',
    findTarget: async options => { discoveries.push(options); return target; },
    connect: async () => client,
  }), /within the wait limit.*no skin was applied/);
  assert.ok(performance.now() - started < 500, 'Startup must keep its existing deadline rather than restart the limit on every retry.');
  assert.ok(expressions.length >= 1 && expressions.length <= 3);
  assert.equal(expressions.filter(expression => expression.includes('FIXTURE_MUTATION')).length, 0);
  assert.ok(discoveries.every(options => options.timeoutMs <= shortArgs.timeoutMs));
});

test('a stalled readiness retry also stays within the original startup limit', { timeout: 1500 }, async () => {
  const expressions = [];
  let closed = 0;
  const client = {
    evaluate: async expression => {
      expressions.push(expression);
      if (expressions.length === 1) throw startupContextError();
      return new Promise(() => {});
    },
    close: () => closed++,
  };
  const started = performance.now();
  await assert.rejects(runCommand({ ...args, timeoutMs: 90 }, {
    runtimeSource: 'FIXTURE_MUTATION', findTarget: async () => target, connect: async () => client,
  }), /within the wait limit.*no skin was applied/);
  assert.ok(performance.now() - started < 500);
  assert.equal(expressions.length, 2);
  assert.equal(expressions.filter(expression => expression.includes('FIXTURE_MUTATION')).length, 0);
  assert.equal(closed, 1);
});

test('startup context recovery refuses a changed main renderer before another evaluation', async () => {
  let discoveries = 0;
  const expressions = [];
  const client = { evaluate: async expression => { expressions.push(expression); throw startupContextError(); }, close() {} };
  await assert.rejects(runCommand(args, {
    runtimeSource: 'FIXTURE_MUTATION',
    findTarget: async () => (++discoveries === 1 ? target : { ...target, id: 'REPLACEMENT' }),
    connect: async () => client,
  }), /main renderer changed during startup; no skin was applied/);
  assert.equal(discoveries, 2);
  assert.equal(expressions.length, 1);
  assert.doesNotMatch(expressions[0], /FIXTURE_MUTATION/);
});

test('startup context recovery immediately refuses multiple main targets or unsafe endpoints', async () => {
  const discoveredTarget = { ...target, type: 'page', url: 'app://-/index.html' };
  for (const [targets, expectedError] of [
    [[discoveredTarget, { ...discoveredTarget, id: 'SECOND_MAIN' }], /exactly one Codex main renderer, found 2/],
    [[{ ...discoveredTarget, webSocketDebuggerUrl: 'ws://192.168.1.2:9223/devtools/page/FIXTURE_MAIN' }], /Refusing a debugger endpoint/],
  ]) {
    let discoveries = 0;
    let evaluations = 0;
    const client = { evaluate: async () => { evaluations++; throw startupContextError(); }, close() {} };
    await assert.rejects(runCommand(args, {
      runtimeSource: 'FIXTURE_MUTATION',
      findTarget: async () => (++discoveries === 1 ? target : selectMainTarget(targets, args.port)),
      connect: async () => client,
    }), expectedError);
    assert.equal(discoveries, 2);
    assert.equal(evaluations, 1);
  }
});

test('startup only recovers exact CDP context errors and never ordinary JavaScript failures', async () => {
  for (const error of [
    new Error('Skin evaluation failed: Execution context was destroyed.'),
    startupContextError('Unrelated Runtime.evaluate failure'),
    Object.assign(startupContextError(), { code: -32602 }),
    Object.assign(startupContextError(), { method: 'Browser.getVersion' }),
  ]) {
    let discoveries = 0;
    let evaluations = 0;
    const client = { evaluate: async () => { evaluations++; throw error; }, close() {} };
    await assert.rejects(runCommand(args, {
      runtimeSource: 'FIXTURE_MUTATION',
      findTarget: async () => { discoveries++; return target; },
      connect: async () => client,
    }), rejection => rejection === error);
    assert.equal(discoveries, 1);
    assert.equal(evaluations, 1);
  }
});

test('a context destroyed error after injection begins never repeats mutation or readiness', async () => {
  const error = startupContextError();
  let discoveries = 0;
  const expressions = [];
  const client = {
    evaluate: async expression => {
      expressions.push(expression);
      if (expressions.length === 1) return { ready: true };
      throw error;
    },
    close() {},
  };
  await assert.rejects(runCommand(args, {
    runtimeSource: 'FIXTURE_MUTATION',
    findTarget: async () => { discoveries++; return target; },
    connect: async () => client,
  }), rejection => rejection === error);
  assert.equal(discoveries, 1);
  assert.equal(expressions.length, 2);
  assert.equal(expressions.filter(expression => expression.includes('FIXTURE_MUTATION')).length, 1);
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

test('apply preserves a mounted disabled controller so settings can enable the skin later', async () => {
  const renderer = rendererFixture();
  let disposed=0;
  renderer.context.makeRuntime = () => ({
    getStatus: () => ({ mounted:true, active:false, matched:{main:1} }),
    dispose: () => disposed++,
  });
  const result=plain(await renderer.evaluate(applyExpression('window.__CODEX_GLASS__ = makeRuntime();',1000)));
  assert.equal(result.applied,true);
  assert.equal(result.status.active,false);
  assert.equal(result.status.mounted,true);
  assert.equal(disposed,0);
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
