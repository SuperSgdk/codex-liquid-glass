# 原生主题兼容记录

核验日期：2026-10-02。目标为 Windows 上的 Codex 桌面界面，不是 Codex CLI 的 `.tmTheme` 文件。

## 来源

- 官方设置文档：https://learn.chatgpt.com/docs/reference/settings
- 官方插件说明：https://learn.chatgpt.com/plugins/concepts/plugins
- 本机当前应用的主题解析器和类型校验代码：只读核查安装资源，没有修改或复制应用安装包。

本机核验版本为 MSIX `26.930.2377.0`，应用资源版本 `26.930.21537`，build `12776`。这是此版本的兼容记录，不保证未来版本保持相同内部格式。

## 分享格式

文本以 `codex-theme-v1:` 开头，后接 JSON 对象：

```json
{
  "codeThemeId": "codex",
  "theme": {
    "accent": "#76BAFF",
    "accentSource": "custom",
    "contrast": 60,
    "fonts": {
      "code": "Cascadia Code, Consolas, monospace",
      "ui": "Segoe UI, Microsoft YaHei, sans-serif"
    },
    "ink": "#E7F0F7",
    "opaqueWindows": false,
    "semanticColors": {
      "diffAdded": "#4EA774",
      "diffRemoved": "#F3757E",
      "skill": "#B29DEA"
    },
    "surface": "#0E151D"
  },
  "variant": "dark"
}
```

`surface` 是背景色，`ink` 是正文色。预览页中的 `translucentSidebar` 取反映射到 `opaqueWindows`。`accentSource: custom` 避免使用账户默认强调色。

颜色必须为六位十六进制字符串；对比度为 0–100 的整数。原生分享解析器会先将对比度转换为数字，生成器直接输出整数。`fonts.code`、`fonts.ui` 接受字体族字符串或 `null`。`semanticColors` 的增加、删除和技能颜色也必须存在。本原型使用两种模式均有的内置 `codex` 代码主题，未实现完整代码主题编辑器。

本机解析器支持直接 JSON 和 URI 编码的 JSON，不使用 Base64。导入时要求 `variant` 与外观设置中选择的明暗区域匹配，并验证代码主题 ID。主题文本不包含字体大小、壁纸或动态背景代码。

## 验证范围

自动检查验证生成内容和解析规则，浏览器检查验证预览页面。本次还在隔离的离线 Node VM 中，用本机安装资源中的原始导入函数、实际 Zod schema 和内置主题注册表验证了全部六份导出；错误明暗模式、未知代码主题及带 alpha 的颜色反例均被拒绝。应用源码没有纳入本仓库，校验版本及哈希记录见 `validation-20261002.json`。

桌面应用中的真实导入与视觉效果须由用户在设置界面确认；未自动改写个人主题配置，也未修改应用资源。Windows 原生背景效果要求 GPU 合成及系统 backdrop 支持，配置为 `opaqueWindows: false` 不等于系统已实际渲染半透明。

正文对比度计算使用主题的前景和背景原色，不包含 Codex 后续颜色派生、透明混合、语法高亮和系统背景变化，因此不是整个桌面界面的可访问性认证。
