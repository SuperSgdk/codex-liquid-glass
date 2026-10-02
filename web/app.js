'use strict';
(() => {
  const error = document.getElementById('runtime-error');
  if (!window.__CODEX_GLASS__) {
    error.hidden = false;
    error.textContent = '皮肤运行包未加载。请先执行 pnpm run build，再启动本地验证服务。';
    return;
  }
  document.getElementById('open-settings').addEventListener('click', () => window.__CODEX_GLASS__.openSettings());
})();
