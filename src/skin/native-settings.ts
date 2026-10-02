// SPDX-License-Identifier: AGPL-3.0-only
import type { SkinSettings } from './settings.ts';

let nextControlId = 0;
const MAIN = 'main[data-app-shell-main-surface="default"]';

function isVisible(element: HTMLElement): boolean {
  if (!element.getClientRects().length) return false;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  if (typeof element.checkVisibility === 'function') return element.checkVisibility({
    opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true,
  });
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    if (node.hidden) return false;
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || Number(style.opacity) === 0) return false;
  }
  return true;
}

// The native search field lives in the settings sidebar. The main can contain
// cached routes, so require both a visible settings search and a visible main,
// and reject an active chat before inserting any controls.
function settingsColumn(): HTMLElement | null {
  if (!Array.from(document.querySelectorAll<HTMLElement>('#settings-search')).some(isVisible)) return null;
  for (const main of document.querySelectorAll<HTMLElement>(MAIN)) {
    if (!isVisible(main)) continue;
    if (Array.from(main.querySelectorAll<HTMLElement>('[data-codex-composer-root],[data-thread-scroll-footer]')).some(isVisible)) continue;
    // Codex's shared settings page owns this complete content column. Its
    // heading may be deeply nested in a flex row, or a sibling of the column
    // in the slate layout, so inserting beside the h1 can alter the toolbar.
    const column = Array.from(main.querySelectorAll<HTMLElement>('[data-density][class~="group/settings"]')).find(isVisible);
    if (column) return column;
    const heading = Array.from(main.querySelectorAll<HTMLElement>('h1')).find(isVisible);
    if (heading?.parentElement) {
      const parent = heading.parentElement;
      return parent.tagName === 'HEADER' && parent.parentElement ? parent.parentElement : parent;
    }
    return Array.from(main.querySelectorAll<HTMLElement>('[data-app-shell-main-content-layout]')).find(isVisible) ?? main;
  }
  return null;
}

export function mountNativeSettingsEntry(
  onChange: (value: Partial<SkinSettings>) => void,
  getSettings: () => SkinSettings,
  openSettings: () => void,
) {
  let disposed = false;
  const section = document.createElement('section');
  section.className = 'cg-native-settings-entry';
  section.setAttribute('data-cg-settings-entry', '');
  section.setAttribute('aria-label', '液态玻璃皮肤');
  const title = document.createElement('h2');
  title.textContent = '液态玻璃皮肤';
  const row = document.createElement('div');
  row.className = 'cg-native-settings-row';
  const copy = document.createElement('div');
  copy.className = 'cg-native-settings-copy';
  const label = document.createElement('label');
  label.textContent = '启用液态玻璃皮肤';
  const description = document.createElement('small');
  description.textContent = '随时切换皮肤，关闭后恢复 Codex 原生界面。';
  const actions = document.createElement('div');
  actions.className = 'cg-native-settings-actions';
  const enabled = document.createElement('input');
  enabled.type = 'checkbox';
  enabled.id = `cg-native-settings-enabled-${++nextControlId}`;
  enabled.setAttribute('role', 'switch');
  enabled.setAttribute('aria-label', '启用液态玻璃皮肤');
  label.htmlFor = enabled.id;
  const adjust = document.createElement('button');
  adjust.type = 'button';
  adjust.textContent = '调整皮肤';
  const onEnabledChange = () => {
    if (disposed) return;
    onChange({ enabled: enabled.checked });
    sync();
  };
  const onAdjust = () => { if (!disposed) openSettings(); };
  enabled.addEventListener('change', onEnabledChange);
  adjust.addEventListener('click', onAdjust);
  copy.append(label, description);
  actions.append(enabled, adjust);
  row.append(copy, actions);
  section.append(title, row);

  function sync() {
    if (disposed) return;
    enabled.checked = getSettings().enabled;
    const checked = String(enabled.checked);
    if (enabled.getAttribute('aria-checked') !== checked) enabled.setAttribute('aria-checked', checked);
    const column = settingsColumn();
    if (!column) { section.remove(); return; }
    if (section.parentElement !== column || column.firstElementChild !== section) column.prepend(section);
  }

  sync();
  return {
    sync,
    dispose() {
      if (disposed) return;
      disposed = true;
      enabled.removeEventListener('change', onEnabledChange);
      adjust.removeEventListener('click', onAdjust);
      section.remove();
    },
  };
}
