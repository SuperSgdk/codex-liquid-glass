// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/core/fluid-shader.ts', import.meta.url))],
  bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent',
});
const { attachFluidShader, SITE_FLUID_PARAMS } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

function createEnvironment(t, { reduced = true, available = true } = {}) {
  const globals = ['window', 'navigator', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver'];
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
  const listeners = new Map();
  const observers = [];
  const live = new Set();
  const deleted = [];
  const draws = [];
  const uniforms = new Map();
  let program = null;
  let framebuffer = null;
  let viewport = [];
  const allocate = kind => { const resource = { kind, id: ++nextId }; live.add(resource); return resource; };
  const release = resource => {
    assert.ok(live.delete(resource), `${resource.kind} is released only once`);
    deleted.push(resource);
  };
  const gl = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
    ARRAY_BUFFER: 5, STATIC_DRAW: 6, FLOAT: 7, TEXTURE_2D: 8, RGBA: 9,
    UNSIGNED_BYTE: 10, TEXTURE_MIN_FILTER: 11, TEXTURE_MAG_FILTER: 12,
    LINEAR: 13, TEXTURE_WRAP_S: 14, TEXTURE_WRAP_T: 15, CLAMP_TO_EDGE: 16,
    FRAMEBUFFER: 17, COLOR_ATTACHMENT0: 18, FRAMEBUFFER_COMPLETE: 19,
    TEXTURE0: 20, TRIANGLE_STRIP: 21, failNextFramebuffer: false,
    createShader() { return allocate('shader'); },
    shaderSource() {}, compileShader() {}, getShaderParameter() { return true; },
    deleteShader: release,
    createProgram() { return allocate('program'); },
    attachShader() {}, linkProgram() {}, getProgramParameter() { return true; },
    deleteProgram: release,
    createBuffer() { return allocate('buffer'); },
    bindBuffer() {}, bufferData() {}, getAttribLocation() { return 0; },
    enableVertexAttribArray() {}, vertexAttribPointer() {}, deleteBuffer: release,
    createTexture() { return allocate('texture'); },
    bindTexture() {}, texImage2D() {}, texParameteri() {}, deleteTexture: release,
    createFramebuffer() { return allocate('framebuffer'); },
    bindFramebuffer(_target, value) { framebuffer = value; },
    framebufferTexture2D() {},
    checkFramebufferStatus() {
      if (this.failNextFramebuffer) { this.failNextFramebuffer = false; return 0; }
      return this.FRAMEBUFFER_COMPLETE;
    },
    deleteFramebuffer: release,
    getUniformLocation(target, name) { return { target, name }; },
    viewport(...values) { viewport = values; },
    useProgram(value) { program = value; },
    activeTexture() {},
    uniform1i(location, ...values) { uniforms.set(location.name, values); },
    uniform1f(location, ...values) { uniforms.set(location.name, values); },
    uniform2f(location, ...values) { uniforms.set(location.name, values); },
    uniform4f(location, ...values) { uniforms.set(location.name, values); },
    drawArrays() { draws.push({ program, framebuffer, viewport: [...viewport], uniforms: Object.fromEntries(uniforms) }); },
  };
  const canvas = {
    clientWidth: 180, clientHeight: 90, width: 300, height: 150,
    getContext(kind) { assert.equal(kind, 'webgl2'); return available ? gl : null; },
    getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }; },
  };
  class FakeResizeObserver {
    constructor(callback) { this.callback = callback; this.targets = new Set(); this.disconnected = false; observers.push(this); }
    observe(target) { this.targets.add(target); }
    disconnect() { this.targets.clear(); this.disconnected = true; }
  }
  const replacements = {
    window: {
      devicePixelRatio: 2,
      matchMedia(query) { return { matches: query.includes('prefers-reduced-motion') ? reduced : false }; },
      addEventListener(name, callback) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(callback); },
      removeEventListener(name, callback) { listeners.get(name)?.delete(callback); },
    },
    navigator: { userAgent: 'Linux' },
    performance: { now() { return now; } },
    requestAnimationFrame(callback) { const id = ++nextId; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    ResizeObserver: FakeResizeObserver,
  };
  for (const [key, value] of Object.entries(replacements)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  function runFrame(timestamp = now + 50) {
    now = timestamp;
    const pending = [...frames.values()]; frames.clear();
    for (const callback of pending) callback(now);
  }
  function resize(width, height) {
    canvas.clientWidth = width; canvas.clientHeight = height;
    for (const observer of observers) if (!observer.disconnected) observer.callback([{ target: canvas }]);
  }
  return { canvas, gl, frames, listeners, observers, live, deleted, draws, runFrame, resize, cleanups };
}

test('reduced motion redraws the latest palette once without an animation loop', t => {
  const env = createEnvironment(t);
  const handle = attachFluidShader(env.canvas, SITE_FLUID_PARAMS);
  env.cleanups.push(() => handle.dispose());
  assert.equal(handle.available, true);
  assert.equal(env.frames.size, 1);
  env.runFrame(1);
  assert.equal(env.draws.length, 2, 'initial static frame bypasses the 30fps throttle');
  assert.equal(env.frames.size, 0);
  assert.equal(env.listeners.get('mousemove')?.size || 0, 0);
  handle.setParams({ ...SITE_FLUID_PARAMS, color1: '#FF0000' });
  const latest = { ...SITE_FLUID_PARAMS, color1: '#00FF00', offsetX: 40 };
  handle.setParams(latest);
  latest.color1 = '#0000FF';
  assert.equal(env.frames.size, 1, 'palette updates share one pending redraw');
  env.runFrame(1000);
  assert.equal(env.draws.length, 4);
  assert.deepEqual(env.draws.at(-1).uniforms.u_color1, [0, 1, 0, 1]);
  assert.deepEqual(env.draws.at(-1).uniforms.u_offset, [0.4, 0.65]);
  assert.deepEqual(env.draws.at(-1).uniforms.u_time, [0], 'redrawing settings does not advance animation');
  assert.equal(env.frames.size, 0);
  handle.stir(0.2, 0.3, 1, 1);
  env.runFrame(2000);
  assert.equal(env.draws.length, 4, 'pointer wakes leave reduced motion at rest');
});

test('reduced motion merges resize and palette changes and skips a hidden canvas', t => {
  const env = createEnvironment(t);
  const handle = attachFluidShader(env.canvas, SITE_FLUID_PARAMS);
  env.cleanups.push(() => handle.dispose());
  env.runFrame();
  env.resize(240, 120);
  env.resize(400, 200);
  handle.setParams({ ...SITE_FLUID_PARAMS, color1: '#FF0000' });
  assert.equal(env.frames.size, 1);
  env.runFrame();
  assert.equal(env.draws.length, 4);
  assert.deepEqual([env.canvas.width, env.canvas.height], [600, 300]);
  assert.deepEqual(env.draws.at(-1).uniforms.u_resolution, [600, 300]);
  assert.deepEqual(env.draws.at(-1).viewport, [0, 0, 600, 300]);
  assert.deepEqual(env.draws.at(-1).uniforms.u_color1, [1, 0, 0, 1]);
  assert.equal(env.deleted.filter(resource => resource.kind === 'texture').length, 2, 'resize releases both replaced targets');
  assert.equal(env.frames.size, 0);
  env.resize(0, 0);
  env.runFrame();
  assert.equal(env.draws.length, 4);
  assert.deepEqual([env.canvas.width, env.canvas.height], [600, 300]);
  env.resize(180, 90);
  env.runFrame();
  assert.equal(env.draws.length, 6, 'revealing the canvas redraws without an animation loop');
  assert.deepEqual(env.draws.at(-1).uniforms.u_resolution, [270, 135]);
  assert.equal(env.frames.size, 0);
});

test('disposal cancels static redraws and releases observers and every GL resource once', t => {
  const env = createEnvironment(t);
  const handle = attachFluidShader(env.canvas, SITE_FLUID_PARAMS);
  env.cleanups.push(() => handle.dispose());
  env.runFrame();
  handle.setParams(SITE_FLUID_PARAMS);
  const queuedFrame = [...env.frames.values()][0];
  const queuedResize = env.observers[0].callback;
  handle.dispose();
  handle.dispose();
  assert.equal(env.frames.size, 0);
  assert.equal(env.live.size, 0);
  assert.ok(env.observers.every(observer => observer.disconnected));
  assert.equal(env.deleted.filter(resource => resource.kind === 'program').length, 2);
  assert.equal(env.deleted.filter(resource => resource.kind === 'buffer').length, 1);
  assert.equal(env.deleted.filter(resource => resource.kind === 'texture').length, 2);
  assert.equal(env.deleted.filter(resource => resource.kind === 'framebuffer').length, 2);
  const previousDraws = env.draws.length;
  const previousSize = [env.canvas.width, env.canvas.height];
  env.canvas.clientWidth = 900;
  queuedFrame(2000);
  queuedResize([{ target: env.canvas }]);
  handle.setParams({ ...SITE_FLUID_PARAMS, color1: '#FF0000' });
  handle.stir(0, 0, 1, 1);
  env.runFrame();
  assert.equal(env.frames.size, 0);
  assert.equal(env.draws.length, previousDraws);
  assert.deepEqual([env.canvas.width, env.canvas.height], previousSize);
});

test('continuous mode preserves one throttled loop and removes its pointer listener', t => {
  const env = createEnvironment(t, { reduced: false });
  const handle = attachFluidShader(env.canvas, SITE_FLUID_PARAMS);
  env.cleanups.push(() => handle.dispose());
  assert.equal(env.listeners.get('mousemove').size, 1);
  env.runFrame(10);
  assert.equal(env.draws.length, 0);
  assert.equal(env.frames.size, 1);
  handle.setParams({ ...SITE_FLUID_PARAMS, color1: '#FF0000' });
  env.resize(400, 200);
  assert.equal(env.frames.size, 1);
  env.runFrame(50);
  assert.equal(env.draws.length, 2);
  assert.deepEqual(env.draws.at(-1).uniforms.u_color1, [1, 0, 0, 1]);
  assert.deepEqual(env.draws.at(-1).uniforms.u_resolution, [600, 300]);
  assert.ok(Math.abs(env.draws.at(-1).uniforms.u_time[0] - 0.007) < 1e-8,
    'the default clock advances at the DSH rate of 0.14 per second, including after a resize');
  env.runFrame(60);
  assert.equal(env.draws.length, 2);
  assert.equal(env.frames.size, 1);
  handle.dispose();
  assert.equal(env.frames.size, 0);
  assert.equal(env.listeners.get('mousemove').size, 0);
  assert.equal(env.live.size, 0);
});

test('unavailable WebGL does not install animation work or observers', t => {
  const env = createEnvironment(t, { available: false });
  const handle = attachFluidShader(env.canvas, SITE_FLUID_PARAMS);
  assert.equal(handle.available, false);
  handle.setParams(SITE_FLUID_PARAMS);
  handle.stir(0, 0, 0, 0);
  handle.dispose();
  assert.equal(env.frames.size, 0);
  assert.equal(env.observers.length, 0);
  assert.equal(env.live.size, 0);
});
