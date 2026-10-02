// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// Exercise the real discovery/observer code. Only its drawing modules are
// replaced: these tests count replay requests without emulating the shader.
const modules = {
  '../core/backdrop.ts': 'export function mountFluidBackdrop(){const state=globalThis.__runtimeAssemblyTest;state.backdropMounts++;return {update(){},dispose(){state.backdropDisposals++},getStatus(){return {running:true}}}}',
  '../core/fluid-tones.ts': 'export const HUE_BASE=0',
  '../decorations/index.ts': `export function mountDecorations(host,anchor,options){
    const state=globalThis.__runtimeAssemblyTest;state.mounts++;
    if(options?.replayOnMount)state.initialAssemblies++;
    return {setAnchor(next){state.anchors.push(next)},replayAssembly(){state.replays++},update(){},dispose(){state.disposals++}};
  }`,
  './panel.ts': 'export function mountSettingsPanel(){return {sync(){},dispose(){},open(){}}}',
  './native-settings.ts': 'export function mountNativeSettingsEntry(){return {sync(){},dispose(){}}}',
  './surfaces.ts': 'export function mountGlassSurfaces(){const state=globalThis.__runtimeAssemblyTest;state.materialMounts++;return {sync(targets){state.metrics.surfaceSyncs++;state.surfaces=targets},updatePointer(){},clearPointer(){},getStatus(){return {}},dispose(){state.materialDisposals++}}}',
  './material.ts': 'export const MATERIAL_CSS=""',
};
const bundled = await build({
  entryPoints: [fileURLToPath(new URL('../src/skin/runtime.ts', import.meta.url))],
  bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent',
  plugins: [{ name: 'drawing-spies', setup(build) {
    build.onResolve({ filter: /\.ts$/ }, args => Object.hasOwn(modules, args.path) ? { path: args.path, namespace: 'drawing-spies' } : undefined);
    build.onLoad({ filter: /.*/, namespace: 'drawing-spies' }, args => ({ contents: modules[args.path], loader: 'js' }));
  } }],
});
const { mountCodexSkin } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);

function fixture(t, { identity = 'chat-a-private', cached = false, savedSettings = null } = {}) {
  const globalNames = ['document', 'window', 'Element', 'MutationObserver', 'matchMedia', 'location', 'localStorage', 'requestAnimationFrame', 'cancelAnimationFrame', '__runtimeAssemblyTest'];
  const saved = new Map(globalNames.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const observers = [], listeners = new Map(), frames = new Map();
  const metrics = { discoverySubtreeQueries: 0, visibilityReads: 0, surfaceSyncs: 0 };
  let nextFrame = 0;
  let runtime;
  t.after(() => {
    runtime?.dispose();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  });

  function notify(change) {
    for (const observer of observers) if (!observer.disconnected && observer.targets.some(({ target, options }) =>
      (change.target === target || options.subtree && target.contains(change.target)) &&
      (change.type === 'childList' ? options.childList : options.attributes && (!options.attributeFilter || options.attributeFilter.includes(change.attributeName))))) {
      observer.callback([change]);
    }
  }
  class Style {
    values = new Map();
    getPropertyValue(name) { return this.values.get(name) || ''; }
    getPropertyPriority() { return ''; }
    setProperty(name, value) { this.values.set(name, value); }
    removeProperty(name) { this.values.delete(name); }
  }
  class Element {
    constructor(tagName = 'div') { this.tagName = tagName.toUpperCase(); }
    attributes = new Map(); children = []; parentNode = null; style = new Style(); dataset = {}; visible = true; root = false;
    classList = { contains: name => (this.className || '').split(/\s+/).includes(name) };
    get className() { return this.getAttribute('class') || ''; }
    set className(value) { this.setAttribute('class', value); }
    get isConnected() { return this.root || !!this.parentNode?.isConnected; }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    hasAttribute(name) { return this.attributes.has(name); }
    setAttribute(name, value) { this.attributes.set(name, String(value)); notify({ type: 'attributes', target: this, attributeName: name }); }
    removeAttribute(name) { this.attributes.delete(name); notify({ type: 'attributes', target: this, attributeName: name }); }
    append(...nodes) {
      for (const node of nodes) { node.remove(); node.parentNode = this; this.children.push(node); }
      notify({ type: 'childList', target: this, addedNodes: nodes, removedNodes: [] });
    }
    prepend(...nodes) {
      for (const node of nodes) { node.remove(); node.parentNode = this; }
      this.children.unshift(...nodes); notify({ type: 'childList', target: this, addedNodes: nodes, removedNodes: [] });
    }
    remove() {
      if (!this.parentNode) return;
      const parent = this.parentNode;
      parent.children = parent.children.filter(node => node !== this); this.parentNode = null;
      notify({ type: 'childList', target: parent, addedNodes: [], removedNodes: [this] });
    }
    contains(other) { return this === other || this.children.some(node => node.contains(other)); }
    matches(selector) {
      if (selector.includes(':is(')) return this.hasAttribute('data-settings-card');
      return selector.split(',').some(part => {
        part = part.trim();
        const tag = part.match(/^([a-z]+)/i)?.[1];
        if (tag && tag.toUpperCase() !== this.tagName) return false;
        const id = part.match(/#([\w-]+)/)?.[1];
        if (id && this.getAttribute('id') !== id) return false;
        for (const [, name] of part.matchAll(/\.([\w-]+)/g)) if (!this.classList.contains(name)) return false;
        for (const [, name, value] of part.matchAll(/\[([^\]=]+)(?:="([^"]*)")?\]/g)) {
          if (!this.hasAttribute(name) || value !== undefined && this.getAttribute(name) !== value) return false;
        }
        return true;
      });
    }
    closest(selector) { for (let node = this; node; node = node.parentNode) if (node.matches(selector)) return node; return null; }
    querySelectorAll(selector) {
      const results = [];
      for (const node of this.children) { if (node.matches(selector)) results.push(node); results.push(...node.querySelectorAll(selector)); }
      return results;
    }
    querySelector(selector) {
      if (selector.includes('[data-density]')) metrics.discoverySubtreeQueries++;
      return this.querySelectorAll(selector)[0] || null;
    }
    getClientRects() { metrics.visibilityReads++; return this.isConnected ? [{}] : []; }
    getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600 }; }
    checkVisibility() { for (let node = this; node; node = node.parentNode) if (!node.visible || node.hasAttribute('hidden')) return false; return this.isConnected; }
  }
  class Observer {
    constructor(callback) { this.callback = callback; this.targets = []; this.disconnected = false; observers.push(this); }
    observe(target, options) { this.targets.push({ target, options }); }
    disconnect() { this.disconnected = true; this.targets = []; }
  }
  const root = new Element('html'); root.root = true;
  const head = new Element('head'), body = new Element('body'); root.append(head, body);
  const addListener = (name, callback) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(callback); };
  const document = { documentElement: root, head, body, hidden: false, createElement: tag => new Element(tag),
    querySelectorAll: selector => root.querySelectorAll(selector), querySelector: selector => root.querySelector(selector),
    addEventListener: addListener, removeEventListener: (name, callback) => listeners.get(name)?.delete(callback) };
  const state = { mounts: 0, initialAssemblies:0, replays: 0, disposals: 0, anchors: [], backdropMounts:0, backdropDisposals:0, materialMounts:0, materialDisposals:0, surfaces:[], metrics };
  let stored = savedSettings && JSON.stringify(savedSettings);
  Object.assign(globalThis, { document, Element, MutationObserver: Observer, __runtimeAssemblyTest: state,
    window: { addEventListener: addListener, removeEventListener: (name, callback) => listeners.get(name)?.delete(callback) },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), location: { protocol: 'app:' },
    requestAnimationFrame: callback => { frames.set(++nextFrame, callback); return nextFrame; },
    cancelAnimationFrame: id => frames.delete(id),
    localStorage: { getItem() { return stored; }, setItem(key,value) { stored=value; } } });
  const sidebar = new Element('aside'); sidebar.setAttribute('data-app-shell-left-panel-appearance', 'default'); body.append(sidebar);
  const settingsSearch = new Element('input'); settingsSearch.setAttribute('id', 'settings-search'); settingsSearch.visible = false; sidebar.append(settingsSearch);
  function chat(key) {
    const main = new Element('main'); main.setAttribute('data-app-shell-main-surface', 'default');
    const layout = new Element(); layout.setAttribute('data-app-shell-main-content-layout', ''); main.append(layout);
    const footer = new Element(); footer.setAttribute('data-thread-scroll-footer', ''); layout.append(footer);
    const composer = new Element(); composer.setAttribute('data-codex-composer-root', ''); footer.append(composer);
    const surface = new Element(); surface.setAttribute('data-composer-surface-variant', 'default'); composer.append(surface);
    const marker = new Element(); if (key !== null) marker.setAttribute('data-above-composer-conversation-id', key); composer.append(marker);
    return { main, layout, footer, composer, surface, marker };
  }
  const current = chat(identity);
  if (cached) { const old = chat('cached-private'); old.main.visible = false; body.append(old.main); }
  body.append(current.main);
  runtime = mountCodexSkin();
  async function microtasks() { await Promise.resolve(); await Promise.resolve(); }
  function frame() {
    const callbacks = [...frames.values()]; frames.clear();
    for (const callback of callbacks) callback(16);
  }
  async function flush() { await microtasks(); frame(); await microtasks(); }
  return { ...current, document, body, root, runtime, state, settingsSearch, chat, flush, microtasks, frame, frames, observers, listeners, metrics, stored:() => stored,
    setHidden(value) { document.hidden = value; for (const callback of listeners.get('visibilitychange') || []) callback(); },
    changed(element = current.main) { notify({ type: 'attributes', target: element, attributeName: 'class' }); } };
}

test('first visible chat requests an initial assembly once; different identities replay once', async t => {
  const env = fixture(t, { cached: true });
  assert.equal(env.state.mounts, 1); assert.equal(env.state.replays, 0);
  assert.equal(env.state.initialAssemblies,1, 'the retained decorations play their initial assembly on mount');
  env.changed(); await env.flush();
  assert.equal(env.state.replays, 0, 'same chat layout scans preserve the initial assembly');
  assert.equal(env.state.initialAssemblies,1);
  env.marker.setAttribute('data-above-composer-conversation-id', 'chat-b-private');
  for (let index = 0; index < 10; index++) env.changed();
  await env.flush();
  assert.equal(env.state.replays, 1, 'identity and layout mutation bursts request one replay');
  env.marker.setAttribute('data-above-composer-conversation-id', 'chat-b-private'); await env.flush();
  assert.equal(env.state.replays, 1, 'setting the same identity does not replay');
  assert.equal(env.state.mounts, 1, 'different chats reuse the original decorations');
  assert.doesNotMatch(JSON.stringify(env.runtime.getStatus()), /private|chatKey|conversation-id/, 'conversation identity remains private');
});

test('settings, right-panel layout changes and transient empty routes retain the last chat baseline', async t => {
  const env = fixture(t);
  env.layout.setAttribute('class', 'right-panel-open'); await env.flush();
  assert.equal(env.state.replays, 0);
  env.settingsSearch.visible = true; env.changed(env.settingsSearch); await env.flush();
  env.marker.setAttribute('data-above-composer-conversation-id', 'settings-stale-private'); await env.flush();
  assert.equal(env.state.replays, 0, 'cached chat markers cannot replay from a settings page');
  env.marker.setAttribute('data-above-composer-conversation-id', 'chat-a-private');
  env.settingsSearch.visible = false; env.changed(env.settingsSearch); await env.flush();
  assert.equal(env.state.replays, 0, 'returning to the same chat does not replay');
  env.main.remove(); await env.flush();
  assert.equal(env.state.anchors.at(-1), null, 'empty route detaches the anchor while keeping its canvas');
  env.body.append(env.main); await env.flush();
  assert.equal(env.state.replays, 0, 'a temporary route gap retains the chat identity');
  env.main.remove(); await env.flush();
  const other = env.chat('chat-c-private'); env.body.append(other.main); await env.flush();
  assert.equal(env.state.replays, 1, 'a genuinely different chat after the route gap replays once');
});

test('late marker insertion and attribute-only updates are discovered without remounting main', async t => {
  const env = fixture(t, { identity: null });
  assert.equal(env.state.initialAssemblies,1, 'the initial home/empty route still starts an assembly');
  assert.equal(env.state.replays, 0);
  env.marker.setAttribute('data-above-composer-conversation-id', 'chat-a-private'); await env.flush();
  assert.equal(env.state.replays, 0, 'first late identity establishes the baseline');
  env.marker.setAttribute('data-above-composer-conversation-id', 'chat-b-private'); await env.flush();
  assert.equal(env.state.replays, 1, 'only changing the attribute triggers the replay');
  env.marker.remove(); await env.flush();
  const replacement = env.chat('chat-c-private').marker;
  env.composer.append(replacement); await env.flush();
  assert.equal(env.state.replays, 2, 'adding only a new identity marker is sufficient for discovery');
});

test('disposed runtime ignores queued identity scans and removes its observers/listeners', async t => {
  const env = fixture(t);
  env.marker.setAttribute('data-above-composer-conversation-id', 'chat-b-private');
  env.runtime.dispose(); await env.flush();
  assert.equal(env.state.replays, 0);
  assert.equal(env.state.disposals, 1);
  assert.ok(env.observers.every(observer => observer.disconnected));
  for (const callbacks of env.listeners.values()) assert.equal(callbacks.size, 0);
});

test('disable restores native nodes and variables, stops renderers, then enables with saved parameters', async t => {
  const env = fixture(t);
  env.runtime.update({ fluidHue:123, enabled:false }); await env.flush();
  const disabled = env.runtime.getStatus();
  assert.equal(disabled.mounted,true, 'settings controller stays mounted');
  assert.equal(disabled.active,false);
  assert.equal(disabled.renderer.running,false);
  assert.equal(disabled.materials.active,false);
  assert.equal(env.state.backdropDisposals,1);
  assert.equal(env.state.materialDisposals,1);
  assert.equal(env.state.disposals,1);
  assert.equal(env.root.hasAttribute('data-codex-glass'),false);
  assert.equal(env.composer.hasAttribute('data-cg-composer'),false);
  assert.equal(env.surface.hasAttribute('data-cg-composer-surface'),false);
  assert.equal(env.root.style.values.size,0);
  assert.equal(env.body.querySelector('.cg-backdrop'),null);
  assert.deepEqual(JSON.parse(env.stored()).enabled,false);
  env.marker.setAttribute('data-above-composer-conversation-id','disabled-chat-private'); await env.flush();
  assert.equal(env.state.replays,0);
  env.runtime.update({ enabled:true }); await env.flush();
  assert.equal(env.runtime.getStatus().active,true);
  assert.equal(env.runtime.getStatus().settings.fluidHue,123);
  assert.equal(env.state.backdropMounts,2);
  assert.equal(env.state.materialMounts,2);
  assert.equal(env.state.mounts,2);
  assert.equal(env.state.initialAssemblies,2, 'reenabling visuals starts a fresh initial assembly');
  assert.equal(env.root.hasAttribute('data-codex-glass'),true);
  assert.equal(env.state.replays,0, 'reenabling establishes a fresh chat baseline');
});

test('a persisted disabled skin mounts its controller without allocating visual resources', async t => {
  const env = fixture(t,{ savedSettings:{enabled:false,fluidHue:234} });
  assert.equal(env.runtime.getStatus().mounted,true);
  assert.equal(env.runtime.getStatus().active,false);
  assert.equal(env.runtime.getStatus().matched.main,1);
  assert.equal(env.state.backdropMounts,0);
  assert.equal(env.state.materialMounts,0);
  assert.equal(env.state.mounts,0);
  assert.equal(env.state.initialAssemblies,0);
  assert.equal(env.root.hasAttribute('data-codex-glass'),false);
  env.runtime.update({ enabled:true }); await env.flush();
  assert.equal(env.runtime.getStatus().active,true);
  assert.equal(env.runtime.getStatus().settings.fluidHue,234);
  assert.equal(env.state.backdropMounts,1);
  assert.equal(env.state.initialAssemblies,1);
});

test('composer discovery uses the root fallback and drops disconnected targets', async t => {
  const env = fixture(t);
  assert.equal(env.state.surfaces.find(item => item.kind==='composer').element,env.surface);
  env.surface.remove(); await env.flush();
  assert.equal(env.state.surfaces.find(item => item.kind==='composer').element,env.composer);
  assert.equal(env.composer.hasAttribute('data-cg-composer-surface'),true);
  assert.equal(env.surface.hasAttribute('data-cg-composer-surface'),false);
  env.composer.remove(); await env.flush();
  assert.equal(env.state.surfaces.some(item => item.kind==='composer'),false);
  assert.equal(env.composer.hasAttribute('data-cg-composer-surface'),false);
});

test('irrelevant message class/style changes do not search the message subtree or rescan surfaces', async t => {
  const env = fixture(t);
  const message = env.document.createElement('section');
  // A long rendered conversation has thousands of descendants. Mutating its
  // outer class must not search them again to discover an unrelated composer.
  for (let index = 0; index < 100; index++) {
    const chunk = env.document.createElement('article');
    for (let child = 0; child < 40; child++) chunk.append(env.document.createElement('span'));
    message.append(chunk);
  }
  env.layout.prepend(message); await env.flush();
  const before = { ...env.metrics };
  for (let index = 0; index < 30; index++) {
    message.setAttribute(index % 2 ? 'style' : 'class', `native-render-${index}`);
    await env.microtasks();
  }
  assert.equal(env.metrics.discoverySubtreeQueries, before.discoverySubtreeQueries,
    'attribute records use cached discovery nodes instead of a 4,101-node subtree selector');
  assert.equal(env.frames.size, 0, 'message-only mutations do not schedule discovery');
  assert.equal(env.metrics.surfaceSyncs, before.surfaceSyncs);
  assert.equal(env.metrics.visibilityReads, before.visibilityReads);
});

test('separate foreground mutation batches share one frame, surface sync and chat replay', async t => {
  const env = fixture(t);
  const before = { ...env.metrics };
  for (let index = 0; index < 10; index++) {
    env.main.setAttribute('class', `native-layout-${index}`);
    env.marker.setAttribute('data-above-composer-conversation-id', 'chat-b-private');
    await env.microtasks();
  }
  assert.equal(env.frames.size, 1, 'even separate microtask batches wait for the same paint');
  assert.equal(env.metrics.surfaceSyncs, before.surfaceSyncs);
  assert.equal(env.metrics.visibilityReads, before.visibilityReads);
  assert.equal(env.state.replays, 0);
  env.frame(); await env.microtasks();
  assert.equal(env.metrics.surfaceSyncs, before.surfaceSyncs + 1);
  assert.equal(env.metrics.visibilityReads, before.visibilityReads + 4,
    'one scan checks main, settings search, footer and chat layout once');
  assert.equal(env.state.replays, 1);
  assert.equal(env.state.mounts, 1);
});

test('cached discovery tracks generic settings and newly inserted route ancestors', async t => {
  const env = fixture(t, { cached: true });
  const settingsWrapper = env.document.createElement('section');
  env.settingsSearch.parentNode.append(settingsWrapper);
  settingsWrapper.append(env.settingsSearch); await env.flush();
  env.settingsSearch.visible = true; settingsWrapper.visible = false;
  env.changed(settingsWrapper); await env.flush();
  assert.equal(env.root.getAttribute('data-codex-glass-page'), 'thread', 'hidden cached settings do not take over');
  settingsWrapper.visible = true; settingsWrapper.setAttribute('style', 'opacity:1'); await env.flush();
  assert.equal(env.root.getAttribute('data-codex-glass-page'), 'settings', 'an unmarked ancestor can reveal the settings search');
  env.settingsSearch.visible = false; env.changed(settingsWrapper); await env.flush();
  env.main.remove(); await env.flush();
  const next = env.chat('chat-c-private'), wrapper = env.document.createElement('section');
  wrapper.append(next.main); env.body.append(wrapper); await env.flush();
  assert.equal(env.state.replays, 1, 'child-list discovery still sees a nested new main');
  assert.equal(env.state.surfaces.find(item => item.kind === 'composer').element, next.surface);
  wrapper.setAttribute('hidden', ''); await env.flush();
  assert.equal(env.state.anchors.at(-1), null, 'the newly discovered generic ancestor can hide the route');
  wrapper.removeAttribute('hidden'); await env.flush();
  assert.equal(env.state.anchors.at(-1), next.layout);
  assert.equal(env.state.replays, 1, 'revealing the same route preserves its baseline');
});

test('native selector removal restores old ownership and rediscovers the same connected nodes', async t => {
  const env = fixture(t);
  env.surface.removeAttribute('data-composer-surface-variant'); await env.flush();
  assert.equal(env.surface.hasAttribute('data-cg-composer-surface'), false);
  assert.equal(env.composer.hasAttribute('data-cg-composer-surface'), true,
    'removing a native selector migrates the painted input to the root fallback');
  env.surface.setAttribute('data-composer-surface-variant', 'default'); await env.flush();
  assert.equal(env.surface.hasAttribute('data-cg-composer-surface'), true);
  assert.equal(env.composer.hasAttribute('data-cg-composer-surface'), false);
  env.main.setAttribute('data-app-shell-main-surface', 'alternate'); await env.flush();
  assert.equal(env.main.hasAttribute('data-cg-main'), false, 'formerly marked targets still trigger attribute restoration');
  assert.equal(env.state.anchors.at(-1), null);
  env.main.setAttribute('data-app-shell-main-surface', 'default'); await env.flush();
  assert.equal(env.main.hasAttribute('data-cg-main'), true);
  assert.equal(env.state.anchors.at(-1), env.layout);
  assert.equal(env.state.replays, 0, 'restoring the same main preserves its chat baseline');
});

test('visibility changes migrate pending scans and hidden windows do not wait for RAF', async t => {
  const env = fixture(t);
  env.marker.setAttribute('data-above-composer-conversation-id', 'chat-b-private');
  assert.equal(env.frames.size, 1);
  env.setHidden(true);
  assert.equal(env.frames.size, 0, 'the paused foreground frame is cancelled');
  await env.microtasks();
  assert.equal(env.state.replays, 1, 'background discovery runs without a frame');
  env.marker.setAttribute('data-above-composer-conversation-id', 'chat-c-private');
  env.setHidden(false);
  await env.microtasks();
  assert.equal(env.state.replays, 1, 'the stale background microtask cannot bypass the new visible frame');
  assert.equal(env.frames.size, 1);
  env.frame(); await env.microtasks();
  assert.equal(env.state.replays, 2);
  env.marker.setAttribute('data-above-composer-conversation-id', 'chat-d-private');
  assert.equal(env.frames.size, 1);
  env.runtime.dispose();
  assert.equal(env.frames.size, 0, 'dispose cancels its pending discovery frame');
  env.setHidden(true); await env.flush();
  assert.equal(env.state.replays, 2);
  for (const callbacks of env.listeners.values()) assert.equal(callbacks.size, 0);
});
