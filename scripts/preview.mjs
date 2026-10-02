// SPDX-License-Identifier: AGPL-3.0-only
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { presets, exportTheme } from '../src/themes.mjs';

const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
]);

function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

export function createPreviewServer() {
  return createServer(async (request, response) => {
    try {
      const path = new URL(request.url, 'http://127.0.0.1').pathname;
      if (request.method === 'GET' && path === '/api/presets') return json(response, 200, presets);
      if (request.method === 'POST' && path === '/api/export') {
        if (!request.headers['content-type']?.startsWith('application/json')) {
          return json(response, 415, { error: '请使用 JSON 请求。' });
        }
        const origin = request.headers.origin;
        if (origin && origin !== `http://${request.headers.host}`) return json(response, 403, { error: '仅允许本地预览页请求。' });
        let size = 0;
        const chunks = [];
        for await (const chunk of request) {
          size += chunk.length;
          if (size > 16_384) return json(response, 413, { error: '主题配置过长。' });
          chunks.push(chunk);
        }
        let input;
        try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { return json(response, 400, { error: '请求不是有效的 JSON。' }); }
        try { return json(response, 200, exportTheme(input)); }
        catch (error) { return json(response, 400, { error: error.message }); }
      }
      const asset = request.method === 'GET' && assets.get(path);
      if (!asset) return json(response, 404, { error: '未找到页面。' });
      const body = await readFile(new URL(`../web/${asset[0]}`, import.meta.url));
      response.writeHead(200, { 'Content-Type': asset[1], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(body);
    } catch (error) {
      if (!response.headersSent) json(response, 500, { error: '预览服务暂时无法读取资源。' });
      else response.end();
    }
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const port = Number(process.env.CODEX_THEME_PREVIEW_PORT || 4785);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('预览端口无效。');
  const server = createPreviewServer();
  server.on('error', error => { console.error(`无法启动预览：${error.message}`); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`主题预览：http://127.0.0.1:${port}\n按 Ctrl+C 停止。`));
}
