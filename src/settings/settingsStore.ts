import { useSyncExternalStore } from 'react';
import { getSettingDefinition, registerActionHandler } from './settingsSchema';
import { defaultSettings } from './settingsDefaults';
import { loadSettings } from './settingsPersistence';
import type { Settings, SettingValue } from './settingsTypes';
import { sanitizeSettings, coerceSettingValue, parseImportedSettings } from './settingsValidation';
import { dialogAlert } from '../components/UI/dialogService';

let current: Settings = loadSettings();

const listeners = new Set<() => void>();

const notify = () => {
  for (const listener of listeners) listener();
};

export const getSettings = (): Settings => current;
export const getAllSettings = (): Settings => current;

export const getSetting = (key: string): unknown => {
  const dot = key.indexOf('.');
  if (dot === -1) return undefined;
  const section = current[key.slice(0, dot) as keyof Settings];
  if (!section || typeof section !== 'object') return undefined;
  return (section as unknown as Record<string, unknown>)[key.slice(dot + 1)];
};

export const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useSettingsStore = <S>(selector: (state: Settings) => S): S => {
  return useSyncExternalStore(
    subscribe,
    () => selector(current),
    () => selector(current),
  );
};

export const useSettingsSelector = <S>(selector: (state: Settings) => S): S => {
  return useSettingsStore(selector);
};

export const useSetting = <T>(key: string): T => {
  return useSettingsStore((state) => {
    const dot = key.indexOf('.');
    if (dot === -1) return undefined as unknown as T;
    const section = state[key.slice(0, dot) as keyof Settings];
    if (!section || typeof section !== 'object') return undefined as unknown as T;
    return (section as unknown as Record<string, unknown>)[key.slice(dot + 1)] as T;
  });
};

const setByPath = (state: Settings, key: string, value: unknown): Settings => {
  const dot = key.indexOf('.');
  if (dot === -1) return state;
  const section = key.slice(0, dot) as keyof Settings;
  const field = key.slice(dot + 1);
  const currentSection = state[section];
  if (!currentSection || typeof currentSection !== 'object') return state;
  return {
    ...state,
    [section]: {
      ...currentSection,
      [field]: value,
    },
  };
};

export const setSettings = (partial: Partial<Settings>): void => {
  current = sanitizeSettings({ ...current, ...partial });
  notify();
};

export const updateSettings = (
  sectionOrPartial: keyof Settings | Partial<Settings>,
  updates?: Record<string, unknown>,
): void => {
  if (typeof sectionOrPartial === 'string') {
    if (!updates) return;
    const section = sectionOrPartial as keyof Settings;
    const nextSection = { ...(current[section] as unknown as Record<string, unknown>), ...updates };
    current = sanitizeSettings({ ...current, [section]: nextSection });
  } else {
    current = sanitizeSettings({ ...current, ...sectionOrPartial });
  }
  notify();
};

export const setSetting = (key: string, value: SettingValue): void => {
  const def = getSettingDefinition(key);
  if (!def) return;
  current = setByPath(current, key, coerceSettingValue(value, def));
  notify();
};

export const resetSetting = (key: string): void => {
  const def = getSettingDefinition(key);
  if (!def || def.type === 'action') return;
  current = setByPath(current, key, def.default);
  notify();
};

export const resetCategory = (category: keyof Settings): void => {
  const defaults = defaultSettings[category];
  if (!defaults) return;
  current = sanitizeSettings({ ...current, [category]: defaults });
  notify();
};

export const resetAllSettings = (): void => {
  current = sanitizeSettings(defaultSettings);
  notify();
};

registerActionHandler('privacy.exportSettings', () => {
  const blob = new Blob([JSON.stringify(current, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'azemax-settings.json';
  a.click();
  URL.revokeObjectURL(url);
});

registerActionHandler('privacy.importSettings', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = parseImportedSettings(String(reader.result));
      if (result.ok) {
        setSettings(result.settings);
        dialogAlert({ title: 'Settings imported', message: 'Your settings have been imported successfully.' });
      } else {
        dialogAlert({ title: 'Import failed', message: result.error });
      }
    };
    reader.readAsText(file);
  };
  input.click();
});