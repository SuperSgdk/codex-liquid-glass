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
  border-color:var(--cg-border); border-right-color:var(--cg-edge);
  box-shadow:none!important;
}
html[data-codex-glass] [data-cg-composer] {
  --composer-layout-surface-background:transparent!important;
  --composer-layout-surface-shadow:none!important;
  background:transparent!important;
  border-color:var(--cg-border);
  box-shadow:none!important;
}
html[data-codex-glass] [data-cg-composer] [data-composer-surface-variant] {
  --composer-layout-surface-background:transparent!important;
  --composer-layout-surface-shadow:none!important;
  background:transparent!important; box-shadow:none!important;
}
html[data-codex-glass] [data-cg-main] { color:var(--cg-ink); }
.cg-backdrop { position:fixed; inset:0; z-index:-3; pointer-events:none; overflow:hidden; }
.cg-decorations { position:fixed; inset:0; z-index:-2; pointer-events:none; overflow:hidden; }
.cg-materials { position:fixed; inset:0; z-index:-1; pointer-events:none; overflow:hidden; }
.cg-material-surface { position:absolute; pointer-events:none; background:var(--cg-glass); backdrop-filter:blur(var(--cg-blur));
  background-image:radial-gradient(180px at var(--cg-glow-x,-300px) var(--cg-glow-y,-300px),var(--cg-glow-color,transparent),transparent 70%);
  box-shadow:var(--cg-press-shadow,inset 0 0 0 0 transparent),inset 0 0 0 1px var(--cg-border),inset 0 1px 0 var(--cg-inset),0 10px 36px var(--cg-shadow);
}
.cg-material-surface[data-cg-material-for=sidebar] { box-shadow:inset 0 0 0 1px var(--cg-border),inset -1px 0 0 var(--cg-edge),inset 0 1px 0 var(--cg-inset),var(--cg-sidebar-shadow); }
.cg-open-settings { position:fixed; right:18px; bottom:18px; z-index:2147483000; border:1px solid var(--cg-border); background:var(--cg-glass); backdrop-filter:blur(20px); border-radius:10px; color:var(--cg-ink); padding:8px 12px; cursor:pointer; font:13px "Segoe UI","Microsoft YaHei",sans-serif; }
.cg-settings-panel { position:fixed; right:18px; top:56px; bottom:64px; width:min(620px,calc(100vw - 36px)); overflow:auto; box-sizing:border-box; z-index:2147483001; border:1px solid var(--cg-border); border-radius:20px; backdrop-filter:blur(50px); background:var(--cg-settings-fill); color:var(--cg-ink); padding:24px; box-shadow:0 18px 50px rgba(8,30,55,.22); font:14px "Segoe UI","Microsoft YaHei",sans-serif; }
.cg-settings-panel[hidden] { display:none!important; }
.cg-settings-panel header { display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; }
.cg-settings-panel header strong { font-size:18px; font-weight:600; }
.cg-settings-panel header button { font-size:24px; padding:2px 10px; }
.cg-settings-panel h3 { font-size:15px; margin:24px 0 16px; font-weight:600; }
.cg-settings-panel button,.cg-settings-panel select { border:1px solid var(--cg-border); border-radius:10px; color:inherit; background:var(--cg-input-fill); padding:8px 12px; cursor:pointer; }
.cg-settings-panel select { width:100%; }
.cg-knob { display:grid; grid-template-columns:110px minmax(80px,1fr) 70px 20px; gap:12px; align-items:center; margin:14px 0; color:var(--cg-muted); }
.cg-knob input[type=range] { width:100%; margin:0; accent-color:#427fd5; }
.cg-knob input[type=number] { width:100%; box-sizing:border-box; border:0; border-radius:8px; padding:8px; text-align:right; font:inherit; color:var(--cg-ink); background:var(--cg-input-fill); }
.cg-toggle { display:flex; align-items:center; justify-content:space-between; margin:15px 0; color:var(--cg-muted); }
.cg-toggle input { width:18px; height:18px; accent-color:#427fd5; }
.cg-reset { width:100%; margin-top:18px; }
@media(max-width:540px) { .cg-settings-panel { padding:18px; } .cg-knob { grid-template-columns:85px minmax(60px,1fr) 54px 15px; gap:6px; font-size:12px; } }
@media(prefers-reduced-motion:no-preference) { .cg-backdrop { animation:cg-breathe 9s ease-in-out infinite alternate; } }
@keyframes cg-breathe { from { opacity:.86; } to { opacity:1; } }
`;
