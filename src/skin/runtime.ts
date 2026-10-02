// SPDX-License-Identifier: AGPL-3.0-only
import { mountFluidBackdrop } from '../core/backdrop.ts';
import { HUE_BASE } from '../core/fluid-tones.ts';
import { mountDecorations } from '../decorations/index.ts';
import { normalizeSettings, readSettings, writeSettings, type SkinSettings } from './settings.ts';
import { mountSettingsPanel } from './panel.ts';
import { MATERIAL_CSS } from './material.ts';
import { mountGlassSurfaces } from './surfaces.ts';

export const SELECTORS = {
  sidebar: 'aside[data-app-shell-left-panel-appearance]',
  main: 'main[data-app-shell-main-surface="default"]',
  composer: '[data-codex-composer-root]',
};

export function mountCodexSkin() {
  const root = document.documentElement;
  let storage: Storage | null = null;
  try { storage = localStorage; } catch {}
  let settings = readSettings(storage);
  let disposed = false;
  let scheme: 'light' | 'dark' = 'light';
  let main: HTMLElement | null = null;
  let decorations: ReturnType<typeof mountDecorations> | null = null;
  let scanPending = false;
  const marked = new Map<Element, Map<string, string | null>>();
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
    root.style.setProperty(name, value);
  }
  mark(root, 'data-codex-glass'); document.head.append(style); document.body.prepend(backdropHost, decorationsHost, materialsHost);
  const materials = mountGlassSurfaces(materialsHost);
  const backdrop = mountFluidBackdrop(backdropHost, { scheme: 'light', fluidHue:settings.fluidHue, fluidDepth:settings.fluidDepth, bgBrightness:settings.bgBrightness, mesh:settings.mesh });
  const panel = mountSettingsPanel(update, () => settings, { showTrigger:false });
  function resolveScheme(): 'light' | 'dark' {
    if (settings.scheme !== 'system') return settings.scheme;
    const app = root.getAttribute('data-theme') || root.getAttribute('data-color-mode');
    if (app === 'dark' || root.classList.contains('dark')) return 'dark';
    if (app === 'light' || root.classList.contains('light')) return 'light';
    return media.matches ? 'dark' : 'light';
  }
  function paint() {
    scheme = resolveScheme(); const dark = scheme === 'dark';
    const alpha = (dark ? .5 : .42) * Math.min(settings.frost / 50, 1.4);
    const ink = dark ? '#EAF2FC' : '#13243E';
    const muted = dark ? '#AFC3DC' : '#40597A';
    const glowHue = ((settings.fluidHue + HUE_BASE) % 360 + 360) % 360;
    const colors: Record<string,string> = {
      '--cg-ink': ink, '--cg-muted': muted,
      '--cg-glass': dark ? `rgba(34,38,47,${alpha})` : `rgba(255,255,255,${alpha})`,
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
      '--app-color-text-foreground-tertiary': dark ? '#8399B5' : '#5D7696',
    };
    for (const [name,value] of Object.entries(colors)) variable(name,value);
    mark(root, 'data-codex-glass-scheme', scheme);
    backdrop.update({ scheme, fluidHue:settings.fluidHue, fluidDepth:settings.fluidDepth, bgBrightness:settings.bgBrightness, mesh:settings.mesh });
    decorations?.update({ dark, whale:settings.whale, critters:settings.critters }); panel.sync();
  }
  function scan() {
    scanPending = false; if (disposed) return;
    for (const [name,selector] of Object.entries(SELECTORS)) {
      for (const element of marked.keys()) {
        if (element.hasAttribute(`data-cg-${name}`) && !element.matches(selector)) {
          if (element === hovered) clearHover();
          restoreAttribute(element, `data-cg-${name}`);
        }
      }
      for (const element of document.querySelectorAll(selector)) mark(element, `data-cg-${name}`);
    }
    const candidate = document.querySelector<HTMLElement>(SELECTORS.main);
    if (candidate !== main) {
      decorations?.dispose(); decorations = null; main = candidate;
      if (main) decorations = mountDecorations(decorationsHost, main, { dark:scheme==='dark', whale:settings.whale, critters:settings.critters });
    }
    // Release detached React nodes from the bookkeeping without retaining conversation DOM.
    for (const [element,attributes] of marked) if (!element.isConnected) {
      if (element === hovered) clearHover();
      for (const attribute of [...attributes.keys()]) restoreAttribute(element, attribute);
    }
    materials.sync([
      ...Array.from(document.querySelectorAll<HTMLElement>(SELECTORS.sidebar), element => ({ element, kind:'sidebar' as const })),
      ...Array.from(document.querySelectorAll<HTMLElement>(SELECTORS.composer), element => ({ element, kind:'composer' as const })),
    ]);
    paint();
  }
  function scheduleScan() {
    // Attribute cleanup must also work while Chromium pauses background RAFs.
    if (!disposed && !scanPending) { scanPending = true; queueMicrotask(scan); }
  }
  const observer = new MutationObserver(records => {
    if (records.some(record => record.type === 'attributes' ? true :
      [...record.addedNodes, ...record.removedNodes].some(node => node instanceof Element && !node.closest('.cg-settings-panel,.cg-backdrop,.cg-decorations,.cg-materials')))) scheduleScan();
  });
  observer.observe(document.body, { subtree:true, childList:true, attributes:true,
    attributeFilter:['data-app-shell-left-panel-appearance','data-app-shell-main-surface','data-codex-composer-root'] });
  observer.observe(root, { attributes:true, attributeFilter:['class','data-theme','data-color-mode'] });
  media.addEventListener('change', paint);
  let hovered: HTMLElement | null = null;
  function clearHover() {
    materials.clearPointer(); hovered = null;
  }
  const onPointer = (event: PointerEvent) => {
    const next = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-cg-composer],[data-cg-sidebar]') : null;
    if (next !== hovered) { clearHover(); hovered = next; }
    if (!next) return;
    materials.updatePointer(next, { x:event.clientX, y:event.clientY, spotlight:settings.spotlight,
      press:settings.press && next.hasAttribute('data-cg-composer') && !matchMedia('(prefers-reduced-motion: reduce)').matches });
  };
  const onLeave = () => clearHover();
  document.addEventListener('pointermove', onPointer, { passive:true }); document.addEventListener('pointerleave', onLeave);
  function update(value: Partial<SkinSettings>) {
    if (disposed) throw new Error('Skin has been disposed');
    settings=normalizeSettings(value,settings); clearHover(); writeSettings(storage,settings); paint();
  }
  const handle = {
    update, openSettings:panel.open,
    getStatus() { return { active:!disposed, scheme, settings:{...settings}, renderer:backdrop.getStatus(), materials:materials.getStatus(), matched:{ sidebar:document.querySelectorAll('[data-cg-sidebar]').length, composer:document.querySelectorAll('[data-cg-composer]').length, main:document.querySelectorAll('[data-cg-main]').length }, liveHost:location.protocol==='app:', centerIcon:'鲨鱼粒子图形', settingsShortcut:'Ctrl+Alt+Shift+G' }; },
    dispose() {
      if (disposed) return; disposed=true; observer.disconnect();
      media.removeEventListener('change',paint); document.removeEventListener('pointermove',onPointer);document.removeEventListener('pointerleave',onLeave);clearHover();
      panel.dispose(); decorations?.dispose(); materials.dispose(); backdrop.dispose(); style.remove();backdropHost.remove();decorationsHost.remove();materialsHost.remove();
      for (const [element,attributes] of marked) for (const [attribute,value] of attributes) { if(value===null)element.removeAttribute(attribute);else element.setAttribute(attribute,value); }
      for (const [name,{value,priority}] of originalStyle) { if(value)root.style.setProperty(name,value,priority);else root.style.removeProperty(name); }
      marked.clear();originalStyle.clear();
      if ((window as any).__CODEX_GLASS__ === handle) delete (window as any).__CODEX_GLASS__;
    },
  };
  scan();
  return handle;
}
