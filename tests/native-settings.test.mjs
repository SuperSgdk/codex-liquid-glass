// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const bundled = await build({
  entryPoints: [fileURLToPath(new URL('../src/skin/native-settings.ts', import.meta.url))],
  bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent',
});
const { mountNativeSettingsEntry } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`,
);

// Only selectors, visibility and tree placement are emulated. Native EventTarget
// supplies the same change/click listener behavior used by the mounted entry.
class Element extends EventTarget {
  constructor(tagName, ownerDocument) {
    super();
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.attributes = new Map();
    this.children = [];
    this.parentNode = null;
    this.visible = true;
    this.hidden = false;
    this.prependCalls = 0;
  }
  get parentElement() { return this.parentNode instanceof Element ? this.parentNode : null; }
  get firstElementChild() { return this.children[0] ?? null; }
  get isConnected() { return this.parentNode === this.ownerDocument || Boolean(this.parentNode?.isConnected); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  hasAttribute(name) { return this.attributes.has(name); }
  append(...nodes) {
    for (const node of nodes) { node.remove(); node.parentNode = this; this.children.push(node); }
  }
  prepend(...nodes) {
    this.prependCalls++;
    for (const node of nodes) { node.remove(); node.parentNode = this; }
    this.children.unshift(...nodes);
  }
  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter(node => node !== this);
    this.parentNode = null;
  }
  matches(selector) {
    return selector.split(',').some(part => {
      part = part.trim();
      const tag = part.match(/^([a-z][a-z0-9]*)/i)?.[1];
      if (tag && tag.toUpperCase() !== this.tagName) return false;
      const id = part.match(/#([\w-]+)/)?.[1];
      if (id && this.getAttribute('id') !== id) return false;
      for (const [, name, operator, value] of part.matchAll(/\[([^\]~=]+)(?:(~=|=)"([^"]*)")?\]/g)) {
        if (!this.hasAttribute(name)) return false;
        if (operator === '=' && this.getAttribute(name) !== value) return false;
        if (operator === '~=' && !this.getAttribute(name).split(/\s+/).includes(value)) return false;
      }
      return true;
    });
  }
  querySelectorAll(selector) {
    const nodes = [];
    for (const child of this.children) {
      if (child.matches(selector)) nodes.push(child);
      nodes.push(...child.querySelectorAll(selector));
    }
    return nodes;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  checkVisibility() {
    if (!this.isConnected) return false;
    for (let node = this; node instanceof Element; node = node.parentNode) {
      if (!node.visible || node.hidden) return false;
    }
    return true;
  }
  getClientRects() { return this.checkVisibility() ? [{ width: 800, height: 600 }] : []; }
  getBoundingClientRect() { return { width: 800, height: 600 }; }
}

class Document extends EventTarget {
  constructor() {
    super();
    this.body = new Element('body', this);
    this.body.parentNode = this;
  }
  createElement(tagName) { return new Element(tagName, this); }
  querySelectorAll(selector) { return this.body.querySelectorAll(selector); }
}

function fixture(t, { enabled = true, searchVisible = true } = {}) {
  const names = ['document', 'getComputedStyle', 'MutationObserver'];
  const saved = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const document = new Document();
  const search = document.createElement('input');
  search.setAttribute('id', 'settings-search');
  search.visible = searchVisible;
  document.body.append(search);
  const state = { enabled };
  const changes = [];
  let opens = 0;
  Object.assign(globalThis, {
    document,
    getComputedStyle: node => ({ display: node.visible ? 'block' : 'none', visibility: 'visible', opacity: '1' }),
    MutationObserver: class { constructor() { throw new Error('Entry must reuse its parent scan, never mount an observer.'); } },
  });
  let mounted;
  t.after(() => {
    mounted?.dispose();
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
    }
  });
  function page({ hidden = false, heading = true, header = false, layout = false } = {}) {
    const main = document.createElement('main');
    main.setAttribute('data-app-shell-main-surface', 'default');
    main.hidden = hidden;
    const column = document.createElement('div');
    if (layout) column.setAttribute('data-app-shell-main-content-layout', '');
    main.append(column);
    const title = document.createElement('h1');
    title.textContent = '常规';
    if (heading && header) {
      const headingWrapper = document.createElement('header');
      headingWrapper.append(title); column.append(headingWrapper);
    } else if (heading) column.append(title);
    document.body.append(main);
    return { main, column, title };
  }
  function mount() {
    mounted = mountNativeSettingsEntry(value => { changes.push(value); Object.assign(state, value); }, () => state, () => opens++);
    return mounted;
  }
  function entry() { return document.body.querySelector('[data-cg-settings-entry]'); }
  return { document, state, changes, search, page, mount, entry, get opens() { return opens; } };
}

test('原生设置页顶部只有一个入口，隐藏的缓存页不会收到入口', t => {
  const env = fixture(t);
  const cached = env.page({ hidden: true });
  const active = env.page();
  const mounted = env.mount();
  const entry = env.entry();
  assert.equal(active.column.firstElementChild, entry);
  assert.equal(active.column.children[1], active.title);
  assert.equal(cached.main.querySelector('[data-cg-settings-entry]'), null);
  assert.equal(entry.className, 'cg-native-settings-entry');
  const control = entry.querySelector('input');
  assert.equal(control.type, 'checkbox');
  assert.equal(control.getAttribute('role'), 'switch');
  assert.equal(control.getAttribute('aria-label'), '启用液态玻璃皮肤');
  assert.equal(entry.querySelector('label').htmlFor, control.id);
  for (let count = 0; count < 4; count++) mounted.sync();
  assert.equal(env.document.querySelectorAll('[data-cg-settings-entry]').length, 1);
  assert.equal(active.column.prependCalls, 1, 'unchanged scans must not mutate native layout');
});

test('关闭皮肤后开关和调整按钮保留，状态变更只发送 enabled', t => {
  const env = fixture(t, { enabled: false });
  env.page();
  const mounted = env.mount();
  const entry = env.entry();
  const control = entry.querySelector('input');
  assert.equal(control.checked, false);
  assert.equal(control.getAttribute('aria-checked'), 'false');
  assert.equal(entry.querySelector('button').textContent, '调整皮肤');
  entry.querySelector('button').dispatchEvent(new Event('click'));
  assert.equal(env.opens, 1, 'disabled skins must still expose their panel');
  control.checked = true;
  control.dispatchEvent(new Event('change'));
  assert.deepEqual(env.changes, [{ enabled: true }]);
  assert.equal(control.getAttribute('aria-checked'), 'true');
  env.state.enabled = false;
  mounted.sync();
  assert.equal(control.checked, false);
  assert.equal(env.entry(), entry);
});

test('隐藏设置搜索与不可见 main 移除入口，恢复可见路由重新接入', t => {
  const env = fixture(t, { searchVisible: false });
  const active = env.page();
  const mounted = env.mount();
  assert.equal(env.entry(), null);
  env.search.visible = true;
  mounted.sync();
  const entry = env.entry();
  assert.ok(entry);
  active.main.hidden = true;
  mounted.sync();
  assert.equal(env.entry(), null);
  const next = env.page();
  mounted.sync();
  assert.equal(next.column.firstElementChild, entry);
  env.search.hidden = true;
  mounted.sync();
  assert.equal(env.entry(), null);
});

test('可见聊天 composer 和 footer 阻止入口插入，隐藏聊天缓存不会阻止设置', t => {
  const env = fixture(t);
  const active = env.page();
  const composer = env.document.createElement('div');
  composer.setAttribute('data-codex-composer-root', '');
  active.column.append(composer);
  const mounted = env.mount();
  assert.equal(env.entry(), null);
  composer.hidden = true;
  mounted.sync();
  assert.ok(env.entry());
  const footer = env.document.createElement('div');
  footer.setAttribute('data-thread-scroll-footer', '');
  active.column.append(footer);
  mounted.sync();
  assert.equal(env.entry(), null);
});

test('标题在 header 时插在内容列，缺少标题时使用可见 layout', t => {
  const env = fixture(t);
  const active = env.page({ header: true });
  const mounted = env.mount();
  assert.equal(active.column.firstElementChild, env.entry());
  active.main.hidden = true;
  const fallback = env.page({ heading: false, layout: true });
  mounted.sync();
  assert.equal(fallback.column.firstElementChild, env.entry());
  fallback.main.hidden = true;
  const plain = env.page({ heading: false });
  mounted.sync();
  assert.equal(plain.main.firstElementChild, env.entry());
});

test('普通设置标题深入 flex row 时入口插在完整设置列，标题结构保持原样', t => {
  const env = fixture(t);
  const cached = env.page({ hidden: true });
  cached.column.setAttribute('class', 'group/settings mx-auto flex w-full flex-col');
  cached.column.setAttribute('data-density', 'default');
  const active = env.page();
  active.column.setAttribute('class', 'group/settings mx-auto flex w-full flex-col max-w-3xl');
  active.column.setAttribute('data-density', 'default');
  const header = env.document.createElement('header');
  const headingRow = env.document.createElement('div');
  headingRow.setAttribute('class', 'flex min-w-0 items-start justify-between gap-4 flex-wrap');
  const titleCopy = env.document.createElement('div');
  titleCopy.setAttribute('class', 'flex min-w-0 flex-1 basis-64 flex-col gap-1.5');
  titleCopy.append(active.title);
  headingRow.append(titleCopy); header.append(headingRow); active.column.append(header);
  const card = env.document.createElement('section');
  card.setAttribute('data-settings-card', ''); active.column.append(card);
  env.mount();
  assert.equal(active.column.firstElementChild, env.entry());
  assert.equal(cached.main.querySelector('[data-cg-settings-entry]'), null);
  assert.deepEqual(titleCopy.children, [active.title]);
  assert.deepEqual(header.children, [headingRow]);
  assert.equal(active.column.children.at(-1), card);
});

test('slate 设置标题是内容列的兄弟时入口仍在设置列，保留独立标题栏', t => {
  const env = fixture(t);
  const active = env.page({ heading: false });
  active.column.setAttribute('class', 'group/settings mx-auto flex w-full flex-col max-w-3xl');
  active.column.setAttribute('data-density', 'compact');
  const scroll = env.document.createElement('div');
  scroll.setAttribute('class', 'flex-1 scrollbar-stable overflow-y-auto');
  const toolbar = env.document.createElement('div');
  const titleRow = env.document.createElement('div');
  titleRow.setAttribute('class', 'headerRow');
  const titleCopy = env.document.createElement('div');
  titleCopy.setAttribute('class', 'titleContent');
  titleCopy.append(active.title); titleRow.append(titleCopy); toolbar.append(titleRow);
  scroll.append(toolbar, active.column); active.main.append(scroll);
  const card = env.document.createElement('section');
  card.setAttribute('data-settings-card', ''); active.column.append(card);
  env.mount();
  assert.equal(active.column.firstElementChild, env.entry());
  assert.deepEqual(titleCopy.children, [active.title]);
  assert.deepEqual(scroll.children, [toolbar, active.column]);
  assert.equal(active.column.children.at(-1), card);
});

test('原生内容替换后可重新插入，卸载后回调和 sync 都停止', t => {
  const env = fixture(t);
  const active = env.page();
  const mounted = env.mount();
  const entry = env.entry();
  const control = entry.querySelector('input');
  const adjust = entry.querySelector('button');
  active.column.remove();
  const newColumn = env.document.createElement('div');
  newColumn.append(env.document.createElement('h1'));
  active.main.append(newColumn);
  mounted.sync();
  assert.equal(newColumn.firstElementChild, entry);
  mounted.dispose();
  mounted.dispose();
  assert.equal(env.entry(), null);
  control.dispatchEvent(new Event('change'));
  adjust.dispatchEvent(new Event('click'));
  mounted.sync();
  assert.deepEqual(env.changes, []);
  assert.equal(env.opens, 0);
  assert.equal(env.entry(), null);
  assert.equal(newColumn.querySelector('h1').isConnected, true);
});
