import { SETTINGS_CATEGORIES } from './settingsSchema';
import type { Settings, SettingDef } from './settingsTypes';

const assign = (target: Record<string, unknown>, def: SettingDef) => {
  if (def.type === 'action') return;
  const dot = def.id.indexOf('.');
  const section = def.id.slice(0, dot);
  const key = def.id.slice(dot + 1);
  if (!target[section]) target[section] = {};
  (target[section] as Record<string, unknown>)[key] = def.default;
};

export const createDefaultSettings = (): Settings => {
  const root: Record<string, unknown> = {};
  for (const category of SETTINGS_CATEGORIES) {
    for (const def of category.settings) {
      assign(root, def);
    }
  }
  return root as unknown as Settings;
};

export const defaultSettings: Settings = createDefaultSettings();