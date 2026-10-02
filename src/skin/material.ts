// SPDX-License-Identifier: AGPL-3.0-only
// Glass recipe from SuperSgdk/DSH-Liquid-Glass-Theme (original author John Wu).
export const MATERIAL_CSS = `
html[data-codex-glass] body { isolation:isolate; background:transparent!important; color:var(--cg-ink); }
html[data-codex-glass] #root { background:transparent!important; }
html[data-codex-glass] [data-app-shell-frame],
html[data-codex-glass] [data-app-shell-main-content-layout],
html[data-codex-glass] main[data-app-shell-main-surface="default"] { background:transparent!important; }
html[data-codex-glass] [data-slate-sidebar-content] { background:transparent!important; }
html[data-codex-glass] [data-cg-sidebar] {
  background:transparent!important;
  border-color:transparent!important; border-radius:26px!important;
  box-shadow:none!important;
}
html[data-codex-glass] [data-cg-composer] {
  --composer-layout-surface-background:transparent!important;
  --composer-layout-surface-shadow:none!important;
  background:transparent!important;
  border-color:transparent!important;
  box-shadow:none!important;
}
html[data-codex-glass] [data-cg-composer] [data-composer-surface-variant] {
  --composer-layout-surface-background:transparent!important;
  --composer-layout-surface-backdrop-filter:none!important;
  --composer-layout-surface-shadow:none!important;
  background:transparent!important; border-color:transparent!important; box-shadow:none!important;
}
html[data-codex-glass] [data-cg-composer-surface] { border-radius:26px!important; }
html[data-codex-glass] [data-cg-main] { color:var(--cg-ink); }
html[data-codex-glass] [data-cg-card] { background:transparent!important; }
html[data-codex-glass] [data-thread-scroll-footer] .pointer-events-none.bg-surface { background:transparent!important; }
.cg-backdrop { position:fixed; inset:0; z-index:-3; pointer-events:none; overflow:hidden; }
.cg-decorations { position:fixed; inset:0; z-index:-2; pointer-events:none; overflow:hidden; }
.cg-materials { position:fixed; inset:0; z-index:-1; pointer-events:none; overflow:hidden; }
.cg-material-surface { position:absolute; pointer-events:none; background:var(--cg-glass); backdrop-filter:blur(var(--cg-blur));
  transform-origin:50% 50%; transition:transform .1s ease-out;
  background-image:radial-gradient(180px at var(--cg-glow-x,-300px) var(--cg-glow-y,-300px),var(--cg-glow-color,transparent),transparent 70%);
  box-shadow:var(--cg-press-shadow,inset 0 0 0 0 transparent),inset 0 0 0 1px var(--cg-border),inset 0 1px 0 var(--cg-inset),0 10px 36px var(--cg-shadow);
}
.cg-material-surface[data-cg-material-for=sidebar] { border-radius:26px; box-shadow:var(--cg-press-shadow,inset 0 0 0 0 transparent),inset 0 0 0 1px var(--cg-border),inset -1px 0 0 var(--cg-edge),inset 0 1px 0 var(--cg-inset),var(--cg-sidebar-shadow); }
.cg-material-surface[data-cg-material-for=panel] { background-color:var(--cg-card-glass); box-shadow:inset 0 0 0 1px var(--cg-border),0 8px 28px var(--cg-shadow); }
.cg-open-settings { position:fixed; right:18px; bottom:18px; z-index:2147483000; border:1px solid var(--cg-border); background:var(--cg-glass); backdrop-filter:blur(20px); border-radius:10px; color:var(--cg-ink); padding:8px 12px; cursor:pointer; font:13px "Segoe UI","Microsoft YaHei",sans-serif; }
.cg-settings-panel { position:fixed; right:18px; top:56px; bottom:64px; width:min(620px,calc(100vw - 36px)); overflow:auto; box-sizing:border-box; z-index:2147483001; border:1px solid var(--cg-border,rgba(128,128,128,.28)); border-radius:20px; backdrop-filter:blur(50px); background:var(--cg-settings-fill,var(--app-color-background-elevated,#fff)); color:var(--cg-ink,var(--app-color-text-foreground,#13243E)); padding:24px; box-shadow:0 18px 50px rgba(8,30,55,.22); font:14px "Segoe UI","Microsoft YaHei",sans-serif; }
.cg-settings-panel[hidden] { display:none!important; }
.cg-settings-panel header { display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; }
.cg-settings-panel header strong { font-size:18px; font-weight:600; }
.cg-settings-panel header button { font-size:24px; padding:2px 10px; }
.cg-settings-panel h3 { font-size:15px; margin:24px 0 16px; font-weight:600; }
.cg-settings-panel button,.cg-settings-panel select { border:1px solid var(--cg-border,rgba(128,128,128,.28)); border-radius:10px; color:inherit; background:var(--cg-input-fill,var(--app-color-background-control,rgba(128,128,128,.1))); padding:8px 12px; cursor:pointer; }
.cg-settings-panel select { width:100%; }
.cg-knob { display:grid; grid-template-columns:110px minmax(80px,1fr) 70px 20px; gap:12px; align-items:center; margin:14px 0; color:var(--cg-muted,var(--app-color-text-secondary,inherit)); }
.cg-knob input[type=range] { width:100%; margin:0; accent-color:#427fd5; }
.cg-knob input[type=number] { width:100%; box-sizing:border-box; border:0; border-radius:8px; padding:8px; text-align:right; font:inherit; color:var(--cg-ink,var(--app-color-text-foreground,inherit)); background:var(--cg-input-fill,var(--app-color-background-control,rgba(128,128,128,.1))); }
.cg-toggle { display:flex; align-items:center; justify-content:space-between; margin:15px 0; color:var(--cg-muted,var(--app-color-text-secondary,inherit)); }
.cg-toggle input { width:18px; height:18px; accent-color:#427fd5; }
.cg-reset { width:100%; margin-top:18px; }
.cg-native-settings-entry { box-sizing:border-box; margin:16px 0 24px; padding:18px; border:1px solid var(--cg-border,rgba(128,128,128,.28)); border-radius:16px; background:var(--cg-card-glass,var(--app-color-background-elevated,rgba(128,128,128,.06))); color:var(--cg-ink,var(--app-color-text-foreground,inherit)); font:inherit; }
.cg-native-settings-entry h2 { margin:0 0 14px; font-size:16px; font-weight:600; }
.cg-native-settings-row { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:16px; }
.cg-native-settings-copy { flex:1 1 180px; }
.cg-native-settings-copy strong { display:block; font-weight:600; }
.cg-native-settings-copy label { display:block; font-weight:600; cursor:pointer; }
.cg-native-settings-copy small { display:block; margin-top:4px; font-size:13px; color:var(--cg-muted,var(--app-color-text-secondary,inherit)); }
.cg-native-settings-copy p { margin:4px 0 0; font-size:13px; color:var(--cg-muted,var(--app-color-text-secondary,inherit)); }
.cg-native-settings-actions { display:flex; align-items:center; gap:16px; }
.cg-native-settings-actions button { border:1px solid var(--cg-border,rgba(128,128,128,.28)); border-radius:8px; color:inherit; background:var(--cg-input-fill,var(--app-color-background-control,rgba(128,128,128,.1))); padding:6px 10px; font:inherit; cursor:pointer; }
.cg-native-settings-actions input { width:18px; height:18px; accent-color:#427fd5; cursor:pointer; }
@media(max-width:540px) { .cg-settings-panel { padding:18px; } .cg-knob { grid-template-columns:85px minmax(60px,1fr) 54px 15px; gap:6px; font-size:12px; } }
@media(prefers-reduced-motion:no-preference) { .cg-backdrop { animation:cg-breathe 9s ease-in-out infinite alternate; } }
@keyframes cg-breathe { from { opacity:.86; } to { opacity:1; } }
`;
