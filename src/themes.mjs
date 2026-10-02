// SPDX-License-Identifier: AGPL-3.0-only
import { normalizeHex, contrastRatio } from './colors.mjs';

export const THEME_PREFIX = 'codex-theme-v1:';
const UI_FONT = 'Segoe UI, Microsoft YaHei, sans-serif';
const CODE_FONT = 'Cascadia Code, Consolas, monospace';
const mode = (accent, background, foreground, contrast) => ({
  accent, background, foreground, contrast,
  uiFont: UI_FONT, codeFont: CODE_FONT, translucentSidebar: true,
});

export const presets = [
  {
    id: 'ice-blue', label: '冰蓝', description: '冷色背景与清晰的蓝色强调，适合日常编码。',
    modes: {
      light: mode('#0875C5', '#EFF5FB', '#173246', 45),
      dark: mode('#76BAFF', '#0E151D', '#E7F0F7', 60),
    },
  },
  {
    id: 'mist-gray', label: '雾灰', description: '柔和的中性灰，减少大面积彩色背景。',
    modes: {
      light: mode('#526778', '#F5F5F4', '#202528', 45),
      dark: mode('#9FB9CF', '#171B20', '#EFF1F3', 60),
    },
  },
  {
    id: 'dusk-purple', label: '暮紫', description: '低饱和紫色背景，搭配柔和的强调色。',
    modes: {
      light: mode('#7858A6', '#F5F1FA', '#322844', 45),
      dark: mode('#BBA1E3', '#191323', '#F2EAFA', 60),
    },
  },
];

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label}必须是对象。`);
  return value;
}

function font(value, label) {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > 240 || /[\x00-\x1f\x7f]/.test(value)) {
    throw new TypeError(`${label}必须是字体名称或 null。`);
  }
  return value;
}

function contrast(value) {
  if (!Number.isInteger(value) || value < 0 || value > 100) throw new TypeError('对比度必须是 0 到 100 的整数。');
  return value;
}

function variant(value) {
  if (value !== 'light' && value !== 'dark') throw new TypeError('主题模式必须是 light 或 dark。');
  return value;
}

export function createNativeTheme(input) {
  plainObject(input, '主题');
  const selectedMode = variant(input.mode);
  if (typeof input.translucentSidebar !== 'boolean') throw new TypeError('半透明侧边栏设置必须是布尔值。');
  const dark = selectedMode === 'dark';
  return {
    codeThemeId: 'codex',
    theme: {
      accent: normalizeHex(input.accent),
      accentSource: 'custom',
      contrast: contrast(input.contrast),
      fonts: { code: font(input.codeFont, '代码字体'), ui: font(input.uiFont, '界面字体') },
      ink: normalizeHex(input.foreground),
      opaqueWindows: !input.translucentSidebar,
      semanticColors: {
        diffAdded: dark ? '#4EA774' : '#2E8B57',
        diffRemoved: dark ? '#F3757E' : '#CF3948',
        skill: dark ? '#B29DEA' : '#836BC9',
      },
      surface: normalizeHex(input.background),
    },
    variant: selectedMode,
  };
}

export function validateNativeTheme(value, expectedMode) {
  const payload = plainObject(value, '原生主题');
  const selectedMode = variant(payload.variant);
  if (expectedMode !== undefined && selectedMode !== variant(expectedMode)) {
    throw new TypeError('明暗模式不匹配，请在 Codex 对应的明亮或深色主题下导入。');
  }
  // This prototype exports only the built-in Codex code theme, available in both variants.
  if (payload.codeThemeId !== 'codex') throw new TypeError('此原型只支持内置 codex 代码主题。');
  const theme = plainObject(payload.theme, '主题配置');
  for (const color of ['accent', 'ink', 'surface']) normalizeHex(theme[color]);
  contrast(theme.contrast);
  if (typeof theme.opaqueWindows !== 'boolean') throw new TypeError('opaqueWindows 必须是布尔值。');
  if (theme.accentSource !== undefined && !['custom', 'chatgpt'].includes(theme.accentSource)) {
    throw new TypeError('accentSource 无效。');
  }
  const fonts = plainObject(theme.fonts, '字体配置');
  font(fonts.ui, '界面字体');
  font(fonts.code, '代码字体');
  if (fonts.content !== undefined) font(fonts.content, '正文字体');
  for (const field of ['uiFace', 'codeFace', 'contentFace']) {
    if (fonts[field] === undefined) continue;
    const face = plainObject(fonts[field], '字体元信息');
    for (const key of ['family', 'fullName', 'postscriptName']) {
      if (typeof face[key] !== 'string') throw new TypeError('字体元信息无效。');
    }
  }
  const semantic = plainObject(theme.semanticColors, '语义颜色');
  for (const field of ['diffAdded', 'diffRemoved', 'skill']) normalizeHex(semantic[field]);
  return payload;
}

export function serializeNativeTheme(payload) {
  validateNativeTheme(payload);
  return THEME_PREFIX + JSON.stringify(payload);
}

export function parseNativeTheme(text, expectedMode) {
  if (typeof text !== 'string' || text.length > 32_768) throw new TypeError('主题文本为空或过长。');
  const trimmed = text.trim();
  if (!trimmed.startsWith(THEME_PREFIX)) throw new TypeError(`主题必须以 ${THEME_PREFIX} 开头。`);
  const content = trimmed.slice(THEME_PREFIX.length);
  let payload;
  try {
    payload = JSON.parse(content.startsWith('{') ? content : decodeURIComponent(content));
  } catch {
    throw new TypeError('主题文本不是有效的 Codex 主题 JSON。');
  }
  return validateNativeTheme(payload, expectedMode);
}

export function exportTheme(input) {
  const theme = createNativeTheme(input);
  return {
    text: serializeNativeTheme(theme), theme,
    contrastRatio: contrastRatio(theme.theme.ink, theme.theme.surface),
  };
}
