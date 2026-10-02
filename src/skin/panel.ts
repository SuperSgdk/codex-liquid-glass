// SPDX-License-Identifier: AGPL-3.0-only
import { DEFAULT_SETTINGS, type SkinSettings } from './settings.ts';

export function mountSettingsPanel(onChange: (value: Partial<SkinSettings>) => void, getSettings: () => SkinSettings, { showTrigger = true } = {}) {
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'cg-open-settings';
  trigger.textContent = '⚙ 皮肤';
  trigger.setAttribute('aria-label', '打开液态玻璃皮肤设置');
  trigger.setAttribute('aria-expanded', 'false');
  const panel = document.createElement('section');
  panel.className = 'cg-settings-panel';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', '液态玻璃皮肤设置');
  const header = document.createElement('header');
  const title = document.createElement('strong');
  title.textContent = '液态玻璃皮肤';
  const close = document.createElement('button');
  close.type = 'button'; close.textContent = '×'; close.setAttribute('aria-label', '关闭皮肤设置');
  header.append(title, close); panel.append(header);
  const controls = new Map<string, { input: HTMLInputElement; number?: HTMLInputElement }>();
  const scheme = document.createElement('select');
  scheme.setAttribute('aria-label', '外观');
  for (const [value, label] of [['system', '跟随 Codex'], ['light', '浅色'], ['dark', '深色']]) {
    const option = document.createElement('option'); option.value = value; option.textContent = label; scheme.append(option);
  }
  scheme.addEventListener('change', () => onChange({ scheme: scheme.value as SkinSettings['scheme'] }));
  panel.append(scheme);
  function group(label: string) { const h = document.createElement('h3'); h.textContent = label; panel.append(h); }
  function knob(key: keyof SkinSettings, label: string, min: number, max: number, step: number, unit: string) {
    const row = document.createElement('label'); row.className = 'cg-knob';
    const text = document.createElement('span'); text.textContent = label;
    const range = document.createElement('input'); range.type = 'range'; range.min = String(min); range.max = String(max); range.step = String(step); range.setAttribute('aria-label', label);
    const number = document.createElement('input'); number.type = 'number'; number.min = String(min); number.max = String(max); number.step = String(step); number.setAttribute('aria-label', `${label}数值`);
    const suffix = document.createElement('small'); suffix.textContent = unit;
    const apply = (source: HTMLInputElement) => {
      const value = source.valueAsNumber;
      if (Number.isFinite(value)) onChange({ [key]: Math.max(min, Math.min(max, value)) });
    };
    range.addEventListener('input', () => apply(range)); number.addEventListener('input', () => apply(number));
    number.addEventListener('blur', sync);
    row.append(text, range, number, suffix); panel.append(row); controls.set(key, { input: range, number });
  }
  function toggle(key: keyof SkinSettings, label: string) {
    const row = document.createElement('label'); row.className = 'cg-toggle';
    const text = document.createElement('span'); text.textContent = label;
    const input = document.createElement('input'); input.type = 'checkbox'; input.setAttribute('aria-label', label);
    input.addEventListener('change', () => onChange({ [key]: input.checked }));
    row.append(text, input); panel.append(row); controls.set(key, { input });
  }
  group('玻璃材质'); knob('blur', '玻璃模糊度', 0, 40, .5, 'px'); knob('frost', '磨砂度', 0, 100, 1, '%');
  group('流体背景'); knob('fluidHue', '色调', 0, 360, 1, '°'); knob('fluidDepth', '颜色深浅', 0, 100, 1, '%'); knob('bgBrightness', '背景亮度', 0, 100, 1, '%');
  group('环境装饰'); toggle('whale', '鲨鱼粒子图形'); toggle('critters', '气泡与浮游'); toggle('mesh', '网状交互');
  group('悬停效果'); toggle('spotlight', '鼠标辉光'); toggle('press', '玻璃按压光影');
  const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'cg-reset'; reset.textContent = '恢复原版默认参数';
  reset.addEventListener('click', () => onChange({ ...DEFAULT_SETTINGS })); panel.append(reset);
  function sync() {
    const settings = getSettings(); scheme.value = settings.scheme;
    for (const [key, { input, number }] of controls) {
      const value = settings[key as keyof SkinSettings];
      if (input.type === 'checkbox') input.checked = Boolean(value);
      else { input.value = String(value); if (number && document.activeElement !== number) number.value = String(value); }
    }
  }
  let previousFocus: HTMLElement | null = null;
  function open() {
    if (panel.hidden) previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.hidden = false; trigger.setAttribute('aria-expanded', 'true'); sync();
    close.focus({ preventScroll: true });
  }
  function hide() {
    const returnFocus = panel.contains(document.activeElement);
    panel.hidden = true; trigger.setAttribute('aria-expanded', 'false');
    if (returnFocus && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    previousFocus = null;
  }
  function togglePanel() { if (panel.hidden) open(); else hide(); }
  trigger.addEventListener('click', togglePanel);
  close.addEventListener('click', hide);
  // Consume Escape only inside our dialog, preserving native shortcuts elsewhere.
  panel.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !event.isComposing && !panel.hidden) {
      event.preventDefault(); event.stopPropagation(); hide();
    }
  });
  const onKey = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing) return;
    if (event.key.toLowerCase() === 'g' && event.ctrlKey && event.altKey && event.shiftKey && !event.metaKey && !event.repeat) {
      event.preventDefault(); togglePanel();
    }
  };
  document.addEventListener('keydown', onKey);
  if (showTrigger) document.body.append(trigger);
  document.body.append(panel); sync();
  return { sync, open, dispose() { hide(); trigger.remove(); panel.remove(); document.removeEventListener('keydown', onKey); } };
}
