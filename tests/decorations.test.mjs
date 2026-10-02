// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

async function importSource(relativePath) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(relativePath, import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

const [{ createCritters }, { DECORATION_STYLES }] = await Promise.all([
  importSource('../src/decorations/critters.ts'),
  importSource('../src/decorations/styles.ts'),
]);

test('环境装饰移除 DeepSeek 小鱼并保留气泡、浮游与点击穿透', t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else delete globalThis.document;
  });
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, 'div');
      return { attributes: {}, style: {}, setAttribute(name, value) { this.attributes[name] = value; } };
    },
  };
  const decoration = createCritters();
  assert.doesNotMatch(decoration.innerHTML, /fish|deepseek|<path\b/i);
  assert.equal((decoration.innerHTML.match(/data-codex-critter="bubble"/g) || []).length, 5);
  assert.equal((decoration.innerHTML.match(/data-codex-critter="plankton"/g) || []).length, 4);
  assert.equal(decoration.attributes['aria-hidden'], 'true');
  assert.match(decoration.style.cssText, /pointer-events:none/);
  assert.doesNotMatch(DECORATION_STYLES, /fish|swim/i);
  assert.match(DECORATION_STYLES, /codex-decoration-bubble-rise/);
  assert.match(DECORATION_STYLES, /codex-decoration-plankton/);
  assert.match(DECORATION_STYLES, /prefers-reduced-motion/);
});

test('已确认的鲨鱼轮廓和原图蓝白RGB完整保留，数据不含路径或私人元数据', async () => {
  const raw = await readFile(new URL('../src/decorations/shark-particle-data.json', import.meta.url), 'utf8');
  const data = JSON.parse(raw);
  assert.deepEqual(Object.keys(data).sort(), ['height', 'points', 'width']);
  assert.deepEqual([data.width, data.height, data.points.length], [164, 160, 5745]);
  assert.equal(createHash('sha256').update(JSON.stringify(data.points)).digest('hex'),
    '360c17d91ddf7d031d94e55e493ba7c7fac9bda4d74bc976eb4db2a237393e2e');
  const pixels = new Set();
  for (const point of data.points) {
    assert.equal(point.length, 6);
    assert.ok(point.every(Number.isInteger), 'only integer position, RGB and edge flags are bundled');
    const [x, y, r, g, b, edge] = point;
    assert.ok(x >= 0 && x < data.width && y >= 0 && y < data.height);
    assert.ok([r, g, b].every(value => value >= 0 && value <= 255));
    assert.ok(edge === 0 || edge === 1);
    const pixel = `${x},${y}`;
    assert.ok(!pixels.has(pixel), 'a source pixel occurs only once');
    pixels.add(pixel);
  }
  assert.doesNotMatch(raw, /[A-Za-z]:\\|https?:\/\/|@|sourcePath|fileName|private/i);
  assert.ok(data.points.filter(([, , r, g, b]) => b > r + 70 && g > r + 60).length > 1500);
  assert.ok(data.points.filter(([, , r, g, b]) => Math.min(r, g, b) > 220).length > 1500);
});
