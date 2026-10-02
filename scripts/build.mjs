// SPDX-License-Identifier: AGPL-3.0-only
import { mkdir, writeFile } from 'node:fs/promises';
import { presets, exportTheme, parseNativeTheme } from '../src/themes.mjs';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

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
await build({
  entryPoints: [fileURLToPath(new URL('../src/browser-entry.ts', import.meta.url))],
  outfile: fileURLToPath(new URL('../dist/codex-glass.runtime.js', import.meta.url)),
  bundle:true, format:'iife', platform:'browser', target:'es2022', legalComments:'inline',
});
await build({
  entryPoints: {
    settings:fileURLToPath(new URL('../src/skin/settings.ts', import.meta.url)),
    tones:fileURLToPath(new URL('../src/core/fluid-tones.ts', import.meta.url)),
  },
  outdir:fileURLToPath(new URL('../dist/check/', import.meta.url)),
  bundle:true, format:'esm', platform:'node', target:'node22', outExtension:{'.js':'.mjs'},
});
console.log('已生成流体玻璃运行包 dist/codex-glass.runtime.js。');
