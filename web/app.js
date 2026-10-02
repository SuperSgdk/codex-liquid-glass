'use strict';
(() => {
  const error = document.getElementById('runtime-error');
  if (!window.__CODEX_GLASS__) {
    error.hidden = false;
    error.textContent = '皮肤运行包未加载。请先执行 pnpm run build，再启动本地验证服务。';
    return;
  }
  document.getElementById('open-settings').addEventListener('click', () => window.__CODEX_GLASS__.openSettings());
  const main = document.querySelector('main[data-app-shell-main-surface]');
  const sidebar = document.querySelector('[data-slate-sidebar-content]');
  const chatMain = [...main.childNodes];
  const chatSidebar = [...sidebar.childNodes];
  const pageSwitch = document.getElementById('show-app-settings');
  let settingsPage = false;
  pageSwitch.addEventListener('click', () => {
    settingsPage = !settingsPage;
    main.replaceChildren(...(settingsPage ? [document.getElementById('settings-page-template').content.cloneNode(true)] : chatMain));
    sidebar.replaceChildren(...(settingsPage ? [document.getElementById('settings-sidebar-template').content.cloneNode(true)] : chatSidebar));
    pageSwitch.textContent = settingsPage ? '返回聊天示例' : '设置页示例';
  });
})();
