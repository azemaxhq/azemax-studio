import { SETTINGS_CATEGORIES } from './settingsSchema';
import type { Settings, SettingDef, SettingValue } from './settingsTypes';

const DEFAULT_SETTINGS = () => {
  const root: Record<string, unknown> = {};
  for (const category of SETTINGS_CATEGORIES) {
    for (const def of category.settings) {
      if (def.type === 'action') continue;
      const [section, key] = def.id.split('.');
      if (!root[section]) root[section] = {};
      (root[section] as Record<string, unknown>)[key] = def.default;
    }
  }
  return root as unknown as Settings;
};

export const coerceSettingValue = (raw: unknown, def: SettingDef): SettingValue => {
  switch (def.type) {
    case 'boolean':
      return typeof raw === 'boolean' ? raw : def.default;
    case 'number':
    case 'slider': {
      const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : def.default;
      const min = def.min ?? -Infinity;
      const max = def.max ?? Infinity;
      return Math.min(max, Math.max(min, n));
    }
    case 'select': {
      const value = typeof raw === 'string' ? raw : def.default;
      return def.choices.some((c) => c.value === value) ? value : def.default;
    }
    case 'text':
      return typeof raw === 'string' ? raw : def.default;
    case 'action':
      return '';
  }
};

const sanitizeSettings = (input: unknown): Settings => {
  const defaults = DEFAULT_SETTINGS();
  if (!input || typeof input !== 'object') return defaults;

  const source = input as Record<string, unknown>;
  const result = defaults as unknown as Record<string, Record<string, unknown>>;

  for (const category of SETTINGS_CATEGORIES) {
    const section = source[category.id];
    if (!section || typeof section !== 'object') continue;
    const sectionSource = section as Record<string, unknown>;
    // A UI-only category (e.g. the BYOK credential panel) declares no
    // persisted settings, so it has no target to write into.
    const sectionTarget = result[category.id];
    if (!sectionTarget) continue;

    for (const def of category.settings) {
      if (def.type === 'action') continue;
      const key = def.id.split('.')[1];
      if (key in sectionSource) {
        sectionTarget[key] = coerceSettingValue(sectionSource[key], def);
      }
    }
  }

  return result as unknown as Settings;
};

export type ImportResult = { ok: true; settings: Settings } | { ok: false; error: string };

/**
 * Strict validation for imported settings JSON. Unlike `sanitizeSettings`
 * (which silently coerces bad values to defaults), this REJECTS the whole
 * import when any value is malformed, out of range, or unknown, so a corrupt
 * file can never silently wipe a user's configuration.
 */
export const parseImportedSettings = (raw: string): ImportResult => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'File is not valid JSON.' };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'Settings must be a JSON object.' };
  }

  const source = parsed as Record<string, unknown>;
  const validSections = new Set<string>(SETTINGS_CATEGORIES.map((c) => c.id));

  for (const sectionId of Object.keys(source)) {
    if (!validSections.has(sectionId)) {
      return { ok: false, error: `Unknown settings section "${sectionId}".` };
    }
  }

  for (const category of SETTINGS_CATEGORIES) {
    const section = source[category.id];
    if (section === undefined) continue;
    if (!section || typeof section !== 'object' || Array.isArray(section)) {
      return { ok: false, error: `Settings section "${category.id}" must be an object.` };
    }

    const sectionSource = section as Record<string, unknown>;
    const validKeys = new Set(
      category.settings.filter((d) => d.type !== 'action').map((d) => d.id.split('.')[1]),
    );

    for (const key of Object.keys(sectionSource)) {
      if (!validKeys.has(key)) {
        return { ok: false, error: `Unknown setting "${category.id}.${key}".` };
      }
    }

    for (const def of category.settings) {
      if (def.type === 'action') continue;
      const key = def.id.split('.')[1];
      if (!(key in sectionSource)) continue;
      const value = sectionSource[key];
      const error = validateValue(value, def);
      if (error) return { ok: false, error };
    }
  }

  return { ok: true, settings: sanitizeSettings(source) };
};

const validateValue = (value: unknown, def: SettingDef): string | null => {
  switch (def.type) {
    case 'boolean':
      if (typeof value !== 'boolean') {
        return `Setting "${def.id}" must be a boolean.`;
      }
      return null;
    case 'number':
    case 'slider': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return `Setting "${def.id}" must be a number.`;
      }
      const min = def.min ?? -Infinity;
      const max = def.max ?? Infinity;
      if (value < min || value > max) {
        return `Setting "${def.id}" must be between ${min} and ${max}.`;
      }
      return null;
    }
    case 'select':
      if (typeof value !== 'string') {
        return `Setting "${def.id}" must be a string.`;
      }
      if (!def.choices.some((c) => c.value === value)) {
        return `Setting "${def.id}" has an invalid value "${value}".`;
      }
      return null;
    case 'text':
      if (typeof value !== 'string') {
        return `Setting "${def.id}" must be a string.`;
      }
      return null;
    case 'action':
      return null;
  }
};

export { sanitizeSettings };
export type { Settings };