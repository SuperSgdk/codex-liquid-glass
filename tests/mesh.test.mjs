// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/core/mesh.ts', import.meta.url))],
  bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent',
});
const { mountMesh } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

function createEnvironment(t, { reduced = false, coarse = false } = {}) {
  const globals = ['document', 'window', 'matchMedia', 'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver', 'IntersectionObserver'];
  const saved = new Map(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const cleanups = [];
  t.after(() => {
    for (const cleanup of cleanups) cleanup();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  let nextId = 0;
  let now = 0;
  const frames = new Map();
  const timers = new Map();
  const listeners = new Map();
  const resizeObservers = [];
  const intersectionObservers = [];
  const draws = [];
  const context = {
    setTransform(...values) { this.transform = values; },
    clearRect(x, y, width, height) { draws.push({ width, height, dots: [] }); },
    beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
    fillRect(...rect) { draws.at(-1).dots.push(rect); },
  };
  const host = {
    width: 180, height: 90, children: [], style: { position: 'absolute' },
    appendChild(element) { this.children.push(element); element.parentNode = this; },
  };
  const canvas = {
    width: 300, height: 150, style: {}, attributes: {}, parentNode: null,
    get clientWidth() { return host.width; },
    get clientHeight() { return host.height; },
    getContext(kind) { assert.equal(kind, '2d'); return context; },
    setAttribute(name, value) { this.attributes[name] = value; },
    getBoundingClientRect() { return { left: 0, top: 0, width: host.width, height: host.height }; },
    remove() { host.children = host.children.filter(child => child !== this); this.parentNode = null; },
  };
  class FakeResizeObserver {
    constructor(callback) { this.callback = callback; this.targets = new Set(); this.disconnected = false; resizeObservers.push(this); }
    observe(target) { this.targets.add(target); }
    disconnect() { this.targets.clear(); this.disconnected = true; }
  }
  class FakeIntersectionObserver {
    constructor(callback) { this.callback = callback; this.disconnected = false; intersectionObservers.push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
  }
  Object.assign(globalThis, {
    document: { createElement(tag) { assert.equal(tag, 'canvas'); return canvas; } },
    window: {
      devicePixelRatio: 2,
      setTimeout(callback) { const id = ++nextId; timers.set(id, callback); return id; },
      clearTimeout(id) { timers.delete(id); },
      addEventListener(name, callback) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(callback); },
      removeEventListener(name, callback) { listeners.get(name)?.delete(callback); },
    },
    matchMedia(query) { return { matches: query.includes('prefers-reduced-motion') ? reduced : coarse }; },
    requestAnimationFrame(callback) { const id = ++nextId; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    ResizeObserver: FakeResizeObserver,
    IntersectionObserver: FakeIntersectionObserver,
  });
  function flushTimers() {
    const pending = [...timers.values()]; timers.clear();
    for (const callback of pending) callback();
  }
  function runFrame() {
    now += 50;
    const pending = [...frames.values()]; frames.clear();
    for (const callback of pending) callback(now);
  }
  function settle() { flushTimers(); runFrame(); }
  function resize(width, height) {
    host.width = width; host.height = height;
    for (const observer of resizeObservers) if (!observer.disconnected && observer.targets.size) {
      observer.callback([...observer.targets].map(target => ({ target, contentRect: { width, height } })));
    }
    for (const callback of listeners.get('resize') || []) callback();
  }
  return { host, canvas, context, draws, frames, timers, listeners, resizeObservers, intersectionObservers, settle, runFrame, resize, cleanups };
}

for (const [label, options] of [['idle', {}], ['reduced motion', { reduced: true }], ['coarse pointer', { coarse: true }]]) {
  test(`mesh redraws after host resize without pointer movement in ${label} mode`, t => {
    const env = createEnvironment(t, options);
    const nativeStyle = { ...env.host.style };
    const handle = mountMesh(env.host);
    env.cleanups.push(() => handle.dispose());
    env.settle();
    assert.equal(env.draws.at(-1).dots.length, 6);
    assert.equal(env.frames.size, 0, 'the resting mesh has no animation loop');
    env.resize(450, 270);
    env.settle();
    assert.deepEqual([env.canvas.width, env.canvas.height], [900, 540]);
    assert.deepEqual([env.draws.at(-1).width, env.draws.at(-1).height], [450, 270]);
    assert.equal(env.draws.at(-1).dots.length, 24, 'the new grid fills the resized host');
    assert.equal(env.frames.size, 0, 'one redraw returns to rest');
    assert.deepEqual(env.host.style, nativeStyle, 'host layout remains untouched');
    assert.equal(env.canvas.style.pointerEvents, 'none');
    assert.equal(env.canvas.attributes['aria-hidden'], 'true');
  });
}

test('mesh coalesces repeated resize and releases observers, frames, timers and pointer listeners', t => {
  const env = createEnvironment(t);
  const handle = mountMesh(env.host);
  env.cleanups.push(() => handle.dispose());
  env.settle();
  env.resize(270, 180);
  env.resize(450, 270);
  assert.equal(env.timers.size, 1, 'only the latest resize waits for the grid rebuild');
  env.settle();
  assert.equal(env.draws.at(-1).dots.length, 24);
  env.resize(540, 360);
  assert.equal(env.timers.size, 1);
  handle.dispose();
  handle.dispose();
  assert.equal(env.frames.size, 0);
  assert.equal(env.timers.size, 0);
  assert.equal(env.host.children.length, 0);
  assert.ok(env.resizeObservers.length > 0);
  assert.ok(env.resizeObservers.every(observer => observer.disconnected));
  assert.ok(env.intersectionObservers.every(observer => observer.disconnected));
  assert.equal(env.listeners.get('pointermove')?.size || 0, 0);
  const drawCount = env.draws.length;
  const canvasSize = [env.canvas.width, env.canvas.height];
  // Even a notification already queued before disconnect must do nothing.
  env.host.width = 900; env.host.height = 600;
  for (const observer of env.resizeObservers) observer.callback([{ target: env.host }]);
  env.settle();
  assert.equal(env.draws.length, drawCount);
  assert.deepEqual([env.canvas.width, env.canvas.height], canvasSize);
});

test('mesh disposal cancels pending animation and resize work before the first frame', t => {
  const env = createEnvironment(t);
  const handle = mountMesh(env.host);
  env.cleanups.push(() => handle.dispose());
  env.resize(450, 270);
  assert.equal(env.frames.size, 1);
  assert.equal(env.timers.size, 1);
  const queuedFrame = [...env.frames.values()][0];
  const queuedResize = [...env.timers.values()][0];
  handle.dispose();
  assert.equal(env.frames.size, 0);
  assert.equal(env.timers.size, 0);
  queuedFrame(50);
  queuedResize();
  for (const observer of env.intersectionObservers) observer.callback([{ isIntersecting: true }]);
  assert.equal(env.draws.length, 0, 'queued callbacks cannot draw after disposal');
  assert.equal(env.frames.size, 0);
  assert.equal(env.timers.size, 0);
});

test('mesh follows pointer movement, settles, and returns to its resting grid after blur', t => {
  const env = createEnvironment(t);
  const handle = mountMesh(env.host);
  env.cleanups.push(() => handle.dispose());
  env.settle();
  const centers = draw => draw.dots.map(([x, y, width, height]) => [x + width / 2, y + height / 2]);
  const resting = centers(env.draws.at(-1));
  for (const callback of env.listeners.get('pointermove')) callback({ clientX: 30, clientY: 20 });
  env.runFrame();
  const firstMove = centers(env.draws.at(-1));
  assert.ok(firstMove.some((point, index) => Math.hypot(point[0] - resting[index][0], point[1] - resting[index][1]) > 1));
  let count = 0;
  while (env.frames.size && count++ < 100) env.runFrame();
  assert.equal(env.frames.size, 0, 'a stationary pointer reaches rest without an endless loop');
  assert.ok(centers(env.draws.at(-1)).every((point, index) =>
    point.every(Number.isFinite) && Math.hypot(point[0] - resting[index][0], point[1] - resting[index][1]) < 40),
  'displacement stays finite and near the original grid');
  for (const callback of env.listeners.get('blur')) callback();
  count = 0;
  while (env.frames.size && count++ < 100) env.runFrame();
  assert.equal(env.frames.size, 0);
  assert.ok(centers(env.draws.at(-1)).every((point, index) =>
    Math.hypot(point[0] - resting[index][0], point[1] - resting[index][1]) < 0.05),
  'removing the pointer restores the resting geometry');
});

test('mesh pauses when hidden and releases all pointer and visibility wakeups', t => {
  const env = createEnvironment(t);
  const handle = mountMesh(env.host);
  env.cleanups.push(() => handle.dispose());
  env.settle();
  const observer = env.intersectionObservers[0];
  observer.callback([{ isIntersecting: false }]);
  for (const callback of env.listeners.get('pointermove')) callback({ clientX: 30, clientY: 20 });
  assert.equal(env.frames.size, 0, 'a hidden grid does not animate');
  observer.callback([{ isIntersecting: true }]);
  assert.equal(env.frames.size, 1, 'visibility resumes its pending pointer response');
  env.runFrame();
  assert.equal(env.frames.size, 1);
  handle.dispose();
  for (const name of ['resize', 'pointermove', 'pointerleave', 'blur']) {
    assert.equal(env.listeners.get(name)?.size || 0, 0);
  }
  observer.callback([{ isIntersecting: true }]);
  assert.equal(env.frames.size, 0, 'an already queued observer cannot wake a disposed grid');
});
