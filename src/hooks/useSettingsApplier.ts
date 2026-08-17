import { useEffect } from 'react';
import { getSettings, subscribe } from '../settings/settingsStore';

const ROOT_CLASSES = {
  reducedMotion: 'settings-reduced-motion',
  disableAnimations: 'settings-no-animations',
  performanceMode: 'settings-performance-mode',
  largerUiText: 'settings-larger-ui-text',
  highContrast: 'settings-high-contrast',
} as const;

export const useSettingsApplier = () => {
  useEffect(() => {
    const root = document.documentElement;

    const apply = () => {
      const settings = getSettings();
      root.classList.toggle(ROOT_CLASSES.reducedMotion, settings.performance.reducedMotion);
      root.classList.toggle(ROOT_CLASSES.disableAnimations, settings.performance.disableAnimations);
      root.classList.toggle(ROOT_CLASSES.performanceMode, settings.performance.performanceMode);
      root.classList.toggle(ROOT_CLASSES.largerUiText, settings.general.largerUiText);
      root.classList.toggle(ROOT_CLASSES.highContrast, settings.general.highContrast);
      root.setAttribute('data-settings-mode', settings.performance.performanceMode ? 'performance' : 'normal');
    };

    apply();
    return subscribe(apply);
  }, []);
};