// SPDX-License-Identifier: AGPL-3.0-only
export interface SkinSettings {
  enabled: boolean;
  scheme: 'system' | 'light' | 'dark';
  blur: number;
  frost: number;
  fluidHue: number;
  fluidDepth: number;
  bgBrightness: number;
  whale: boolean;
  critters: boolean;
  mesh: boolean;
  spotlight: boolean;
  press: boolean;
}

export const SETTINGS_KEY = 'codex.glass.skin.v1';
export const DEFAULT_SETTINGS: SkinSettings = {
  enabled: true,
  scheme: 'system', blur: 20, frost: 7, fluidHue: 320, fluidDepth: 25,
  bgBrightness: 50, whale: true, critters: true, mesh: true, spotlight: true, press: true,
};

export function normalizeSettings(input: Partial<SkinSettings> = {}, previous = DEFAULT_SETTINGS): SkinSettings {
  const result = { ...previous };
  const bounds = { blur: [0, 40], frost: [0, 100], fluidHue: [0, 360], fluidDepth: [0, 100], bgBrightness: [0, 100] };
  for (const [key, range] of Object.entries(bounds)) {
    const value = input[key as keyof SkinSettings];
    if (value === undefined) continue;
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${key} must be a finite number`);
    (result as any)[key] = Math.min(range[1], Math.max(range[0], value));
  }
  for (const key of ['enabled', 'whale', 'critters', 'mesh', 'spotlight', 'press'] as const) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== 'boolean') throw new TypeError(`${key} must be boolean`);
    result[key] = input[key]!;
  }
  if (input.scheme !== undefined) {
    if (!['system', 'light', 'dark'].includes(input.scheme)) throw new TypeError('Unknown appearance scheme');
    result.scheme = input.scheme;
  }
  return result;
}

export function readSettings(storage: Storage | null): SkinSettings {
  try { return normalizeSettings(JSON.parse(storage?.getItem(SETTINGS_KEY) || '{}')); }
  catch { return { ...DEFAULT_SETTINGS }; }
}

export function writeSettings(storage: Storage | null, settings: SkinSettings): void {
  try { storage?.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* Session-only settings remain usable. */ }
}
