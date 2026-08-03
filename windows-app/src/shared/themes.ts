/**
 * Theme catalogue — the single source of truth for the app's colour schemes.
 *
 * Lives in `shared/` because both processes need it: the renderer builds the
 * picker from it and stamps `data-theme` on <html> (the CSS variables for each
 * id live in `renderer/styles/global.css`), while the main process needs the
 * window's `backgroundColor` before any renderer code runs, so the window that
 * appears is already the right colour instead of flashing the default.
 */

export type ThemeId = 'midnight' | 'black' | 'graphite' | 'evergreen' | 'plum' | 'ember';

export interface ThemeMeta {
  id: ThemeId;
  label: string;
  /** One line for the picker. */
  description: string;
  /** --bg-primary. Also what the main process paints the empty window with. */
  background: string;
  /** --bg-secondary — the sidebar. Used for the picker swatch. */
  surface: string;
  /** --accent-primary. Used for the picker swatch. */
  accent: string;
}

export const THEMES: ThemeMeta[] = [
  {
    id: 'midnight',
    label: 'Midnight',
    description: 'Deep navy — the original',
    background: '#060a15',
    surface: '#0a1120',
    accent: '#3f6fd6',
  },
  {
    id: 'black',
    label: 'Pure Black',
    description: 'True #000 — no tint at all',
    background: '#000000',
    surface: '#000000',
    accent: '#5c5c5c',
  },
  {
    id: 'graphite',
    label: 'Graphite',
    description: 'Neutral charcoal with teal',
    background: '#101011',
    surface: '#17171a',
    accent: '#2f8f7d',
  },
  {
    id: 'evergreen',
    label: 'Evergreen',
    description: 'Forest green, low glare',
    background: '#060f0b',
    surface: '#0a1712',
    accent: '#2f9e63',
  },
  {
    id: 'plum',
    label: 'Plum',
    description: 'Dark violet with purple accents',
    background: '#0b0714',
    surface: '#120c1f',
    accent: '#8b5cf6',
  },
  {
    id: 'ember',
    label: 'Ember',
    description: 'Warm sepia and burnt orange',
    background: '#100a06',
    surface: '#18110b',
    accent: '#c2603a',
  },
];

export const DEFAULT_THEME_ID: ThemeId = 'midnight';

/** Settings key the chosen theme is stored under (app_config, local only). */
export const THEME_SETTING_KEY = 'theme';

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && THEMES.some((t) => t.id === value);
}

/** Falls back to the default for an unknown/missing id, so a hand-edited
 *  setting can never leave the app without a palette. */
export function resolveTheme(value: unknown): ThemeMeta {
  const id = isThemeId(value) ? value : DEFAULT_THEME_ID;
  return THEMES.find((t) => t.id === id)!;
}

export function themeBackground(value: unknown): string {
  return resolveTheme(value).background;
}
