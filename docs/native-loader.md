# 在真正的 Codex 窗口里加载皮肤

这条路线把本仓库编译出的流体背景和玻璃样式放进 Codex 自己的界面。原来的聊天、侧边栏、输入框仍由 Codex 处理。浏览器预览只用于检查视觉和代码，不能代替桌面接入验收。

本机还没有执行过真实接入。代码和当前安装包支持尝试这条路线，但正常重开 Codex 后能否拿到主界面调试目标，仍要实际验证。

## 为什么需要明确启动

2026-10-02 只读检查的安装包是 `OpenAI.Codex_26.930.2377.0_x64__2p2nqsd0c76g0`，应用版本 `26.930.21537`，构建 `12776`。正在运行的主进程没有远程调试参数，也没有调试监听端口。生产版本关闭了主界面的 DevTools 菜单。

包内主界面加载的是 `app://-/index.html`，可附带 `initialRoute` 查询参数。原生配色主题的字段只有颜色、字体、对比度及窗口透明开关，没有加载流体脚本的字段。[官方外观文档](https://learn.chatgpt.com/docs/reference/settings)说明了这些原生设置。

运行时二进制包含 Chromium 的 `remote-debugging-port` 开关。与包中依赖版本对应的 [Electron 42.3.0 调试服务源码](https://github.com/electron/electron/blob/v42.3.0/shell/browser/ui/devtools_manager_delegate.cc)使用本机回环监听；[WebContents 源码](https://github.com/electron/electron/blob/v42.3.0/shell/browser/api/electron_api_web_contents.cc)中的 `devTools: false` 限制打开 DevTools。安装包使用定制运行时，不能仅凭这些源码就把真实连接说成已经成功。

Windows 版有单实例锁：已有进程时，再启动一次只会把参数交给旧进程，不会替它打开调试端口。因此需要先保存内容、结束正在进行的任务，并正常完全退出 Codex。脚本遇到仍在运行的 Codex 会直接停止，不会替用户退出或强制结束它。

## 使用

在本仓库目录中，先安装开发依赖并构建：

```powershell
pnpm install
pnpm build
```

需要 Node.js 22 或更新版本。以下命令默认只检查已有调试连接，既不启动应用，也不安装皮肤：

```powershell
node scripts/codex-skin.mjs
node scripts/codex-skin.mjs --inspect --port 9223
```

用户明确选择接入并正常完全退出 Codex 后，再在独立 PowerShell 窗口运行：

```powershell
powershell -NoProfile -File .\scripts\start-codex-skin.ps1
```

它会查找当前生产版安装路径，检查是否有同一程序的进程及端口冲突，再用原程序和原生产版配置启动：

```text
ChatGPT.exe --remote-debugging-port=9223 --remote-debugging-address=127.0.0.1
```

脚本不修改安装包、`app.asar`、用户配置、环境变量或登录资料，也不切换 `BUILD_FLAVOR`。启动后最多等 20 秒，再明确调用 `--apply`。首次运行用 Ctrl+Alt+Shift+G 打开皮肤设置，Esc 关闭。需要确认真正的桌面窗口出现流体背景、侧边栏和输入框透出背景，滑块能实时改色，原侧栏、输入框及弹窗的位置和大小保持不变，原生聊天功能仍可正常使用。玻璃和鼠标光影绘制在独立底层，不为原节点增加边框、滤镜或变换。

已经由用户手动打开调试端口时，可以分别使用：

```powershell
node scripts/codex-skin.mjs --apply --port 9223
node scripts/codex-skin.mjs --remove --port 9223
```

`--apply` 只读本仓库的 `dist/codex-glass.runtime.js` 并在主界面执行；`--remove` 调用它的 `dispose()` 并核验全局句柄已移除。加载器只接受同一回环端口的一个 `type: page`、URL 为 `app://-/index.html` 的目标；多个主窗口、普通网站、内嵌浏览器、预览页和 iframe 都会被排除或拒绝。返回内容只有目标 ID、应用 URL、运行时版本及皮肤状态，不读取聊天内容、密钥或浏览器存储。

## 回退与连接边界

临时调试端口会让本机能连接它的程序检查和控制应用界面。只在本机测试时开启，不把它绑定到外部地址，不转发端口。测试结束后先执行 `--remove`，再正常退出 Codex，按平时的方式打开；普通启动不附带本次调试参数。加载器每条命令执行完就断开连接。

如果执行超时，脚本会把结果标为未知，再做一次仅查询皮肤状态的核验，不自动重试加载或移除。先看核验结果，避免重复操作。网页刷新或应用更新会清掉临时注入，新的版本也可能改变 DOM，需要重新核验适配。

本机运行时启用了 ASAR 完整性校验及只从 ASAR 加载应用的保护。直接修改安装资源可能导致签名或完整性失效、启动失败，也会被升级覆盖；本实现不使用这条路线。

## 当前适配依据

以下选择器来自上述版本的包内源码，尚不能当成真实运行中的验收结果：

- 根节点：`#root` 与 `[data-app-shell-frame]`。
- 左侧栏：`aside[data-app-shell-left-panel-appearance]`、`[data-slate-sidebar-content]`。
- 主内容：`main[data-app-shell-main-surface="default"]`。
- Codex 输入框：`[data-codex-composer-root]`，玻璃表面：`[data-composer-surface-variant]`。
- 输入框样式变量：`--composer-layout-surface-background`、`--composer-layout-surface-backdrop-filter`、`--composer-layout-surface-shadow`。

这组依据用于制作可检查的适配代码；真实桌面验收和后续版本兼容仍需单独记录。
