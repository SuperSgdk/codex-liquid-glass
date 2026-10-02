// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const bundled = await build({
  entryPoints: [fileURLToPath(new URL('../src/skin/panel.ts', import.meta.url))],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
  logLevel: 'silent',
});
const { mountSettingsPanel } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
);

// Node's EventTarget handles listeners, preventDefault and stopPropagation.
// This small element tree adds only DOM bubbling, containment and focus.
class Element extends EventTarget {
  constructor(tagName, ownerDocument) {
    super();
    this.tagName = tagName;
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.attributes = new Map();
    this.parentNode = null;
    this.focusCalls = [];
  }
  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  append(...nodes) {
    for (const node of nodes) {
      node.remove();
      node.parentNode = this;
      this.children.push(node);
    }
  }
  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter(node => node !== this);
    this.parentNode = null;
  }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  get isConnected() { return this.parentNode === this.ownerDocument || Boolean(this.parentNode?.isConnected); }
  focus(options) {
    this.focusCalls.push(options);
    this.ownerDocument.activeElement = this;
  }
  dispatchEvent(event) {
    const accepted = super.dispatchEvent(event);
    if (event.bubbles && !event.cancelBubble && this.parentNode) {
      return this.parentNode.dispatchEvent(event) && accepted;
    }
    return accepted;
  }
}

class Document extends EventTarget {
  constructor() {
    super();
    this.body = new Element('body', this);
    this.body.parentNode = this;
    this.activeElement = this.body;
  }
  createElement(tagName) { return new Element(tagName, this); }
}

function keyboard(key, properties = {}) {
  const event = new Event('keydown', { bubbles: true, cancelable: true });
  Object.assign(event, { key, isComposing: false, ctrlKey: false, altKey: false, shiftKey: false,
    metaKey: false, repeat: false, ...properties });
  return event;
}
function shortcut(properties = {}) {
  return keyboard('g', { ctrlKey: true, altKey: true, shiftKey: true, ...properties });
}

function fixture(t) {
  const descriptors = new Map(['document', 'HTMLElement'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const document = new Document();
  Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: document });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, writable: true, value: Element });
  const originalInput = document.createElement('textarea');
  document.body.append(originalInput);
  originalInput.focus();
  const settings = { scheme: 'system', blur: 20, frost: 7, fluidHue: 320, fluidDepth: 25,
    bgBrightness: 50, whale: true, critters: true, mesh: true, spotlight: true, press: true };
  const mounted = mountSettingsPanel(() => {}, () => settings, { showTrigger: false });
  const panel = document.body.children.find(node => node.getAttribute('role') === 'dialog');
  const close = panel.children[0].children.find(node => node.getAttribute('aria-label') === '关闭皮肤设置');
  t.after(() => {
    mounted.dispose();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  return { document, originalInput, panel, close, mounted };
}

test('打开面板聚焦关闭键，再次打开仍恢复最初的聊天焦点', t => {
  const { document, originalInput, panel, close, mounted } = fixture(t);
  assert.equal(panel.hidden, true);
  mounted.open();
  assert.equal(panel.hidden, false);
  assert.equal(document.activeElement, close);
  assert.deepEqual(close.focusCalls.at(-1), { preventScroll: true });
  mounted.open();
  close.dispatchEvent(new Event('click', { bubbles: true }));
  assert.equal(panel.hidden, true);
  assert.equal(document.activeElement, originalInput);
  assert.deepEqual(originalInput.focusCalls.at(-1), { preventScroll: true });
});

test('面板内部 Escape 关闭并恢复焦点，阻止 Codex 收到同一个按键', t => {
  const { document, originalInput, panel, close, mounted } = fixture(t);
  let nativeKeydowns = 0;
  document.addEventListener('keydown', () => nativeKeydowns++);
  mounted.open();
  const escape = keyboard('Escape');
  assert.equal(close.dispatchEvent(escape), false);
  assert.equal(escape.defaultPrevented, true);
  assert.equal(nativeKeydowns, 0);
  assert.equal(panel.hidden, true);
  assert.equal(document.activeElement, originalInput);
});

test('面板外部 Escape 保留原处理和焦点，不强制关闭皮肤面板', t => {
  const { document, originalInput, panel, mounted } = fixture(t);
  let nativeKeydowns = 0;
  document.addEventListener('keydown', () => nativeKeydowns++);
  mounted.open();
  originalInput.focus();
  const escape = keyboard('Escape');
  assert.equal(originalInput.dispatchEvent(escape), true);
  assert.equal(escape.defaultPrevented, false);
  assert.equal(nativeKeydowns, 1);
  assert.equal(panel.hidden, false);
  assert.equal(document.activeElement, originalInput);
});

test('已由原界面处理的快捷键与 IME 输入不会被皮肤劫持', t => {
  const { document, originalInput, panel, close, mounted } = fixture(t);
  const handled = shortcut();
  handled.preventDefault();
  originalInput.dispatchEvent(handled);
  assert.equal(panel.hidden, true);
  assert.equal(document.activeElement, originalInput);

  const composingShortcut = shortcut({ isComposing: true });
  originalInput.dispatchEvent(composingShortcut);
  assert.equal(composingShortcut.defaultPrevented, false);
  assert.equal(panel.hidden, true);
  assert.equal(document.activeElement, originalInput);

  mounted.open();
  let nativeKeydowns = 0;
  document.addEventListener('keydown', () => nativeKeydowns++);
  const composingEscape = keyboard('Escape', { isComposing: true });
  close.dispatchEvent(composingEscape);
  assert.equal(composingEscape.defaultPrevented, false);
  assert.equal(nativeKeydowns, 1);
  assert.equal(panel.hidden, false);
  assert.equal(document.activeElement, close);
});

test('卸载面板恢复聊天焦点，并移除全局快捷键监听', t => {
  const { document, originalInput, panel, close, mounted } = fixture(t);
  const openKey = shortcut();
  originalInput.dispatchEvent(openKey);
  assert.equal(openKey.defaultPrevented, true);
  assert.equal(panel.hidden, false);
  assert.equal(document.activeElement, close);
  mounted.dispose();
  assert.equal(document.activeElement, originalInput);
  assert.equal(panel.isConnected, false);
  assert.deepEqual(document.body.children, [originalInput]);
  const afterDispose = shortcut();
  originalInput.dispatchEvent(afterDispose);
  assert.equal(afterDispose.defaultPrevented, false);
  assert.equal(panel.hidden, true);
  assert.equal(document.activeElement, originalInput);
});
