"use strict";

(() => {
  const colorKeys = ["accent", "background", "foreground"];
  const fontKeys = ["uiFont", "codeFont"];
  const exportKeys = [...colorKeys, "uiFont", "codeFont", "contrast", "translucentSidebar"];
  const byId = (id) => document.getElementById(id);
  const elements = {
    presets: byId("presets"),
    loadError: byId("load-error"),
    reset: byId("reset-theme"),
    light: byId("light-mode"),
    dark: byId("dark-mode"),
    preview: byId("preview-window"),
    contrast: byId("contrast"),
    contrastValue: byId("contrast-value"),
    translucent: byId("translucent-sidebar"),
    name: byId("theme-name"),
    copy: byId("copy-theme"),
    copyLabel: byId("copy-theme").querySelector("span"),
    download: byId("download-theme"),
    status: byId("export-status"),
    result: byId("export-result"),
    text: byId("theme-text"),
    exportMode: byId("export-mode-label"),
    colorError: byId("color-error"),
    fontError: byId("font-error"),
    uiFont: byId("ui-font"),
    codeFont: byId("code-font"),
    readability: byId("readability"),
    readabilityText: byId("readability-text"),
  };
  const state = {
    presets: [],
    selectedId: null,
    mode: "light",
    drafts: null,
    version: 0,
    pending: false,
    export: null,
  };

  function isColor(value) {
    return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
  }

  function isFont(value) {
    return value === null || (typeof value === "string" && value.length <= 240 && !/[\u0000-\u001f\u007f-\u009f]/.test(value));
  }

  function previewFont(value, fallback) {
    return typeof value === "string" && value && CSS.supports("font-family", value) ? value : fallback;
  }

  function clonePalette(source) {
    const palette = {};
    for (const key of exportKeys) palette[key] = source[key];
    return palette;
  }

  function parseColor(value) {
    return [1, 3, 5].map((start) => parseInt(value.slice(start, start + 2), 16));
  }

  function blend(base, overlay, amount) {
    const a = parseColor(base);
    const b = parseColor(overlay);
    return "#" + a.map((channel, index) => Math.round(channel * (1 - amount) + b[index] * amount).toString(16).padStart(2, "0")).join("");
  }

  function luminance(value) {
    const channels = parseColor(value).map((channel) => {
      const normalized = channel / 255;
      return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  }

  function contrastRatio(first, second) {
    const a = luminance(first);
    const b = luminance(second);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }

  function renderReadability(ratio) {
    elements.readability.dataset.low = String(ratio < 4.5);
    elements.readabilityText.textContent = `正文对比度 ${ratio.toFixed(2)}:1${ratio < 4.5 ? " · 偏低" : ""}`;
  }

  function setStatus(message, status = "") {
    elements.status.textContent = message;
    elements.status.dataset.state = status;
  }

  function formatError(error, fallback) {
    if (error instanceof TypeError) return "无法连接本地服务，请确认服务正在运行后重试。";
    if (error instanceof SyntaxError) return "本地服务返回的内容无法读取，请刷新页面后重试。";
    return error instanceof Error ? error.message : fallback;
  }

  function invalidateExport() {
    state.version += 1;
    state.export = null;
    elements.text.value = "";
    elements.result.hidden = true;
    setStatus("配色修改会在本地预览；生成后再到 Codex 中导入。");
  }

  function currentPalette() {
    return state.drafts?.[state.mode];
  }

  function updatePreview() {
    const palette = currentPalette();
    if (!palette) return;
    const { accent, background, foreground } = palette;
    const strength = Math.max(0, Math.min(100, Number(palette.contrast))) / 100;
    const variables = {
      "--preview-accent": accent,
      "--preview-bg": background,
      "--preview-fg": foreground,
      "--preview-muted": blend(background, foreground, 0.57 + strength * 0.1),
      "--preview-sidebar": blend(background, foreground, 0.025 + strength * 0.045),
      "--preview-titlebar": blend(background, foreground, 0.016 + strength * 0.027),
      "--preview-surface": blend(background, foreground, 0.021 + strength * 0.024),
      "--preview-border": blend(background, foreground, 0.075 + strength * 0.105),
      "--preview-active": blend(background, accent, 0.085 + strength * 0.1),
      "--preview-accent-text": contrastRatio(accent, "#ffffff") >= contrastRatio(accent, "#171c18") ? "#ffffff" : "#171c18",
      "--preview-ui": previewFont(palette.uiFont, '"Segoe UI", "Microsoft YaHei", sans-serif'),
      "--preview-code": previewFont(palette.codeFont, '"Cascadia Code", Consolas, monospace'),
    };
    for (const [name, value] of Object.entries(variables)) elements.preview.style.setProperty(name, value);
    elements.preview.dataset.mode = state.mode;
    elements.preview.dataset.translucent = String(Boolean(palette.translucentSidebar));
    renderReadability(contrastRatio(background, foreground));
  }

  function renderControls() {
    const palette = currentPalette();
    if (!palette) return;
    for (const key of colorKeys) {
      byId(`${key}-color`).value = palette[key];
      byId(`${key}-text`).value = palette[key].toUpperCase();
      byId(`${key}-text`).removeAttribute("aria-invalid");
    }
    elements.colorError.hidden = true;
    for (const key of fontKeys) {
      elements[key].value = palette[key] ?? "";
      elements[key].removeAttribute("aria-invalid");
    }
    elements.fontError.hidden = true;
    elements.contrast.value = palette.contrast;
    elements.contrastValue.value = palette.contrast;
    elements.translucent.checked = Boolean(palette.translucentSidebar);
    elements.light.setAttribute("aria-pressed", String(state.mode === "light"));
    elements.dark.setAttribute("aria-pressed", String(state.mode === "dark"));
    for (const input of elements.presets.querySelectorAll("input")) input.checked = input.value === state.selectedId;
    updatePreview();
    updateButtons();
  }

  function updateButtons() {
    const ready = Boolean(currentPalette());
    const invalid = colorKeys.some((key) => byId(`${key}-text`).getAttribute("aria-invalid") === "true")
      || fontKeys.some((key) => elements[key].getAttribute("aria-invalid") === "true");
    elements.copy.disabled = !ready || state.pending || invalid;
    elements.download.disabled = !ready || state.pending || invalid;
    elements.copyLabel.textContent = state.pending ? "正在生成…" : "生成并复制";
  }

  function selectPreset(id) {
    const preset = state.presets.find((candidate) => candidate.id === id);
    if (!preset) return;
    state.selectedId = id;
    state.drafts = { light: clonePalette(preset.modes.light), dark: clonePalette(preset.modes.dark) };
    elements.name.value = preset.label;
    invalidateExport();
    renderControls();
  }

  function createPresetOption(preset) {
    const label = document.createElement("label");
    label.className = "preset-option";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "preset";
    input.value = preset.id;
    input.addEventListener("change", () => selectPreset(preset.id));

    const swatches = document.createElement("span");
    swatches.className = "preset-swatches";
    swatches.setAttribute("aria-hidden", "true");
    for (const key of ["background", "foreground", "accent"]) {
      const swatch = document.createElement("span");
      swatch.className = "preset-swatch";
      swatch.style.backgroundColor = preset.modes.light[key];
      swatches.append(swatch);
    }
    const details = document.createElement("span");
    details.className = "preset-details";
    const name = document.createElement("span");
    name.className = "preset-name";
    name.textContent = preset.label;
    const description = document.createElement("span");
    description.className = "preset-description";
    description.textContent = typeof preset.description === "string" ? preset.description : "";
    details.append(name, description);
    const check = document.createElement("span");
    check.className = "preset-check";
    check.textContent = "✓";
    check.setAttribute("aria-hidden", "true");
    label.append(input, swatches, details, check);
    return label;
  }

  function setMode(mode) {
    if (state.mode === mode) return;
    state.mode = mode;
    invalidateExport();
    renderControls();
  }

  function updateColor(key, value, source) {
    const valid = isColor(value);
    const input = byId(`${key}-text`);
    input.setAttribute("aria-invalid", String(!valid));
    elements.colorError.hidden = !colorKeys.some((candidate) => byId(`${candidate}-text`).getAttribute("aria-invalid") === "true");
    if (!valid) {
      invalidateExport();
    } else {
      const normalized = value.toLowerCase();
      if (currentPalette()[key] !== normalized) {
        currentPalette()[key] = normalized;
        invalidateExport();
      }
      byId(`${key}-color`).value = normalized;
      if (source === "picker") input.value = normalized.toUpperCase();
      updatePreview();
    }
    updateButtons();
  }

  function payload() {
    return { mode: state.mode, ...clonePalette(currentPalette()) };
  }

  async function requestExport() {
    if (state.export?.version === state.version) return state.export;
    const version = state.version;
    const exportPayload = payload();
    const filename = elements.name.value.trim() || "codex-theme";
    const response = await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(exportPayload),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "主题生成失败，请重试。");
    if (typeof result.text !== "string" || !result.text) throw new Error("服务没有返回可导入的主题文本。");
    if (state.version !== version) throw new Error("配色已更新，请重新生成当前主题。");
    state.export = { ...result, version, name: filename, mode: exportPayload.mode };
    elements.text.value = result.text;
    elements.result.hidden = false;
    elements.exportMode.textContent = `${exportPayload.mode === "light" ? "浅色" : "深色"}主题`;
    if (Number.isFinite(result.contrastRatio)) renderReadability(result.contrastRatio);
    return state.export;
  }

  async function generateAndCopy() {
    if (state.pending) return;
    state.pending = true;
    updateButtons();
    setStatus("正在生成 Codex 主题导入文本…");
    try {
      const result = await requestExport();
      try {
        if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
        await navigator.clipboard.writeText(result.text);
        setStatus(`已复制${result.mode === "light" ? "浅色" : "深色"}主题文本。请在 Codex 外观设置中导入。`, "success");
      } catch {
        elements.text.focus();
        elements.text.select();
        setStatus("浏览器未允许剪贴板访问。导入文本已选中，请按 Ctrl+C（Mac 为 ⌘C）手动复制。", "error");
      }
    } catch (error) {
      setStatus(formatError(error, "生成失败，请稍后再试。"), "error");
    } finally {
      state.pending = false;
      updateButtons();
    }
  }

  async function downloadTheme() {
    if (state.pending) return;
    state.pending = true;
    updateButtons();
    setStatus("正在准备主题文件…");
    try {
      const result = await requestExport();
      const filename = (result.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/[. ]+$/g, "").slice(0, 48) || "codex-theme") + `-${result.mode}.txt`;
      const url = URL.createObjectURL(new Blob([result.text], { type: "text/plain;charset=utf-8" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus("主题文本文件已准备下载。打开文件，复制内容后在 Codex 中导入。", "success");
    } catch (error) {
      setStatus(formatError(error, "下载失败，请稍后再试。"), "error");
    } finally {
      state.pending = false;
      updateButtons();
    }
  }

  function bindControls() {
    for (const key of colorKeys) {
      byId(`${key}-color`).addEventListener("input", (event) => updateColor(key, event.target.value, "picker"));
      byId(`${key}-text`).addEventListener("input", (event) => updateColor(key, event.target.value.trim(), "text"));
      byId(`${key}-text`).addEventListener("blur", (event) => {
        if (isColor(event.target.value.trim())) event.target.value = event.target.value.trim().toUpperCase();
      });
    }
    for (const key of fontKeys) {
      elements[key].addEventListener("input", () => {
        const value = elements[key].value;
        const valid = isFont(value);
        elements[key].setAttribute("aria-invalid", String(!valid));
        elements.fontError.hidden = !fontKeys.some((candidate) => elements[candidate].getAttribute("aria-invalid") === "true");
        invalidateExport();
        if (valid) {
          currentPalette()[key] = value.trim() || null;
          updatePreview();
        }
        updateButtons();
      });
    }
    elements.light.addEventListener("click", () => setMode("light"));
    elements.dark.addEventListener("click", () => setMode("dark"));
    elements.contrast.addEventListener("input", () => {
      currentPalette().contrast = Number(elements.contrast.value);
      elements.contrastValue.value = elements.contrast.value;
      invalidateExport();
      updatePreview();
    });
    elements.translucent.addEventListener("change", () => {
      currentPalette().translucentSidebar = elements.translucent.checked;
      invalidateExport();
      updatePreview();
    });
    elements.name.addEventListener("input", invalidateExport);
    elements.reset.addEventListener("click", () => {
      const preset = state.presets.find((candidate) => candidate.id === state.selectedId);
      state.drafts[state.mode] = clonePalette(preset.modes[state.mode]);
      invalidateExport();
      renderControls();
    });
    elements.copy.addEventListener("click", generateAndCopy);
    elements.download.addEventListener("click", downloadTheme);
  }

  async function initialize() {
    try {
      const response = await fetch("/api/presets", { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("无法读取配色预设。请确认本地服务正在运行，再刷新页面。");
      const presets = await response.json();
      if (!Array.isArray(presets) || !presets.length) throw new Error("没有可用的主题预设。");
      for (const preset of presets) {
        if (typeof preset.id !== "string" || typeof preset.label !== "string" || !preset.modes?.light || !preset.modes?.dark) throw new Error("主题预设格式不完整。");
        for (const mode of ["light", "dark"]) {
          const palette = preset.modes[mode];
          if (colorKeys.some((key) => !isColor(palette[key]))) throw new Error("预设包含无效的颜色值。");
          if (fontKeys.some((key) => !isFont(palette[key]))) throw new Error("预设包含无效的字体名称。");
          if (!Number.isFinite(Number(palette.contrast)) || Number(palette.contrast) < 0 || Number(palette.contrast) > 100) throw new Error("预设的对比度设置无效。");
        }
      }
      state.presets = presets;
      elements.presets.replaceChildren(...presets.map(createPresetOption));
      elements.presets.setAttribute("aria-busy", "false");
      for (const input of document.querySelectorAll("input:disabled, button:disabled")) input.disabled = false;
      bindControls();
      selectPreset(presets[0].id);
      setStatus("导入只改变当前主题支持的颜色、字体和侧边栏选项。");
    } catch (error) {
      elements.presets.setAttribute("aria-busy", "false");
      elements.loadError.hidden = false;
      elements.loadError.textContent = formatError(error, "主题预设加载失败。");
      setStatus("本地服务连接成功后才能生成主题。", "error");
    }
  }

  initialize();
})();
