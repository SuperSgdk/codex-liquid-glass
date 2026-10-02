// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { contrastRatio } from '../src/colors.mjs';
import { presets, exportTheme, parseNativeTheme, THEME_PREFIX } from '../src/themes.mjs';
import { createPreviewServer } from '../scripts/preview.mjs';

const sample = () => ({ mode: 'dark', ...presets[0].modes.dark });

test('六个预设均能往返导入，正文对比度达到 4.5:1', () => {
  assert.equal(presets.length, 3);
  for (const preset of presets) {
    for (const mode of ['light', 'dark']) {
      const result = exportTheme({ mode, ...preset.modes[mode] });
      assert.deepEqual(parseNativeTheme(result.text, mode), result.theme);
      assert.ok(result.contrastRatio >= 4.5, `${preset.id} ${mode}`);
      assert.equal(result.theme.theme.accentSource, 'custom');
      assert.equal(result.theme.theme.opaqueWindows, false);
      assert.equal(result.theme.theme.fonts.ui, preset.modes[mode].uiFont);
    }
  }
});

test('支持 URI 编码的分享文本，拒绝损坏数据和明暗模式错位', () => {
  const { text, theme } = exportTheme(sample());
  assert.deepEqual(parseNativeTheme(THEME_PREFIX + encodeURIComponent(JSON.stringify(theme)), 'dark'), theme);
  assert.deepEqual(parseNativeTheme(`\n ${text} \n`, 'dark'), theme);
  assert.throws(() => parseNativeTheme(text, 'light'), /明暗模式不匹配/);
  for (const value of ['{}', `${THEME_PREFIX}%`, `${THEME_PREFIX}{"variant":"dark"}`]) {
    assert.throws(() => parseNativeTheme(value));
  }
});

test('拒绝无效颜色、模式、字体和对比度，保留不透明设置', () => {
  for (const patch of [
    { accent: 'red' }, { foreground: '#fff' }, { background: '#GGGGGG' },
    { mode: 'system' }, { contrast: 101 }, { contrast: -1 }, { contrast: 45.5 },
    { contrast: '60' }, { uiFont: {} }, { translucentSidebar: 'true' },
  ]) assert.throws(() => exportTheme({ ...sample(), ...patch }));
  assert.equal(exportTheme({ ...sample(), translucentSidebar: false }).theme.theme.opaqueWindows, true);
  assert.equal(exportTheme({ ...sample(), codeFont: null }).theme.theme.fonts.code, null);
  assert.equal(contrastRatio('#000000', '#FFFFFF'), 21);
  assert.equal(contrastRatio('#FFFFFF', '#FFFFFF'), 1);
});

test('本地服务提供原生导出，错误输入不会被当作成功', async t => {
  const server = createPreviewServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const list = await fetch(`${base}/api/presets`);
  assert.equal(list.status, 200);
  assert.equal((await list.json()).length, 3);
  const response = await fetch(`${base}/api/export`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sample()),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(parseNativeTheme((await response.json()).text, 'dark'), exportTheme(sample()).theme);
  const invalid = await fetch(`${base}/api/export`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...sample(), accent: 'invalid' }),
  });
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).error, /颜色/);
  const foreign = await fetch(`${base}/api/export`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://example.com' }, body: JSON.stringify(sample()),
  });
  assert.equal(foreign.status, 403);
  assert.equal((await fetch(`${base}/../package.json`)).status, 404);
});
