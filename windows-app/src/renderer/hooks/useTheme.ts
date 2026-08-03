import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_THEME_ID,
  THEME_SETTING_KEY,
  isThemeId,
  type ThemeId,
} from '../../shared/themes';

/**
 * Stamps the chosen theme on <html> as `data-theme`; the palettes themselves
 * are the `:root[data-theme=…]` blocks in styles/global.css.
 */
function stamp(theme: ThemeId): void {
  document.documentElement.dataset.theme = theme;
}

/**
 * The active colour theme, persisted in app_config so it survives a restart
 * and so the main process can paint the window the same colour at launch.
 * Local to this device — themes are not synced.
 */
export function useTheme() {
  const [theme, setThemeState] = useState<ThemeId>(DEFAULT_THEME_ID);

  useEffect(() => {
    let active = true;
    (async () => {
      const saved = await window.electronAPI.settingsGet(THEME_SETTING_KEY);
      if (!active || !isThemeId(saved)) return;
      setThemeState(saved);
      stamp(saved);
    })();
    return () => { active = false; };
  }, []);

  // Applied immediately, then written — the swatch shouldn't wait on SQLite.
  const setTheme = useCallback(async (next: ThemeId) => {
    setThemeState(next);
    stamp(next);
    await window.electronAPI.settingsSet(THEME_SETTING_KEY, next);
  }, []);

  return { theme, setTheme };
}
