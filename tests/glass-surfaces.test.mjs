// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: [fileURLToPath(new URL('../src/skin/surfaces.ts', import.meta.url))],
  bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent' });
const { mountGlassSurfaces } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

function environment(t) {
  const globals = ['document', 'window', 'Element', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver', 'IntersectionObserver', 'MutationObserver'];
  const saved = new Map(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let handle;
  t.after(() => { handle?.dispose(); for (const [key, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
  } });
  const frames = new Map(), timers = new Map(), windowListeners = new Map(), documentListeners = new Map(), observers = [];
  let id = 0, reads = 0;
  class Style {
    values = new Map();
    getPropertyValue(key) { return this.values.get(key) || ''; }
    setProperty(key, value) { this.values.set(key, value); }
    removeProperty(key) { this.values.delete(key); }
  }
  class Element {
    style = new Style(); dataset = {}; children = []; hidden = false; isConnected = true; parentNode = null;
    clientLeft = 0; clientTop = 0; scrollLeft = 0; scrollTop = 0;
    bounds = { left: 50, top: 80, width: 600, height: 140 }; opacity = '1'; cornerRadius = '22px';
    setAttribute() {}
    appendChild(element) { element.parentNode = this; this.children.push(element); }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(item => item !== this); this.isConnected = false; }
    closest() { return this.parentNode === host || this === host ? host : null; }
    contains(other) { for (let node = other; node; node = node.parentNode) if (node === this) return true; return false; }
    getBoundingClientRect() { reads++; return { ...this.bounds, right: this.bounds.left + this.bounds.width, bottom: this.bounds.top + this.bounds.height }; }
    getClientRects() { return this.hidden ? [] : [this.bounds]; }
    checkVisibility() { return !this.hidden; }
  }
  class Observer {
    targets = new Set(); disconnected = false;
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(target) { this.targets.add(target); }
    unobserve(target) { this.targets.delete(target); }
    disconnect() { this.targets.clear(); this.disconnected = true; }
  }
  const listen = (map, name, callback) => { if (!map.has(name)) map.set(name, new Set()); map.get(name).add(callback); };
  const host = new Element(); host.bounds = { left: 0, top: 0, width: 1200, height: 900 };
  const element = new Element();
  const document = { hidden: false, body: new Element(), createElement() { return new Element(); },
    addEventListener(name, callback) { listen(documentListeners, name, callback); }, removeEventListener(name, callback) { documentListeners.get(name)?.delete(callback); } };
  Object.assign(globalThis, {
    Element, document, window: {
      addEventListener(name, callback) { listen(windowListeners, name, callback); }, removeEventListener(name, callback) { windowListeners.get(name)?.delete(callback); },
      setTimeout(callback) { const key = ++id; timers.set(key, callback); return key; }, clearTimeout(key) { timers.delete(key); },
    },
    getComputedStyle(target) { return { display: 'block', visibility: 'visible', opacity: target.opacity, getPropertyValue() { return target.cornerRadius; } }; },
    requestAnimationFrame(callback) { const key = ++id; frames.set(key, callback); return key; }, cancelAnimationFrame(key) { frames.delete(key); },
    ResizeObserver: Observer, IntersectionObserver: Observer, MutationObserver: Observer,
  });
  function frame() { const pending = [...frames.values()]; frames.clear(); for (const callback of pending) callback(16); }
  function settle() { const pending = [...timers.values()]; timers.clear(); for (const callback of pending) callback(); }
  function fire(map, name) { for (const callback of map.get(name) || []) callback(); }
  handle = mountGlassSurfaces(host);
  handle.sync([{ element, kind: 'composer' }]); frame();
  return { handle, host, element, frames, timers, observers, document, frame, settle, reads: () => reads,
    windowListeners, documentListeners, fire };
}

function rotations(surface) {
  const transform = surface.style.getPropertyValue('transform');
  return { x: Number(transform.match(/rotateX\(([^r]+)rad\)/)?.[1]), y: Number(transform.match(/rotateY\(([^r]+)rad\)/)?.[1]) };
}

test('square native composer corners match the rounded sidebar while panels keep their native corners', t => {
  const env = environment(t), surface = env.host.children[0];
  env.element.cornerRadius = '0px';
  const cornerProperties = ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'];
  env.handle.sync([{ element: env.element, kind: 'composer' }]); env.frame();
  for (const property of cornerProperties) assert.equal(surface.style.getPropertyValue(property), '26px');
  env.handle.sync([{ element: env.element, kind: 'sidebar' }]); env.frame();
  for (const property of cornerProperties) assert.equal(surface.style.getPropertyValue(property), '26px');
  env.element.cornerRadius = '14px';
  env.handle.sync([{ element: env.element, kind: 'panel' }]); env.frame();
  for (const property of cornerProperties) assert.equal(surface.style.getPropertyValue(property), '14px');
  assert.equal(env.element.style.values.size, 0, 'painting corners does not mutate the native input hitbox');
});

test('disconnecting a composer removes its glass and pending press cleanup', t => {
  const env = environment(t);
  env.handle.updatePointer(env.element, { x: 600, y: 150, press: true, spotlight: true }); env.frame();
  env.handle.clearPointer();
  assert.equal(env.timers.size, 1);
  env.element.isConnected = false;
  env.handle.sync([{ element: env.element, kind: 'composer' }]); env.frame();
  assert.equal(env.host.children.length, 0);
  assert.equal(env.handle.getStatus().count, 0);
  assert.equal(env.frames.size, 0); assert.equal(env.timers.size, 0);
});

test('pointer bursts use cached geometry and the cursor edge sinks in the DSH direction', t => {
  const env = environment(t), surface = env.host.children[0], initialReads = env.reads();
  assert.equal(env.frames.size, 0, 'a stationary surface has no recurring frame');
  for (let index = 0; index < 30; index++) env.handle.updatePointer(env.element, { x: 50, y: 150, press: true, spotlight: true });
  assert.equal(env.frames.size, 1, 'rapid pointer events share one paint');
  env.frame();
  assert.equal(env.reads(), initialReads, 'hover performs no forced layout reads');
  assert.ok(rotations(surface).y < 0, 'left edge sinks');
  env.handle.updatePointer(env.element, { x: 650, y: 150, press: true, spotlight: true }); env.frame();
  assert.ok(rotations(surface).y > 0, 'right edge sinks');
  env.handle.sync([{ element: env.element, kind: 'sidebar' }]); env.frame();
  assert.equal(surface.style.getPropertyValue('border-top-left-radius'), '26px');
  env.handle.updatePointer(env.element, { x: 350, y: 80, press: true, spotlight: true }); env.frame();
  assert.ok(rotations(surface).x > 0, 'upper sidebar edge sinks');
  env.handle.updatePointer(env.element, { x: 350, y: 220, press: true, spotlight: true }); env.frame();
  assert.ok(rotations(surface).x < 0, 'lower sidebar edge sinks');
  assert.equal(env.frames.size, 0);
  env.observers[2].callback([{ target: surface }, { target: env.document.body }]);
  assert.equal(env.frames.size, 0, 'own paint and unrelated styles cannot restart layout work');
  assert.equal(env.element.style.values.size, 0, 'native controls retain their geometry');
});

test('leaving glides to neutral, reentering cancels cleanup, and removal releases timers', t => {
  const env = environment(t), surface = env.host.children[0];
  const options = { x: 600, y: 150, press: true, spotlight: true };
  env.handle.updatePointer(env.element, options); env.frame();
  env.handle.clearPointer();
  assert.deepEqual(rotations(surface), { x: 0, y: 0 });
  assert.equal(surface.style.getPropertyValue('--cg-glow-x'), '');
  assert.equal(env.timers.size, 1);
  env.handle.updatePointer(env.element, options); env.frame();
  assert.equal(env.timers.size, 0);
  env.handle.clearPointer(); env.settle();
  assert.equal(surface.style.getPropertyValue('transform'), '');
  env.handle.updatePointer(env.element, options); env.frame(); env.handle.clearPointer();
  env.handle.sync([]);
  assert.equal(env.timers.size, 0);
  assert.equal(env.frames.size, 0);
  assert.equal(env.host.children.length, 0);
});

test('resize and scroll refresh bounds once while visibility changes do not leave ghosts', t => {
  const env = environment(t), surface = env.host.children[0], initialReads = env.reads();
  env.element.bounds.width = 720;
  for (const observer of env.observers.slice(0, 2)) observer.callback([]);
  env.fire(env.documentListeners, 'scroll');
  assert.equal(env.frames.size, 1);
  env.frame();
  assert.equal(env.reads(), initialReads + 2, 'one host and one target measurement');
  assert.equal(surface.style.getPropertyValue('width'), '720px');
  env.element.hidden = true;
  env.observers[2].callback([{ target: env.element }]); env.frame();
  assert.equal(surface.hidden, true);
  env.element.hidden = false;
  env.observers[2].callback([{ target: env.element }]); env.frame();
  assert.equal(surface.hidden, false);
  assert.equal(env.frames.size, 0);
});

test('hidden windows pause pending paints and disposal removes all wakeups', t => {
  const env = environment(t);
  env.handle.updatePointer(env.element, { x: 600, y: 150, press: true, spotlight: true });
  env.document.hidden = true; env.fire(env.documentListeners, 'visibilitychange');
  assert.equal(env.frames.size, 0);
  env.fire(env.windowListeners, 'resize');
  assert.equal(env.frames.size, 0);
  env.document.hidden = false; env.fire(env.documentListeners, 'visibilitychange');
  assert.equal(env.frames.size, 1); env.frame();
  env.handle.dispose();
  assert.ok(env.observers.every(observer => observer.disconnected));
  assert.equal(env.frames.size, 0); assert.equal(env.timers.size, 0);
  for (const listeners of [...env.windowListeners.values(), ...env.documentListeners.values()]) assert.equal(listeners.size, 0);
});

test('background hot-load paints complete static glass even while RAF is suspended', t => {
  const env = environment(t);
  env.handle.sync([]);
  env.document.hidden = true;
  env.handle.sync([{ element: env.element, kind: 'sidebar' }]);
  assert.equal(env.frames.size, 0);
  assert.equal(env.handle.getStatus().visible, 1);
  const surface = env.host.children[0];
  assert.equal(surface.hidden, false);
  assert.equal(surface.style.getPropertyValue('width'), '600px');
  assert.equal(surface.style.getPropertyValue('border-top-left-radius'), '26px');
});
