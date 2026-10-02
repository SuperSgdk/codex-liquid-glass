// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createTestGL } from './shark-webgl-fixture.mjs';

const source = await build({
  entryPoints: [fileURLToPath(new URL('../src/decorations/shark-assembly-renderer.ts', import.meta.url))],
  bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent',
});
const { createSharkAssemblyRenderer, assemblyDisplacement } = await import(`data:text/javascript;base64,${Buffer.from(source.outputFiles[0].text).toString('base64')}`);
const data = JSON.parse(await readFile(new URL('../src/decorations/shark-particle-data.json', import.meta.url), 'utf8'));

function makeCanvas(gpu) {
  return {
    width: 1, height: 1, listeners: new Map(),
    getContext(kind, options) {
      assert.equal(kind, 'webgl2');
      assert.equal(options.alpha, true);
      assert.equal(options.premultipliedAlpha, true);
      return gpu.gl;
    },
    addEventListener(name, callback) { this.listeners.set(name, callback); },
    removeEventListener(name, callback) { if (this.listeners.get(name) === callback) this.listeners.delete(name); },
  };
}

test('固定点位RGB和爆散偏移仅上传一次，各次播放每帧只有一个drawArrays', () => {
  const gpu = createTestGL();
  const canvas = makeCanvas(gpu);
  const renderer = createSharkAssemblyRenderer(canvas);
  assert.ok(renderer);
  const vertices = gpu.uploaded();
  assert.equal(vertices.length, data.points.length * 7);
  for (let i = 0; i < data.points.length; i++) {
    const [x, y, r, g, b] = data.points[i];
    assert.ok(Math.abs(vertices[i * 7] - (x - 81.5) / 164) < 1e-6);
    assert.ok(Math.abs(vertices[i * 7 + 1] - (y - 79.5) / 164) < 1e-6);
    assert.ok(Math.abs(vertices[i * 7 + 2] - r / 255) < 1e-6);
    assert.ok(Math.abs(vertices[i * 7 + 3] - g / 255) < 1e-6);
    assert.ok(Math.abs(vertices[i * 7 + 4] - b / 255) < 1e-6);
  }
  for (const progress of [0, .1, .2, .5, 1, 0, .5, 1]) {
    assert.equal(renderer.render(progress, 504, 504, 1.5, 504 * .77), true);
  }
  assert.equal(gpu.counts.uploads, 1);
  assert.equal(gpu.counts.buffers, 1);
  assert.equal(gpu.counts.draws, 8);
  assert.equal(gpu.counts.viewport, 1, 'same-size replay keeps its viewport');
  assert.deepEqual(gpu.counts.uniforms, { u_view: 1, u_scale: 1, u_dot: 1, u_displacement: 8 }, 'only displacement changes during same-size animation');
  assert.ok(gpu.draws.every(draw => draw.count === 5745));
  assert.deepEqual([canvas.width, canvas.height], [756, 756]);
  assert.equal(gpu.draws.at(-1).uniforms.u_displacement, 0);
  renderer.dispose();
  renderer.dispose();
  assert.deepEqual([gpu.counts.deletedShaders, gpu.counts.deletedPrograms, gpu.counts.deletedBuffers, gpu.counts.deletedVaos], [2, 1, 1, 1]);
  assert.equal(canvas.listeners.size, 0);
  assert.equal(renderer.render(0, 504, 504, 1.5, 388.08), false);
});

test('实际尺寸变化才刷新视口和大小uniform，随后继续只更新位移', () => {
  const gpu = createTestGL();
  const canvas = makeCanvas(gpu);
  const renderer = createSharkAssemblyRenderer(canvas);
  renderer.render(0, 504, 504, 1.5, 388.08);
  renderer.render(.2, 360, 400, 1, 277.2);
  renderer.render(.5, 360, 400, 1, 277.2);
  assert.equal(gpu.counts.viewport, 2);
  assert.deepEqual(gpu.draws.at(-1).uniforms.u_view, [360, 400]);
  assert.equal(gpu.draws.at(-1).uniforms.u_scale, 277.2);
  assert.equal(gpu.counts.uniforms.u_view, 2);
  assert.equal(gpu.counts.uploads, 1);
  assert.deepEqual([canvas.width, canvas.height], [360, 400]);
  renderer.dispose();
});

test('短爆散后连续回到零位移，context loss停止GPU输出以便调用方降级', () => {
  assert.equal(assemblyDisplacement(0), 0);
  assert.equal(assemblyDisplacement(.2), 1);
  assert.equal(assemblyDisplacement(1), 0);
  assert.ok(assemblyDisplacement(.6) < assemblyDisplacement(.3));
  const gpu = createTestGL();
  const canvas = makeCanvas(gpu);
  const renderer = createSharkAssemblyRenderer(canvas);
  let prevented = false;
  canvas.listeners.get('webglcontextlost')({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(renderer.render(.5, 504, 504, 1.5, 388.08), false);
  assert.equal(gpu.counts.draws, 0);
  renderer.dispose();
});

test('GPU创建与编译失败安全降级并释放已经创建的资源', () => {
  assert.equal(createSharkAssemblyRenderer({ getContext() { return null; } }), null);
  assert.equal(createSharkAssemblyRenderer({ getContext() { throw new Error('unavailable'); } }), null);
  const compileFailure = createTestGL({ compile: false });
  assert.equal(createSharkAssemblyRenderer(makeCanvas(compileFailure)), null);
  assert.equal(compileFailure.counts.deletedShaders, 1);
  const linkFailure = createTestGL({ link: false });
  assert.equal(createSharkAssemblyRenderer(makeCanvas(linkFailure)), null);
  assert.deepEqual([linkFailure.counts.deletedShaders, linkFailure.counts.deletedPrograms], [2, 1]);
});
