import { useEffect } from 'react';
import { useSettingsSelector } from '../context/SettingsContext';

export const useTheme = () => {
  // Granular selectors: only theme/font changes re-render this hook, instead of
  // subscribing to the whole settings object (which re-renders on every tweak).
  const theme = useSettingsSelector(s => s.general.theme);
  const fontFamily = useSettingsSelector(s => s.editor.fontFamily);

  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;

    // Apply theme class
    root.classList.remove('theme-dark', 'theme-light', 'theme-auto');

    if (theme === 'auto') {
      // Check system preference
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.classList.add(prefersDark ? 'theme-dark' : 'theme-light');
      body.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    } else {
      root.classList.add(`theme-${theme}`);
      body.setAttribute('data-theme', theme);
    }

    // Apply font family
    root.style.setProperty('--editor-font-family', fontFamily);

    // Update Monaco editor theme
    const monacoTheme = theme === 'light' ? 'vs-light' : 'vs-dark';

    // Store theme for Monaco editor to use
    root.setAttribute('data-monaco-theme', monacoTheme);

  }, [theme, fontFamily]);

  // Listen for system theme changes when in auto mode
  useEffect(() => {
    if (theme !== 'auto') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent) => {
      const root = document.documentElement;
      const body = document.body;

      root.classList.remove('theme-dark', 'theme-light');
      root.classList.add(e.matches ? 'theme-dark' : 'theme-light');
      body.setAttribute('data-theme', e.matches ? 'dark' : 'light');

      const monacoTheme = e.matches ? 'vs-dark' : 'vs-light';
      root.setAttribute('data-monaco-theme', monacoTheme);
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme]);

  return {
    currentTheme: theme,
    fontFamily,
    isDark: theme === 'dark' ||
      (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  };
};