/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useEffect, useMemo, memo } from 'react';
import type { ReactNode } from 'react';
import type { Settings } from '../types/settings';
import { saveSettings } from '../settings/settingsPersistence';
import {
  setSettings,
  getSettings,
  getSetting,
  getAllSettings,
  setSetting,
  resetSetting,
  resetCategory,
  resetAllSettings,
  subscribe,
  useSettingsStore,
  useSettingsSelector,
} from '../settings/settingsStore';
import type { SettingValue } from '../settings/settingsTypes';
import { useSettingsApplier } from '../hooks/useSettingsApplier';

export interface SettingsContextType {
  settings: Settings;
  updateSettings: (section: keyof Settings, updates: Partial<Settings[keyof Settings]>) => void;
  resetSettings: () => void;
  setSetting: (key: string, value: SettingValue) => void;
  resetSetting: (key: string) => void;
  resetCategory: (category: keyof Settings) => void;
  resetAllSettings: () => void;
  getSetting: (key: string) => unknown;
  getAllSettings: () => Settings;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export const useSettings = () => {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
};

export { useSettingsSelector, useSettingsStore };

interface SettingsProviderProps {
  children: ReactNode;
}

export const SettingsProvider: React.FC<SettingsProviderProps> = memo(({ children }) => {
  useEffect(() => {
    const unsubscribe = subscribe(() => {
      try {
        saveSettings(getSettings());
      } catch {
        // Persistence failures are non-fatal; settings remain in memory.
      }
    });
    return unsubscribe;
  }, []);

  useSettingsApplier();

  const settings = useSettingsStore((s) => s);

  const value = useMemo<SettingsContextType>(() => ({
    settings,
    updateSettings: (section, updates) => {
      const sectionValue = settings[section];
      const merged = sectionValue && typeof sectionValue === 'object'
        ? { ...(sectionValue as unknown as Record<string, unknown>), ...updates }
        : { ...updates };
      setSettings({ ...settings, [section]: merged } as Partial<Settings>);
    },
    resetSettings: resetAllSettings,
    setSetting,
    resetSetting,
    resetCategory,
    resetAllSettings,
    getSetting,
    getAllSettings,
  }), [settings]);

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
});