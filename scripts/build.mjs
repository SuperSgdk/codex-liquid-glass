// SPDX-License-Identifier: AGPL-3.0-only
import { mkdir, writeFile } from 'node:fs/promises';
import { presets, exportTheme, parseNativeTheme } from '../src/themes.mjs';

const destination = new URL('../dist/', import.meta.url);
await mkdir(destination, { recursive: true });
const manifest = [];
for (const preset of presets) {
  for (const mode of ['light', 'dark']) {
    const result = exportTheme({ name: preset.label, mode, ...preset.modes[mode] });
    parseNativeTheme(result.text, mode);
    const file = `${preset.id}-${mode}.txt`;
    await writeFile(new URL(file, destination), result.text + '\n', 'utf8');
    manifest.push({ preset: preset.id, label: preset.label, mode, file, textContrastRatio: Number(result.contrastRatio.toFixed(2)) });
  }
}
await writeFile(new URL('manifest.json', destination), JSON.stringify({ format: 'codex-theme-v1', themes: manifest }, null, 2) + '\n', 'utf8');
console.log(`已生成 ${manifest.length} 个原生主题文本，位于 dist/。`);
