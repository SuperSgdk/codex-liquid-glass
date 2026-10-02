// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createTestGL } from './shark-webgl-fixture.mjs';

const data = JSON.parse(await readFile(new URL('../src/decorations/shark-particle-data.json', import.meta.url), 'utf8'));
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/decorations/particle-mark.ts', import.meta.url))],
  bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent',
});
const { mountParticleMark } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const decorationBundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/decorations/index.ts', import.meta.url))],
  bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent',
});
const { mountDecorations } = await import(`data:text/javascript;base64,${Buffer.from(decorationBundle.outputFiles[0].text).toString('base64')}`);

function createEnvironment(t, { reduced = false, noContext = false, hidden = false, gpu = null } = {}) {
  const keys = ['document', 'window', 'matchMedia', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'ResizeObserver', 'Image', 'fetch', 'getComputedStyle'];
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
  const idleCallbacks = new Map();
  const observers = [];
  const windowListeners = new Map();
  const documentListeners = new Map();
  let nextId = 0;
  let clock = 0;
  let drawCount = 0;
  let fillCount = 0;
  const canvases = [];
  const makeContext = () => ({
    dots: [], width: 0, height: 0,
    setTransform() {},
    clearRect(x, y, width, height) { this.dots = []; this.width = width; this.height = height; drawCount++; },
    fillRect(x, y, width, height) {
      fillCount++;
      assert.ok([x, y, width, height].every(Number.isFinite), 'drawing coordinates remain finite');
      this.dots.push({ x: x + width / 2, y: y + height / 2, width, color: this.fillStyle, alpha: this.globalAlpha });
    },
    drawImage(source) { this.dots = source.context.dots.map(dot => ({ ...dot })); },
  });
  const ctx = makeContext();
  const makeAnchor = rect => ({ rect, style: { native: 'unchanged' }, getBoundingClientRect() { return this.rect; } });
  const main = makeAnchor({ left: 240, top: 40, width: 1000, height: 760 });
  const host = {
    children: [], style: { native: 'unchanged' },
    getBoundingClientRect() { return { left: 20, top: 10, width: 1260, height: 900 }; },
    appendChild(node) { this.children.push(node); node.parent = this; },
  };
  const makeNode = tag => {
    const node = {
    tag, children: [], attributes: {}, style: {}, parent: null,
    setAttribute(name, value) { this.attributes[name] = value; },
    appendChild(node) { this.children.push(node); node.parent = this; },
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); this.parent = null; },
    getBoundingClientRect() {
      if (!this.style.width) return host.getBoundingClientRect();
      const width = parseFloat(this.style.width) || 1;
      const height = parseFloat(this.style.height) || 1;
      const hostRect = host.getBoundingClientRect();
      return { left: hostRect.left + parseFloat(this.style.left) - width / 2, top: hostRect.top + parseFloat(this.style.top) - height / 2, width, height };
    },
    listeners: new Map(),
    addEventListener(name, callback) { this.listeners.set(name, callback); },
    removeEventListener(name, callback) { if (this.listeners.get(name) === callback) this.listeners.delete(name); },
    getContext(kind) {
      if (kind === 'webgl2') return gpu?.gl || null;
      assert.equal(kind, '2d');
      return noContext ? null : this.context;
    },
    };
    if (tag === 'canvas') { node.context = canvases.length ? makeContext() : ctx; canvases.push(node); }
    return node;
  };
  const listen = (map, name, callback) => { if (!map.has(name)) map.set(name, new Set()); map.get(name).add(callback); };
  const fakeDocument = {
    hidden, createElement: makeNode,
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
    requestIdleCallback(callback) { const id = ++nextId; idleCallbacks.set(id, callback); return id; },
    cancelIdleCallback(id) { idleCallbacks.delete(id); },
    ResizeObserver: class {
      constructor(callback) { this.callback = callback; this.disconnected = false; this.targets = new Set(); observers.push(this); }
      observe(target) { this.targets.add(target); }
      unobserve(target) { this.targets.delete(target); }
      disconnect() { this.disconnected = true; this.targets.clear(); }
    },
    Image: class { constructor() { throw new Error('No image decoding or external asset load is permitted.'); } },
    fetch() { throw new Error('The shark runtime must not request network data.'); },
    getComputedStyle() { throw new Error('Assembly replay must not force style resolution during a chat layout.'); },
  });
  const dispatch = (map, name, event = {}) => { for (const callback of map.get(name) || []) callback(event); };
  function runFrames(count, interval = 1000 / 30) {
    for (let i = 0; i < count; i++) {
      clock += interval;
      const pending = [...frames.values()]; frames.clear();
      for (const callback of pending) callback(clock);
    }
  }
  function resize(width, height) {
    main.rect.width = width;
    main.rect.height = height;
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
  return { main, host, ctx, frames, idleCallbacks, observers, canvases, cleanups, document: fakeDocument, window: fakeWindow, windowListeners, documentListeners,
    makeAnchor, runFrames, resize, maxRestDistance, drawCount: () => drawCount, fillCount: () => fillCount,
    runIdle() { const pending = [...idleCallbacks.values()]; idleCallbacks.clear(); for (const callback of pending) callback({ timeRemaining: () => 50 }); },
    windowEvent: (name, event) => dispatch(windowListeners, name, event),
    documentEvent: (name, event) => dispatch(documentListeners, name, event),
  };
}

test('前台首次完整显示，静止漂动复用位图而不逐帧遍历5745个点', t => {
  const env = createEnvironment(t);
  const handle = mountParticleMark(env.host, env.main, true);
  env.cleanups.push(() => handle.dispose());
  assert.equal(env.ctx.dots.length, 5745);
  assert.ok(env.maxRestDistance() < 1e-10);
  assert.equal(env.fillCount(), 5745, 'the static artwork is rasterized once');
  assert.equal(env.frames.size, 0, 'ambient drift uses the retained canvas transform, without a JS frame loop');
  assert.match(env.host.children[0].style.animation, /codex-particle-mark-float/);
  const drawCount = env.drawCount();
  const rect = env.host.children[0].getBoundingClientRect();
  env.windowEvent('pointermove', { clientX: rect.left + 1, clientY: rect.top + 1 });
  assert.equal(env.frames.size, 0, 'hovering transparent canvas margins does not start particle simulation');
  env.runFrames(360);
  assert.equal(env.fillCount(), 5745);
  assert.equal(env.drawCount(), drawCount);
});

test('后台完整显示，前后台恢复不会重新画点或重播聚合', t => {
  const env = createEnvironment(t, { hidden: true });
  const handle = mountParticleMark(env.host, env.main, false);
  env.cleanups.push(() => handle.dispose());
  assert.equal(env.ctx.dots.length, 5745);
  assert.ok(env.maxRestDistance() < 4, 'only the small ambient drift is allowed before the first frame');
  assert.equal(env.frames.size, 0);
  env.document.hidden = false;
  env.documentEvent('visibilitychange');
  env.runFrames(12);
  assert.equal(env.frames.size, 0);
  assert.equal(env.fillCount(), 5745);
  assert.ok(env.maxRestDistance() < 1e-10);
  assert.equal(env.host.children[0].style.animationPlayState, 'running');
});

test('静态鲨鱼完整绘制5745点与原图RGB，明暗切换保持配色且不加载外部资源', t => {
  const env = createEnvironment(t, { reduced: true });
  const handle = mountParticleMark(env.host, env.main, false);
  env.cleanups.push(() => handle.dispose());
  assert.equal(env.ctx.dots.length, 5745);
  assert.ok(env.maxRestDistance() < 1e-10, 'static points reproduce the confirmed contour');
  const colors = env.ctx.dots.map(dot => dot.color);
  const drawCount = env.drawCount();
  assert.deepEqual(colors, data.points.map(([, , r, g, b]) => `rgb(${r} ${g} ${b})`));
  assert.ok(env.ctx.dots.every(dot => dot.alpha === .9), 'all sampled points use the same soft opacity');
  handle.setDark(true);
  assert.equal(env.drawCount(), drawCount, 'scheme changes do not invalidate identical artwork');
  assert.deepEqual(env.ctx.dots.map(dot => dot.color), colors);
  assert.equal(env.host.children[0].style.mixBlendMode, 'normal');
  assert.equal(env.frames.size, 0);
  assert.equal(env.windowListeners.get('pointermove')?.size || 0, 0);
  assert.deepEqual(env.main.style, { native: 'unchanged' });
  assert.deepEqual(env.host.style, { native: 'unchanged' });
});

test('鼠标局部拨散后恢复缓存轮廓，并停止重绘与模拟循环', t => {
  const env = createEnvironment(t);
  const handle = mountParticleMark(env.host, env.main, true);
  env.cleanups.push(() => handle.dispose());
  assert.ok(env.maxRestDistance() < 1e-10, 'first render is already complete');
  assert.equal(env.ctx.dots.length, 5745);
  assert.ok(env.maxRestDistance() < 4, 'assembly preserves the silhouette, allowing the confirmed idle drift');
  const rect = env.host.children[0].getBoundingClientRect();
  const point = env.ctx.dots[2000];
  env.windowEvent('pointermove', { clientX: rect.left + point.x, clientY: rect.top + point.y });
  env.runFrames(90);
  assert.ok(env.maxRestDistance() > 12, 'pointer pressure visibly moves local particles');
  env.windowEvent('pointermove', { clientX: rect.left + 1, clientY: rect.top + 1 });
  env.runFrames(240);
  assert.ok(env.maxRestDistance() < 1e-10, 'the exact cached image returns after pointer release');
  assert.equal(env.frames.size, 0, 'the settled spring stops its JS loop');
  const drawCount = env.drawCount();
  const fillCount = env.fillCount();
  env.runFrames(120);
  assert.equal(env.drawCount(), drawCount);
  assert.equal(env.fillCount(), fillCount);
  handle.setPointerEnabled(false);
  assert.equal(env.windowListeners.get('pointermove').size, 0);
  handle.setPointerEnabled(true);
  assert.equal(env.windowListeners.get('pointermove').size, 1);
});

test('宽主列显示小版的1.2倍504尺寸，窄列只按实际轮廓边界适配并保持居中', t => {
  const env = createEnvironment(t, { reduced: true });
  const handle = mountParticleMark(env.host, env.main, false);
  env.cleanups.push(() => handle.dispose());
  const holder = env.host.children[0];
  assert.equal(holder.style.left, '720px');
  assert.equal(holder.style.top, '410px');
  assert.equal(holder.style.width, '504px', 'the requested size is 1.2 times the old 420px mark');
  assert.deepEqual([holder.children[0].width, holder.children[0].height], [756, 756]);
  env.resize(360, 400);
  assert.equal(holder.style.width, '451px');
  assert.deepEqual([holder.children[0].width, holder.children[0].height], [677, 677]);
  assert.equal(holder.style.left, '400px');
  assert.equal(holder.style.top, '230px');
  assert.ok(env.maxRestDistance() < 1e-10);
  assert.equal(env.ctx.dots.length, 5745);
  assert.equal(env.frames.size, 0);
  const rect = holder.getBoundingClientRect();
  for (const dot of env.ctx.dots) {
    assert.ok(rect.left + dot.x - dot.width / 2 >= env.main.rect.left);
    assert.ok(rect.left + dot.x + dot.width / 2 <= env.main.rect.left + env.main.rect.width);
    assert.ok(rect.top + dot.y - dot.width / 2 >= env.main.rect.top);
    assert.ok(rect.top + dot.y + dot.width / 2 <= env.main.rect.top + env.main.rect.height);
  }
});

test('聊天锚点切换保留canvas和完整图形，相同尺寸不再清空或重建位图', t => {
  const env = createEnvironment(t);
  const handle = mountParticleMark(env.host, env.main, true);
  env.cleanups.push(() => handle.dispose());
  const holder = env.host.children[0];
  const canvas = holder.children[0];
  const drawCount = env.drawCount();
  const next = env.makeAnchor({ left: 400, top: 100, width: 1000, height: 760 });
  handle.setAnchor(next);
  assert.equal(env.host.children[0], holder);
  assert.equal(holder.children[0], canvas);
  assert.equal(env.canvases.length, 2, 'only the visible canvas and one cached bitmap exist');
  assert.equal(env.drawCount(), drawCount);
  assert.equal(holder.style.left, '880px');
  assert.equal(holder.style.top, '470px');
  assert.equal(env.observers[0].targets.has(env.main), false);
  assert.equal(env.observers[0].targets.has(next), true);
  assert.equal(env.frames.size, 0);
  const narrow = env.makeAnchor({ left: 80, top: 100, width: 360, height: 400 });
  handle.setAnchor(narrow);
  assert.equal(holder.children[0], canvas);
  assert.equal(env.canvases.length, 2);
  assert.equal(env.ctx.dots.length, 5745);
  assert.ok(env.maxRestDistance() < 1e-10);
  assert.equal(env.fillCount(), 5745 * 2, 'only the changed bitmap dimensions rerasterize the artwork');
  assert.equal(env.frames.size, 0);
});

test('重复resize通知和同一锚点不会无变化清空画布', t => {
  const env = createEnvironment(t);
  const handle = mountParticleMark(env.host, env.main, true);
  env.cleanups.push(() => handle.dispose());
  const drawCount = env.drawCount();
  for (let i = 0; i < 20; i++) {
    env.observers[0].callback([]);
    env.windowEvent('resize');
    handle.setAnchor(env.main);
  }
  assert.equal(env.drawCount(), drawCount);
  assert.equal(env.fillCount(), 5745);
});

test('路由短暂无锚点时释放旧DOM观察并隐藏，恢复复用完整位图且不重绘', t => {
  const env = createEnvironment(t);
  const handle = mountParticleMark(env.host, env.main, true);
  env.cleanups.push(() => handle.dispose());
  const holder = env.host.children[0];
  const canvas = holder.children[0];
  const observer = env.observers[0];
  const drawCount = env.drawCount();
  handle.setAnchor(null);
  assert.equal(holder.style.display, 'none');
  assert.equal(holder.style.animationPlayState, 'paused');
  assert.equal(observer.targets.has(env.main), false, 'the old chat DOM is no longer observed');
  assert.deepEqual([...observer.targets], [env.host]);
  const point = env.ctx.dots[2000];
  const rect = holder.getBoundingClientRect();
  env.windowEvent('pointermove', { clientX: rect.left + point.x, clientY: rect.top + point.y });
  observer.callback([]);
  env.windowEvent('resize');
  env.documentEvent('visibilitychange');
  env.runFrames(90);
  assert.equal(env.frames.size, 0, 'hidden artwork cannot start pointer simulation');
  assert.equal(env.drawCount(), drawCount);
  const next = env.makeAnchor({ left: 400, top: 100, width: 1000, height: 760 });
  handle.setAnchor(next);
  assert.equal(holder.style.display, '');
  assert.equal(holder.style.animationPlayState, 'running');
  assert.equal(holder.children[0], canvas);
  assert.equal(env.canvases.length, 2);
  assert.equal(env.drawCount(), drawCount, 'same-size route resume preserves the cached bitmap');
  assert.equal(env.fillCount(), 5745);
  assert.ok(env.maxRestDistance() < 1e-10);
  assert.equal(observer.targets.has(next), true);
  handle.setAnchor(null);
  handle.dispose();
  assert.equal(observer.targets.size, 0);
  assert.equal(env.host.children.length, 0);
});

test('路由空隙暂停交互后复用装饰层，最新锚点恢复完整图形', t => {
  const env = createEnvironment(t);
  const handle = mountDecorations(env.host, env.main, { whale: true, critters: false });
  env.cleanups.push(() => handle.dispose());
  const layer = env.host.children[0];
  const holder = layer.children.find(node => node.attributes['data-codex-particle-mark']);
  const canvas = holder.children[0];
  const rect = holder.getBoundingClientRect();
  const point = env.ctx.dots[2000];
  env.windowEvent('pointermove', { clientX: rect.left + point.x, clientY: rect.top + point.y });
  env.runFrames(5);
  assert.equal(env.frames.size, 1);
  handle.setAnchor(null);
  assert.equal(layer.style.display, 'none');
  assert.equal(env.frames.size, 0, 'transient route removal stops an active spring loop');
  const drawCount = env.drawCount();
  handle.setAnchor(env.makeAnchor({ left: 400, top: 100, width: 1000, height: 760 }));
  assert.equal(layer.style.display, '');
  assert.equal(holder.children[0], canvas);
  assert.equal(env.drawCount(), drawCount);
  assert.ok(env.maxRestDistance() < 1e-10);
});

test('装饰层切换锚点复用鲨鱼节点，关闭再开启仍使用最新锚点', t => {
  const env = createEnvironment(t);
  const handle = mountDecorations(env.host, env.main, { whale: true, critters: false });
  env.cleanups.push(() => handle.dispose());
  const layer = env.host.children[0];
  const holder = layer.children.find(node => node.attributes['data-codex-particle-mark']);
  const canvas = holder.children[0];
  const next = env.makeAnchor({ left: 400, top: 100, width: 1000, height: 760 });
  handle.setAnchor(next);
  assert.equal(holder.children[0], canvas);
  assert.equal(env.canvases.length, 2);
  assert.equal(holder.style.left, '880px');
  handle.update({ whale: false });
  handle.setAnchor(env.main);
  handle.update({ whale: true });
  const replacement = layer.children.find(node => node.attributes['data-codex-particle-mark']);
  assert.equal(replacement.style.left, '720px');
  assert.equal(replacement.children[0].context.dots.length, 5745);
});

test('隐藏停止RAF，恢复只启一个循环，销毁释放观察器和所有已登记事件', t => {
  const env = createEnvironment(t);
  const handle = mountParticleMark(env.host, env.main, false);
  env.cleanups.push(() => handle.dispose());
  const rect = env.host.children[0].getBoundingClientRect();
  const point = env.ctx.dots[2000];
  env.windowEvent('pointermove', { clientX: rect.left + point.x, clientY: rect.top + point.y });
  env.runFrames(5);
  env.document.hidden = true;
  env.documentEvent('visibilitychange');
  assert.equal(env.frames.size, 0);
  assert.equal(env.host.children[0].style.animationPlayState, 'paused');
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
  handle.setAnchor(env.main);
  assert.equal(env.drawCount(), disposedDrawCount);
  assert.equal(env.frames.size, 0);
});

test('不支持canvas的环境释放占位节点并返回可安全销毁的句柄', t => {
  const env = createEnvironment(t, { noContext: true });
  const handle = mountParticleMark(env.host, env.main, true);
  assert.equal(env.host.children.length, 0);
  assert.equal(env.frames.size, 0);
  assert.equal(env.observers.length, 0);
  assert.doesNotThrow(() => { handle.setAnchor(env.main); handle.setDark(false); handle.setPointerEnabled(false); handle.dispose(); });
});

test('GPU预热只编译上传一次，爆散聚合不逐帧画2D点，快速重播只有一个循环', t => {
  const gpu = createTestGL();
  const env = createEnvironment(t, { gpu });
  const handle = mountParticleMark(env.host, env.main, true);
  env.cleanups.push(() => handle.dispose());
  const holder = env.host.children[0];
  const canvas = holder.children[0];
  env.runIdle();
  assert.deepEqual([gpu.counts.shaders, gpu.counts.programs, gpu.counts.uploads], [2, 1, 1]);
  assert.equal(gpu.counts.draws, 1, 'idle warmup includes one hidden driver draw before route switching');
  assert.match(env.canvases[2].style.cssText, /display:none/);
  const fills = env.fillCount();
  handle.replayAssembly();
  env.runFrames(8);
  assert.equal(canvas.style.visibility, 'hidden');
  assert.equal(env.fillCount(), fills, 'GPU assembly performs no per-dot Canvas2D writes');
  assert.ok(gpu.draws.some(draw => draw.uniforms.u_displacement > .9), 'the burst expands before returning');
  for (let i = 0; i < 20; i++) handle.replayAssembly();
  assert.equal(env.frames.size, 1);
  assert.equal(gpu.counts.uploads, 1);
  assert.equal(gpu.counts.shaders, 2);
  env.runFrames(40);
  assert.equal(env.frames.size, 0);
  assert.equal(canvas.style.visibility, '');
  assert.equal(env.fillCount(), fills);
  assert.ok(env.maxRestDistance() < 1e-10);
  assert.equal(env.canvases.length, 3, 'one retained assembly canvas joins the two cached canvases');
  const draws = gpu.counts.draws;
  handle.setAnchor(env.makeAnchor({ left: 400, top: 100, width: 1000, height: 760 }));
  env.windowEvent('resize');
  env.runFrames(20);
  assert.equal(gpu.counts.draws, draws, 'anchor and resize changes never replay assembly');
  handle.dispose();
  assert.deepEqual([gpu.counts.deletedBuffers, gpu.counts.deletedPrograms, gpu.counts.deletedShaders, gpu.counts.deletedVaos], [1, 1, 2, 1]);
  assert.equal(env.idleCallbacks.size, 0);
});

test('后台请求只保留最新一次，前台后播放完整聚合；null锚点取消待播和运行', t => {
  const gpu = createTestGL();
  const env = createEnvironment(t, { hidden: true, gpu });
  const handle = mountParticleMark(env.host, env.main, true);
  env.cleanups.push(() => handle.dispose());
  env.runIdle();
  handle.replayAssembly();
  handle.replayAssembly();
  assert.equal(env.frames.size, 0);
  assert.equal(gpu.counts.draws, 1, 'only the hidden preheat draw occurs in the background');
  env.document.hidden = false;
  env.documentEvent('visibilitychange');
  assert.equal(env.frames.size, 1);
  env.runFrames(5);
  assert.ok(gpu.counts.draws > 0);
  env.document.hidden = true;
  env.documentEvent('visibilitychange');
  const draws = gpu.counts.draws;
  env.runFrames(20);
  assert.equal(env.frames.size, 0);
  assert.equal(gpu.counts.draws, draws);
  handle.setAnchor(null);
  env.document.hidden = false;
  env.documentEvent('visibilitychange');
  handle.setAnchor(env.main);
  env.runFrames(40);
  assert.equal(gpu.counts.draws, draws, 'route removal discards the old pending replay');
  handle.replayAssembly();
  assert.equal(env.frames.size, 1);
  handle.setAnchor(null);
  assert.equal(env.frames.size, 0);
});

test('减少动画跳过聚合与GPU预热，销毁能取消尚未执行的预热任务', t => {
  const gpu = createTestGL();
  const env = createEnvironment(t, { reduced: true, gpu });
  const handle = mountParticleMark(env.host, env.main, true);
  handle.replayAssembly();
  env.runIdle();
  assert.equal(env.frames.size, 0);
  assert.equal(gpu.counts.shaders, 0);
  assert.equal(env.fillCount(), 5745);
  handle.dispose();
  const other = mountParticleMark(env.host, env.main, true);
  other.dispose();
  env.runIdle();
  assert.equal(env.idleCallbacks.size, 0);
});

test('GPU不可用的CPU降级有有限时长，回到缓存且不会每次重试编译', t => {
  const gpu = createTestGL({ compile: false });
  const env = createEnvironment(t, { gpu });
  const handle = mountParticleMark(env.host, env.main, true);
  env.cleanups.push(() => handle.dispose());
  env.runIdle();
  assert.equal(gpu.counts.shaders, 1);
  assert.equal(gpu.counts.deletedShaders, 1);
  handle.replayAssembly();
  env.runFrames(40);
  assert.equal(env.frames.size, 0);
  assert.ok(env.fillCount() > 5745);
  assert.ok(env.fillCount() <= 5745 * 17, '900ms fallback is limited to about 15 frames per second');
  assert.ok(env.maxRestDistance() < 1e-10);
  handle.replayAssembly();
  handle.setAnchor(null);
  assert.equal(env.frames.size, 0);
  assert.equal(gpu.counts.shaders, 1, 'a failed GPU is not synchronously retried on each chat');
});

test('销毁取消未执行的GPU预热，旧回调不能创建renderer或再次播放', t => {
  const gpu = createTestGL();
  const env = createEnvironment(t, { gpu });
  const handle = mountParticleMark(env.host, env.main, true);
  assert.equal(env.idleCallbacks.size, 1);
  const prepare = [...env.idleCallbacks.values()][0];
  handle.dispose();
  assert.equal(env.idleCallbacks.size, 0);
  prepare();
  handle.replayAssembly();
  env.runIdle();
  assert.equal(gpu.counts.shaders, 0);
  assert.equal(env.frames.size, 0);
  assert.equal(env.host.children.length, 0);
});

test('第一次快速切换仅等待预热，不在路由切换路径同步编译或上传', t => {
  const gpu = createTestGL();
  const env = createEnvironment(t, { gpu });
  const handle = mountParticleMark(env.host, env.main, true);
  env.cleanups.push(() => handle.dispose());
  for (let i = 0; i < 20; i++) handle.replayAssembly();
  assert.equal(gpu.counts.shaders, 0);
  assert.equal(gpu.counts.uploads, 0);
  assert.equal(env.frames.size, 0);
  assert.equal(env.idleCallbacks.size, 1, 'quick requests share the same preheat task');
  env.runIdle();
  assert.equal(gpu.counts.uploads, 1);
  assert.equal(env.frames.size, 1, 'the latest request starts after warmup completes');
  env.runFrames(40);
  assert.equal(env.frames.size, 0);
  assert.equal(env.fillCount(), 5745);
});

test('首次入口等待预热时隐藏完整静态图，随后一次播放爆炸聚合', t => {
  const gpu = createTestGL();
  const env = createEnvironment(t, { gpu });
  const handle = mountParticleMark(env.host, env.main, true, true, { replayOnMount: true });
  env.cleanups.push(() => handle.dispose());
  const holder = env.host.children[0];
  const canvas = holder.children[0];
  assert.equal(canvas.style.visibility, 'hidden', 'the first paint cannot expose the complete static shark while waiting');
  assert.equal(holder.style.animationPlayState, 'paused');
  assert.equal(gpu.counts.shaders, 0, 'entrance does not synchronously compile on the mounting path');
  env.runIdle();
  assert.equal(env.canvases[2].style.display, 'block');
  assert.equal(canvas.style.visibility, 'hidden');
  env.runFrames(8);
  assert.ok(gpu.draws.some(draw => draw.uniforms.u_displacement > .9), 'the entrance visibly expands before reassembly');
  env.runFrames(32);
  assert.equal(env.frames.size, 0);
  assert.equal(canvas.style.visibility, '');
  assert.equal(holder.style.animationPlayState, 'running');
  assert.equal(env.fillCount(), 5745, 'the entrance still reuses its one retained rest bitmap');
  assert.ok(env.maxRestDistance() < 1e-10);
});

test('165Hz屏幕聚合最多60次每秒GPU绘制，900ms内保留完整爆炸和返回', t => {
  const gpu = createTestGL();
  const env = createEnvironment(t, { gpu });
  const handle = mountParticleMark(env.host, env.main, true);
  env.cleanups.push(() => handle.dispose());
  env.runIdle();
  const before = gpu.counts.draws;
  handle.replayAssembly();
  env.runFrames(148, 1000 / 165);
  assert.equal(env.frames.size, 1, 'animation remains active until its full 900ms has elapsed');
  assert.ok(gpu.counts.draws - before >= 52, 'the high-refresh path retains about 60 drawing frames a second');
  assert.ok(gpu.counts.draws - before <= 55, '165Hz does not generate 148 GPU frames per entrance');
  assert.ok(gpu.draws.some(draw => draw.uniforms.u_displacement > .99));
  assert.ok(gpu.draws.at(-1).uniforms.u_displacement < .01);
  env.runFrames(3, 1000 / 165);
  assert.equal(env.frames.size, 0);
  assert.equal(env.canvases[0].style.visibility, '');
  assert.ok(env.maxRestDistance() < 1e-10);
});

test('装饰入口选项只在实际创建时播放，后台首次显示等待可见', t => {
  const gpu = createTestGL();
  const env = createEnvironment(t, { gpu, hidden: true });
  const handle = mountDecorations(env.host, env.main, { whale: true, critters: false, replayOnMount: true });
  env.cleanups.push(() => handle.dispose());
  const layer = env.host.children[0];
  const holder = layer.children.find(node => node.attributes['data-codex-particle-mark']);
  assert.equal(holder.children[0].style.visibility, 'hidden');
  env.runIdle();
  assert.equal(env.frames.size, 0, 'a background mount waits for visible entrance');
  env.document.hidden = false;
  env.documentEvent('visibilitychange');
  env.runFrames(40);
  const draws = gpu.counts.draws;
  handle.update({ dark: false, pointer: true });
  env.runFrames(40);
  assert.equal(gpu.counts.draws, draws, 'updating settings does not replay an existing shark');
});

test('减少动画时首次入口直接保留完整静态图并跳过GPU预热', t => {
  const gpu = createTestGL();
  const env = createEnvironment(t, { reduced: true, gpu });
  const handle = mountParticleMark(env.host, env.main, true, true, { replayOnMount: true });
  env.cleanups.push(() => handle.dispose());
  assert.notEqual(env.canvases[0].style.visibility, 'hidden');
  assert.equal(env.host.children[0].style.animation, 'none');
  env.runIdle();
  assert.equal(gpu.counts.shaders, 0);
  assert.equal(env.frames.size, 0);
  assert.equal(env.fillCount(), 5745);
});

test('入口尚待预热时短暂空锚点保留入场意图，恢复后只播放一次', t => {
  const gpu = createTestGL();
  const env = createEnvironment(t, { gpu });
  const handle = mountParticleMark(env.host, env.main, true, true, { replayOnMount: true });
  env.cleanups.push(() => handle.dispose());
  handle.setAnchor(null);
  env.runIdle();
  assert.equal(env.frames.size, 0, 'initial warmup cannot play against a removed chat column');
  const warmedDraws = gpu.counts.draws;
  handle.setAnchor(env.main);
  handle.setAnchor(env.main);
  assert.equal(env.frames.size, 1, 'restoring the first chat starts exactly one entrance');
  assert.equal(env.canvases[0].style.visibility, 'hidden');
  env.runFrames(40);
  assert.equal(env.frames.size, 0);
  assert.ok(gpu.draws.slice(warmedDraws).some(draw => draw.uniforms.u_displacement > .9));
  assert.equal(gpu.counts.uploads, 1);
  assert.ok(env.maxRestDistance() < 1e-10);
});

test('入口运行中短暂空锚点停止绘制，恢复后重新播放完整900ms入场', t => {
  const gpu = createTestGL();
  const env = createEnvironment(t, { gpu });
  const handle = mountParticleMark(env.host, env.main, true, true, { replayOnMount: true });
  env.cleanups.push(() => handle.dispose());
  env.runIdle();
  env.runFrames(8);
  handle.setAnchor(null);
  const stoppedDraws = gpu.counts.draws;
  env.runFrames(40);
  assert.equal(env.frames.size, 0);
  assert.equal(gpu.counts.draws, stoppedDraws);
  const next = env.makeAnchor({ left: 400, top: 100, width: 1000, height: 760 });
  handle.setAnchor(next);
  env.runFrames(27);
  assert.equal(env.frames.size, 1, 'the resumed entrance gets its own full duration rather than the remainder');
  assert.ok(gpu.draws.slice(stoppedDraws).some(draw => draw.uniforms.u_displacement > .9));
  env.runFrames(2);
  assert.equal(env.frames.size, 0);
  assert.equal(env.canvases[0].style.visibility, '');
  assert.ok(env.maxRestDistance() < 1e-10);
});

test('入口完成后的空锚点和已取消聊天重播恢复静态，不再次启动入场', t => {
  const gpu = createTestGL();
  const env = createEnvironment(t, { gpu });
  const handle = mountParticleMark(env.host, env.main, true, true, { replayOnMount: true });
  env.cleanups.push(() => handle.dispose());
  env.runIdle();
  env.runFrames(40);
  const completedDraws = gpu.counts.draws;
  handle.setAnchor(null);
  handle.setAnchor(env.main);
  env.runFrames(40);
  assert.equal(env.frames.size, 0);
  assert.equal(gpu.counts.draws, completedDraws, 'a finished entrance does not replay on every route gap');
  handle.replayAssembly();
  env.runFrames(4);
  handle.setAnchor(null);
  const cancelledDraws = gpu.counts.draws;
  handle.setAnchor(env.main);
  env.runFrames(40);
  assert.equal(env.frames.size, 0);
  assert.equal(gpu.counts.draws, cancelledDraws, 'later chat replays retain cancel-on-removal behavior');
});

test('尚未完成的入口显式重播合并最新请求，后台恢复等待前台，销毁无残余循环', t => {
  const gpu = createTestGL();
  const env = createEnvironment(t, { gpu });
  const handle = mountParticleMark(env.host, env.main, true, true, { replayOnMount: true });
  for (let i = 0; i < 8; i++) handle.replayAssembly();
  handle.setAnchor(null);
  env.runIdle();
  env.document.hidden = true;
  handle.setAnchor(env.main);
  assert.equal(env.frames.size, 0);
  assert.equal(env.canvases[0].style.visibility, 'hidden');
  env.document.hidden = false;
  env.documentEvent('visibilitychange');
  assert.equal(env.frames.size, 1, 'pending entrance requests share a single visible replay');
  env.runFrames(4);
  handle.setAnchor(null);
  handle.dispose();
  handle.setAnchor(env.main);
  env.documentEvent('visibilitychange');
  env.runFrames(40);
  assert.equal(env.frames.size, 0);
  assert.equal(gpu.counts.uploads, 1);
  assert.equal(env.host.children.length, 0);
});
