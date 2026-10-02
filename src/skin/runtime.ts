// SPDX-License-Identifier: AGPL-3.0-only
import { mountFluidBackdrop } from '../core/backdrop.ts';
import { HUE_BASE } from '../core/fluid-tones.ts';
import { mountDecorations } from '../decorations/index.ts';
import { normalizeSettings, readSettings, writeSettings, type SkinSettings } from './settings.ts';
import { mountSettingsPanel } from './panel.ts';
import { mountNativeSettingsEntry } from './native-settings.ts';
import { MATERIAL_CSS } from './material.ts';
import { mountGlassSurfaces } from './surfaces.ts';

export const SELECTORS = {
  sidebar: 'aside[data-app-shell-left-panel-appearance]',
  main: 'main[data-app-shell-main-surface="default"]',
  composer: '[data-codex-composer-root]',
};
const COMPOSER_SURFACE = '[data-composer-surface-variant]';
const CHAT_IDENTITY = '[data-above-composer-conversation-id]';
const SETTINGS_CARDS = 'main[data-app-shell-main-surface="default"] :is(.rounded-2xl.border,.rounded-xl.border,[data-settings-card])';
const OWN_HOSTS = '.cg-settings-panel,.cg-native-settings-entry,.cg-backdrop,.cg-decorations,.cg-materials';
const DISCOVERY_SELECTOR = `${Object.values(SELECTORS).join(',')},${COMPOSER_SURFACE},${CHAT_IDENTITY},[data-app-shell-main-content-layout],[data-thread-scroll-footer],#settings-search,[data-density][class~="group/settings"],[data-settings-card],.rounded-2xl.border,.rounded-xl.border`;

export function mountCodexSkin() {
  const root = document.documentElement;
  let storage: Storage | null = null;
  try { storage = localStorage; } catch {}
  let settings = readSettings(storage);
  let disposed = false;
  let scheme: 'light' | 'dark' = 'light';
  let decorationAnchor: HTMLElement | null = null;
  let decorations: ReturnType<typeof mountDecorations> | null = null;
  // Keep the native conversation identity private. Layout/panel changes alone
  // must not replay the assembly, and transient empty routes keep this baseline.
  let lastChatKey: string | null = null;
  let scanPending = false;
  let scanFrame = 0;
  let scanVersion = 0;
  let painted = false;
  let materials: ReturnType<typeof mountGlassSurfaces> | null = null;
  let backdrop: ReturnType<typeof mountFluidBackdrop> | null = null;
  const marked = new Map<Element, Map<string, string | null>>();
  // Native class/style mutations are frequent during chat rendering. Keep
  // discovery targets once per scan, rather than searching each changed
  // message subtree just to find out whether anything relevant is inside it.
  const discoveryNodes = new Set<Element>();
  const originalStyle = new Map<string, { value: string; priority: string }>();
  const media = matchMedia('(prefers-color-scheme: dark)');
  const style = document.createElement('style'); style.dataset.codexGlassStyle = ''; style.textContent = MATERIAL_CSS;
  const backdropHost = document.createElement('div'); backdropHost.className = 'cg-backdrop'; backdropHost.setAttribute('aria-hidden', 'true');
  const decorationsHost = document.createElement('div'); decorationsHost.className = 'cg-decorations'; decorationsHost.setAttribute('aria-hidden', 'true');
  const materialsHost = document.createElement('div'); materialsHost.className = 'cg-materials'; materialsHost.setAttribute('aria-hidden', 'true');
  function mark(element: Element, attribute: string, value = '') {
    let attributes = marked.get(element); if (!attributes) marked.set(element, attributes = new Map());
    if (!attributes.has(attribute)) attributes.set(attribute, element.getAttribute(attribute));
    if (element.getAttribute(attribute) !== value) element.setAttribute(attribute, value);
  }
  function restoreAttribute(element: Element, attribute: string) {
    const attributes = marked.get(element);
    if (!attributes?.has(attribute)) return;
    const value = attributes.get(attribute);
    if (value == null) element.removeAttribute(attribute); else element.setAttribute(attribute, value);
    attributes.delete(attribute);
    if (!attributes.size) marked.delete(element);
  }
  function variable(name: string, value: string) {
    if (!originalStyle.has(name)) originalStyle.set(name, { value: root.style.getPropertyValue(name), priority: root.style.getPropertyPriority(name) });
    if (root.style.getPropertyValue(name) !== value) root.style.setProperty(name, value);
  }
  document.head.append(style);
  const panel = mountSettingsPanel(update, () => settings, { showTrigger:false });
  const settingsEntry = mountNativeSettingsEntry(update, () => settings, panel.open);
  function enableVisuals() {
    mark(root, 'data-codex-glass');
    document.body.prepend(backdropHost, decorationsHost, materialsHost);
    materials = mountGlassSurfaces(materialsHost);
    backdrop = mountFluidBackdrop(backdropHost, { scheme:resolveScheme(), fluidHue:settings.fluidHue, fluidDepth:settings.fluidDepth, bgBrightness:settings.bgBrightness, mesh:settings.mesh });
    painted = false;
  }
  function disableVisuals() {
    clearHover();
    decorations?.dispose(); decorations = null; decorationAnchor = null;
    materials?.dispose(); materials = null;
    backdrop?.dispose(); backdrop = null;
    backdropHost.remove(); decorationsHost.remove(); materialsHost.remove();
    for (const [element,attributes] of marked) for (const [attribute,value] of attributes) {
      if (value === null) element.removeAttribute(attribute); else element.setAttribute(attribute,value);
    }
    for (const [name,{value,priority}] of originalStyle) {
      if (value) root.style.setProperty(name,value,priority); else root.style.removeProperty(name);
    }
    marked.clear(); originalStyle.clear(); lastChatKey = null; painted = false;
  }
  function resolveScheme(): 'light' | 'dark' {
    if (settings.scheme !== 'system') return settings.scheme;
    const app = root.getAttribute('data-theme') || root.getAttribute('data-color-mode');
    if (app === 'dark' || root.classList.contains('dark')) return 'dark';
    if (app === 'light' || root.classList.contains('light')) return 'light';
    return media.matches ? 'dark' : 'light';
  }
  function paint() {
    painted = true;
    scheme = resolveScheme(); const dark = scheme === 'dark';
    panel.sync(); settingsEntry.sync();
    if (!settings.enabled || disposed) return;
    const alpha = (dark ? .5 : .42) * Math.min(settings.frost / 50, 1.4);
    const ink = dark ? '#EAF2FC' : '#13243E';
    const muted = dark ? '#AFC3DC' : '#40597A';
    const glowHue = ((settings.fluidHue + HUE_BASE) % 360 + 360) % 360;
    const colors: Record<string,string> = {
      '--cg-ink': ink, '--cg-muted': muted,
      '--cg-glass': dark ? `rgba(34,38,47,${alpha})` : `rgba(255,255,255,${alpha})`,
      '--cg-card-glass': dark ? 'rgba(20,29,38,.42)' : 'rgba(255,255,255,.42)',
      '--cg-control-fill': dark ? 'rgba(30,43,55,.68)' : 'rgba(255,255,255,.62)',
      '--cg-blur': `${settings.blur}px`, '--cg-border': dark ? 'rgba(148,180,220,.32)' : 'rgba(19,45,83,.26)',
      '--cg-edge': dark ? 'rgba(148,180,220,.2)' : 'rgba(150,190,245,.65)',
      '--cg-inset': dark ? 'rgba(255,255,255,.07)' : 'rgba(255,255,255,.5)',
      '--cg-shadow': dark ? 'rgba(2,6,14,.5)' : 'rgba(19,45,83,.16)',
      '--cg-sidebar-shadow': dark ? '0 8px 30px rgba(2,6,14,.32)' : '0 10px 34px rgba(19,45,83,.16)',
      '--cg-settings-fill': dark ? 'rgba(17,26,39,.55)' : 'rgba(255,255,255,.45)',
      '--cg-input-fill': dark ? 'rgba(225,239,255,.09)' : 'rgba(240,247,255,.86)',
      '--cg-glow-color': settings.spotlight ? `hsla(${glowHue},90%,${dark ? 62 : 45}%,${dark ? .17 : .16})` : 'transparent',
      '--app-color-text-foreground': ink,
      '--app-color-text-secondary': muted,
      '--app-color-text-foreground-secondary': muted,
      '--app-color-text-foreground-tertiary': dark ? '#8399B5' : '#5D7696',
      // Native page wrappers, footer scrims and settings pages all use these
      // tokens. Their opaque fills used to cover the independently drawn skin.
      '--app-color-background-surface': 'transparent',
      '--app-color-background-shell': 'transparent',
      '--app-color-background-surface-under': 'transparent',
      '--app-color-background-application-menu': 'transparent',
      '--color-surface': 'transparent',
      '--color-surface-secondary': 'transparent',
      '--color-token-main-surface-primary': 'transparent',
      '--chat-background-color': 'transparent',
      '--smoothing-background-color': 'transparent',
      '--color-surface-card': 'transparent',
      '--color-background-composer-surface': 'transparent',
      '--color-background-composer-action-bar': 'transparent',
      '--color-surface-elevated': 'var(--cg-control-fill)',
      '--color-surface-elevated-secondary': 'var(--cg-control-fill)',
      '--app-color-background-elevated': 'var(--cg-control-fill)',
      '--app-color-background-elevated-secondary': 'var(--cg-control-fill)',
      '--app-color-background-control': 'var(--cg-control-fill)',
      '--app-color-background-control-opaque': 'var(--cg-control-fill)',
      '--color-background-control-opaque': 'var(--cg-control-fill)',
    };
    for (const [name,value] of Object.entries(colors)) variable(name,value);
    mark(root, 'data-codex-glass-scheme', scheme);
    backdrop?.update({ scheme, fluidHue:settings.fluidHue, fluidDepth:settings.fluidDepth, bgBrightness:settings.bgBrightness, mesh:settings.mesh });
    decorations?.update({ dark, whale:settings.whale, critters:settings.critters }); panel.sync();
  }
  function isVisible(element: HTMLElement): boolean {
    if (!element.getClientRects().length) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    if (typeof element.checkVisibility === 'function') return element.checkVisibility({
      opacityProperty:true, visibilityProperty:true, contentVisibilityAuto:true,
    });
    const computed = getComputedStyle(element);
    return computed.display !== 'none' && computed.visibility !== 'hidden' && computed.visibility !== 'collapse' && Number(computed.opacity) !== 0;
  }
  function scan() {
    cancelPendingScan(); if (disposed) return;
    settingsEntry.sync();
    discoveryNodes.clear();
    for (const element of document.querySelectorAll(DISCOVERY_SELECTOR)) {
      if (!element.closest(OWN_HOSTS)) discoveryNodes.add(element);
    }
    if (!settings.enabled) { scheme = resolveScheme(); return; }
    for (const [name,selector] of Object.entries(SELECTORS)) {
      for (const element of marked.keys()) {
        if (element.hasAttribute(`data-cg-${name}`) && !element.matches(selector)) {
          if (element === hovered) clearHover();
          restoreAttribute(element, `data-cg-${name}`);
        }
      }
      for (const element of document.querySelectorAll(selector)) mark(element, `data-cg-${name}`);
    }
    const candidates = Array.from(document.querySelectorAll<HTMLElement>(SELECTORS.main));
    const visibleMain = candidates.find(isVisible) ?? null;
    // Codex's settings search lives in the sidebar, outside its main page.
    // Cached routes can retain a hidden copy, so select any visible instance.
    const settingsPage = Array.from(document.querySelectorAll<HTMLElement>('#settings-search')).some(isVisible);
    const footer = visibleMain ? Array.from(visibleMain.querySelectorAll<HTMLElement>('[data-thread-scroll-footer]'))
      .find(isVisible) : null;
    mark(root, 'data-codex-glass-page', settingsPage ? 'settings' : footer ? 'thread' : 'home');
    // The main shell also contains review/browser/agent panels. Center the
    // shark in the chat viewport when present, keeping the whole main as the
    // home/settings fallback and as the original material surface.
    const chatLayout = footer?.closest<HTMLElement>('[data-app-shell-main-content-layout]');
    const candidate = chatLayout && visibleMain?.contains(chatLayout) && isVisible(chatLayout) ? chatLayout : visibleMain;
    if (candidate !== decorationAnchor) {
      decorationAnchor = candidate;
      if (candidate) {
        if (decorations) decorations.setAnchor(candidate);
        else decorations = mountDecorations(decorationsHost, candidate, { dark:scheme==='dark', whale:settings.whale, critters:settings.critters, replayOnMount:true });
      } else decorations?.setAnchor(null);
    }
    if (!settingsPage && footer) {
      const chatKey = footer.querySelector(CHAT_IDENTITY)?.getAttribute('data-above-composer-conversation-id');
      if (chatKey) {
        if (lastChatKey !== null && chatKey !== lastChatKey) decorations?.replayAssembly();
        lastChatKey = chatKey;
      }
    }
    // Release detached React nodes from the bookkeeping without retaining conversation DOM.
    for (const [element,attributes] of marked) if (!element.isConnected) {
      if (element === hovered) clearHover();
      for (const attribute of [...attributes.keys()]) restoreAttribute(element, attribute);
    }
    // The composer root also contains change summaries and status pills. Paint
    // only the native rounded input surface, never that larger square wrapper.
    const composers = visibleMain ? Array.from(visibleMain.querySelectorAll<HTMLElement>(SELECTORS.composer), element => element.querySelector<HTMLElement>(COMPOSER_SURFACE) ?? element) : [];
    const cards = settingsPage && visibleMain ? Array.from(visibleMain.querySelectorAll<HTMLElement>(SETTINGS_CARDS)) : [];
    for (const [attribute, elements] of [['data-cg-composer-surface', composers], ['data-cg-card', cards]] as const) {
      for (const element of marked.keys()) if (element.hasAttribute(attribute) && !elements.includes(element as HTMLElement)) restoreAttribute(element, attribute);
      for (const element of elements) mark(element, attribute);
    }
    materials?.sync([
      ...Array.from(document.querySelectorAll<HTMLElement>(SELECTORS.sidebar), element => ({ element, kind:'sidebar' as const })),
      ...composers.map(element => ({ element, kind:'composer' as const })),
      ...cards.map(element => ({ element, kind:'panel' as const })),
    ]);
    if (!painted || resolveScheme() !== scheme) paint();
  }
  function cancelPendingScan() {
    scanVersion++;
    if (scanFrame) cancelAnimationFrame(scanFrame);
    scanFrame = 0; scanPending = false;
  }
  function scheduleScan() {
    if (disposed || scanPending) return;
    scanPending = true;
    const version = ++scanVersion;
    const run = () => {
      if (disposed || version !== scanVersion) return;
      scanFrame = 0; scan();
    };
    // React can produce several mutation batches before the next paint. One
    // foreground scan shares that frame with the particle renderers. Hidden
    // windows still need attribute cleanup while Chromium pauses RAFs.
    if (document.hidden) queueMicrotask(run);
    else scanFrame = requestAnimationFrame(run);
  }
  function hasRelevantSurface(node: Node): boolean {
    return node instanceof Element && !node.closest(OWN_HOSTS) &&
      (marked.has(node) || node.matches(DISCOVERY_SELECTOR) || !!node.querySelector(DISCOVERY_SELECTOR));
  }
  function hasRelevantAttribute(node: Node): boolean {
    if (!(node instanceof Element) || node.closest(OWN_HOSTS)) return false;
    if (marked.has(node) || node.matches(DISCOVERY_SELECTOR)) return true;
    // Generic wrappers can hide/show a cached chat or settings search. They
    // remain relevant even though the wrapper itself has no native selector.
    for (const element of discoveryNodes) if (node.contains(element)) return true;
    return false;
  }
  const observer = new MutationObserver(records => {
    if (records.some(record => record.type === 'attributes'
      ? record.target === root || hasRelevantAttribute(record.target)
      : [...record.addedNodes, ...record.removedNodes].some(hasRelevantSurface))) scheduleScan();
  });
  observer.observe(document.body, { subtree:true, childList:true, attributes:true,
    attributeFilter:['data-app-shell-left-panel-appearance','data-app-shell-main-surface','data-codex-composer-root','data-composer-surface-variant','data-above-composer-conversation-id','class','style','hidden'] });
  observer.observe(root, { attributes:true, attributeFilter:['class','data-theme','data-color-mode'] });
  const onVisibility = () => {
    // Move a pending foreground scan to the background microtask path, and
    // discard an older queued callback when the window becomes visible again.
    cancelPendingScan(); scheduleScan();
  };
  document.addEventListener('visibilitychange', onVisibility);
  media.addEventListener('change', paint);
  let hovered: HTMLElement | null = null;
  function clearHover() {
    materials?.clearPointer(); hovered = null;
  }
  const onPointer = (event: PointerEvent) => {
    if (!settings.enabled || disposed) return;
    const next = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-cg-composer],[data-cg-sidebar]') : null;
    if (next !== hovered) { clearHover(); hovered = next; }
    if (!next) return;
    const surface = next.hasAttribute('data-cg-composer') ? next.querySelector<HTMLElement>(COMPOSER_SURFACE) ?? next : next;
    materials?.updatePointer(surface, { x:event.clientX, y:event.clientY, spotlight:settings.spotlight,
      press:settings.press && !matchMedia('(prefers-reduced-motion: reduce)').matches });
  };
  const onLeave = () => clearHover();
  document.addEventListener('pointermove', onPointer, { passive:true }); document.addEventListener('pointerleave', onLeave);
  window.addEventListener('blur', onLeave);
  function update(value: Partial<SkinSettings>) {
    if (disposed) throw new Error('Skin has been disposed');
    const wasEnabled = settings.enabled;
    settings=normalizeSettings(value,settings); clearHover(); writeSettings(storage,settings);
    if (settings.enabled !== wasEnabled) {
      if (settings.enabled) enableVisuals(); else disableVisuals();
      scan();
    }
    paint();
  }
  const handle = {
    update, openSettings:panel.open,
    replayAssembly() { if (!disposed) decorations?.replayAssembly(); },
    getStatus() { return { mounted:!disposed, active:!disposed && settings.enabled, scheme, settings:{...settings}, renderer:backdrop?.getStatus() ?? { renderer:'disabled', running:false }, materials:materials?.getStatus() ?? { active:false, count:0, visible:0, kinds:[] }, matched:{ sidebar:document.querySelectorAll(SELECTORS.sidebar).length, composer:document.querySelectorAll(SELECTORS.composer).length, main:document.querySelectorAll(SELECTORS.main).length }, liveHost:location.protocol==='app:', centerIcon:'鲨鱼粒子图形', settingsShortcut:'Ctrl+Alt+Shift+G' }; },
    dispose() {
      if (disposed) return; disposed=true; cancelPendingScan(); observer.disconnect(); discoveryNodes.clear();
      document.removeEventListener('visibilitychange', onVisibility);
      media.removeEventListener('change',paint); document.removeEventListener('pointermove',onPointer);document.removeEventListener('pointerleave',onLeave);window.removeEventListener('blur',onLeave);clearHover();
      settingsEntry.dispose(); panel.dispose(); disableVisuals(); style.remove();
      if ((window as any).__CODEX_GLASS__ === handle) delete (window as any).__CODEX_GLASS__;
    },
  };
  if (settings.enabled) enableVisuals();
  scan(); paint();
  return handle;
}
