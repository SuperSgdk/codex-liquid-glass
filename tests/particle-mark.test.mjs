// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const data = JSON.parse(await readFile(new URL('../src/decorations/shark-particle-data.json', import.meta.url), 'utf8'));
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/decorations/particle-mark.ts', import.meta.url))],
  bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent',
});
const { mountParticleMark } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

function createEnvironment(t, { reduced = false, noContext = false } = {}) {
  const keys = ['document', 'window', 'matchMedia', 'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver', 'Image', 'fetch'];
  const saved = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const cleanups = [];
  t.after(() => {
    for (const cleanup of cleanups) cleanup();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const frames = new Map();
  const observers = [];
  const windowListeners = new Map();
  const documentListeners = new Map();
  let nextId = 0;
  let clock = 0;
  let drawCount = 0;
  const ctx = {
    dots: [], width: 0, height: 0,
    setTransform() {},
    clearRect(x, y, width, height) { this.dots = []; this.width = width; this.height = height; drawCount++; },
    fillRect(x, y, width, height) {
      assert.ok([x, y, width, height].every(Number.isFinite), 'drawing coordinates remain finite');
      this.dots.push({ x: x + width / 2, y: y + height / 2, width, color: this.fillStyle, alpha: this.globalAlpha });
    },
  };
  const main = { rect: { left: 240, top: 40, width: 1000, height: 760 }, style: { native: 'unchanged' }, getBoundingClientRect() { return this.rect; } };
  const host = {
    children: [], style: { native: 'unchanged' },
    getBoundingClientRect() { return { left: 20, top: 10, width: 1260, height: 900 }; },
    appendChild(node) { this.children.push(node); node.parent = this; },
  };
  const makeNode = tag => ({
    tag, children: [], attributes: {}, style: {}, parent: null,
    setAttribute(name, value) { this.attributes[name] = value; },
    appendChild(node) { this.children.push(node); node.parent = this; },
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); this.parent = null; },
    getBoundingClientRect() {
      const width = parseFloat(this.style.width) || 1;
      const height = parseFloat(this.style.height) || 1;
      const hostRect = host.getBoundingClientRect();
      return { left: hostRect.left + parseFloat(this.style.left) - width / 2, top: hostRect.top + parseFloat(this.style.top) - height / 2, width, height };
    },
    getContext(kind) { assert.equal(kind, '2d'); return noContext ? null : ctx; },
  });
  const listen = (map, name, callback) => { if (!map.has(name)) map.set(name, new Set()); map.get(name).add(callback); };
  const fakeDocument = {
    hidden: false, createElement: makeNode,
    addEventListener: (name, callback) => listen(documentListeners, name, callback),
    removeEventListener: (name, callback) => documentListeners.get(name)?.delete(callback),
  };
  const fakeWindow = {
    innerWidth: 1280, innerHeight: 900, devicePixelRatio: 2,
    addEventListener: (name, callback) => listen(windowListeners, name, callback),
    removeEventListener: (name, callback) => windowListeners.get(name)?.delete(callback),
  };
  Object.assign(globalThis, {
    window: fakeWindow, document: fakeDocument,
    matchMedia: () => ({ matches: reduced }),
    requestAnimationFrame(callback) { const id = ++nextId; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    ResizeObserver: class {
      constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
      observe() {}
      disconnect() { this.disconnected = true; }
    },
    Image: class { constructor() { throw new Error('No image decoding or external asset load is permitted.'); } },
    fetch() { throw new Error('The shark runtime must not request network data.'); },
  });
  const dispatch = (map, name, event = {}) => { for (const callback of map.get(name) || []) callback(event); };
  function runFrames(count) {
    for (let i = 0; i < count; i++) {
      clock += 1000 / 30;
      const pending = [...frames.values()]; frames.clear();
      for (const callback of pending) callback(clock);
    }
  }
  function resize(width, height) {
    main.rect.width = width;
    fakeWindow.innerHeight = height;
    for (const observer of observers) if (!observer.disconnected) observer.callback([]);
  }
  function maxRestDistance() {
    const extent = Math.max(data.width, data.height);
    const scale = Math.min(ctx.width * .77 / (data.width / extent), ctx.height * .81 / (data.height / extent));
    return Math.max(...ctx.dots.map((dot, i) => {
      const [x, y] = data.points[i];
      return Math.hypot(dot.x - (ctx.width / 2 + (x - (data.width - 1) / 2) / extent * scale),
        dot.y - (ctx.height / 2 + (y - (data.height - 1) / 2) / extent * scale));
    }));
  }
  return { main, host, ctx, frames, observers, cleanups, document: fakeDocument, window: fakeWindow, windowListeners, documentListeners,
    runFrames, resize, maxRestDistance, drawCount: () => drawCount,
    windowEvent: (name, event) => dispatch(windowListeners, name, event),
    documentEvent: (name, event) => dispatch(documentListeners, name, event),
  };
}

test('静态鲨鱼完整绘制5745点与原图RGB，明暗切换保持配色且不加载外部资源', t => {
  const env = createEnvironment(t, { reduced: true });
  const handle = mountParticleMark(env.host, env.main, false);
  env.cleanups.push(() => handle.dispose());
  assert.equal(env.ctx.dots.length, 5745);
  assert.ok(env.maxRestDistance() < 1e-10, 'static points reproduce the confirmed contour');
  const colors = env.ctx.dots.map(dot => dot.color);
  assert.deepEqual(colors, data.points.map(([, , r, g, b]) => `rgb(${r} ${g} ${b})`));
  assert.ok(env.ctx.dots.every(dot => dot.alpha >= .82 && dot.alpha <= 1));
  handle.setDark(true);
  assert.deepEqual(env.ctx.dots.map(dot => dot.color), colors);
  assert.equal(env.host.children[0].style.mixBlendMode, 'normal');
  assert.equal(env.frames.size, 0);
  assert.equal(env.windowListeners.get('pointermove')?.size || 0, 0);
  assert.deepEqual(env.main.style, { native: 'unchanged' });
  assert.deepEqual(env.host.style, { native: 'unchanged' });
});

test('动态鲨鱼从散点聚合，鼠标局部拨散后自动恢复轮廓', t => {
  const env = createEnvironment(t);
  const handle = mountParticleMark(env.host, env.main, true);
  env.cleanups.push(() => handle.dispose());
  assert.ok(env.maxRestDistance() > 200, 'initial particles start dispersed');
  env.runFrames(360);
  assert.equal(env.ctx.dots.length, 5745);
  assert.ok(env.maxRestDistance() < 4, 'assembly preserves the silhouette, allowing the confirmed idle drift');
  const rect = env.host.children[0].getBoundingClientRect();
  env.windowEvent('pointermove', { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 });
  env.runFrames(90);
  assert.ok(env.maxRestDistance() > 12, 'pointer pressure visibly moves local particles');
  env.documentEvent('pointerleave');
  env.runFrames(240);
  assert.ok(env.maxRestDistance() < 4, 'particles return after the pointer leaves');
  handle.setPointerEnabled(false);
  assert.equal(env.windowListeners.get('pointermove').size, 0);
  handle.setPointerEnabled(true);
  assert.equal(env.windowListeners.get('pointermove').size, 1);
});

test('减少动画模式缩放后重绘轮廓，并保持原有主列居中位置', t => {
  const env = createEnvironment(t, { reduced: true });
  const handle = mountParticleMark(env.host, env.main, false);
  env.cleanups.push(() => handle.dispose());
  const holder = env.host.children[0];
  assert.equal(holder.style.left, '720px');
  assert.equal(holder.style.top, '410px');
  assert.deepEqual([holder.children[0].width, holder.children[0].height], [990, 990]);
  env.resize(360, 400);
  assert.deepEqual([holder.children[0].width, holder.children[0].height], [432, 432]);
  assert.equal(holder.style.left, '400px');
  assert.equal(holder.style.top, '410px');
  assert.ok(env.maxRestDistance() < 1e-10);
  assert.equal(env.ctx.dots.length, 5745);
  assert.equal(env.frames.size, 0);
});

test('隐藏停止RAF，恢复只启一个循环，销毁释放观察器和所有已登记事件', t => {
  const env = createEnvironment(t);
  const handle = mountParticleMark(env.host, env.main, false);
  env.cleanups.push(() => handle.dispose());
  env.runFrames(5);
  env.document.hidden = true;
  env.documentEvent('visibilitychange');
  assert.equal(env.frames.size, 0);
  const drawCount = env.drawCount();
  env.runFrames(10);
  assert.equal(env.drawCount(), drawCount);
  env.document.hidden = false;
  env.documentEvent('visibilitychange');
  env.documentEvent('visibilitychange');
  assert.equal(env.frames.size, 1);
  const queuedFrame = [...env.frames.values()][0];
  handle.dispose();
  handle.dispose();
  assert.equal(env.frames.size, 0);
  assert.equal(env.host.children.length, 0);
  assert.ok(env.observers.every(observer => observer.disconnected));
  assert.ok([...env.windowListeners.values(), ...env.documentListeners.values()].every(listeners => listeners.size === 0));
  const disposedDrawCount = env.drawCount();
  queuedFrame(99999);
  for (const observer of env.observers) observer.callback([]);
  handle.setDark(true);
  handle.setPointerEnabled(true);
  assert.equal(env.drawCount(), disposedDrawCount);
  assert.equal(env.frames.size, 0);
});

test('不支持canvas的环境释放占位节点并返回可安全销毁的句柄', t => {
  const env = createEnvironment(t, { noContext: true });
  const handle = mountParticleMark(env.host, env.main, true);
  assert.equal(env.host.children.length, 0);
  assert.equal(env.frames.size, 0);
  assert.equal(env.observers.length, 0);
  assert.doesNotThrow(() => { handle.setDark(false); handle.setPointerEnabled(false); handle.dispose(); });
});
