// ── Theme catalogue ─────────────────────────────────────
//
// The colour themes a reader can pick, one list per side. The saved
// preferences keep the mode (light, dark or match system) and one pick per side;
// the mode chooses the side and the pick chooses the palette.
//
// A theme's colours live only in `src/app/globals.css`, as a
// `[data-theme="<scheme>-<id>"]` block of the `--color-*` tokens. Adding a theme
// is that block plus one entry here; the stored preferences need no change,
// because an id is plain text and an unknown one reads back as the default.
//
// Ids are scoped to a side, so a family (a future "Solarized") can use the same
// id for its light and dark versions.
//
// This module has NO imports, so the preferences validator, the pre-paint
// script in `src/app/layout.tsx` and the Themes page all share one list.

export type ColorScheme = 'light' | 'dark';

export interface ThemeDef {
  id: string;
  scheme: ColorScheme;
  name: string;
  description?: string;
}

export const THEMES: readonly ThemeDef[] = [
  { id: 'default', scheme: 'light', name: 'Default', description: 'Warm off-white with a deep green accent.' },
  { id: 'solarized', scheme: 'light', name: 'Solarized', description: 'Ethan Schoonover’s cream base with blue accents.' },
  { id: 'github', scheme: 'light', name: 'GitHub', description: 'Crisp white and grey with GitHub blue.' },
  { id: 'gruvbox', scheme: 'light', name: 'Gruvbox', description: 'Retro parchment with earthy, muted colours.' },
  { id: 'catppuccin', scheme: 'light', name: 'Catppuccin Latte', description: 'Soft pastel light with a mauve accent.' },

  { id: 'default', scheme: 'dark', name: 'Default', description: 'Green-black with a soft sage accent.' },
  { id: 'solarized', scheme: 'dark', name: 'Solarized', description: 'Deep blue-teal base with Solarized accents.' },
  { id: 'monokai', scheme: 'dark', name: 'Monokai', description: 'The classic editor theme: warm charcoal and neon green.' },
  { id: 'dracula', scheme: 'dark', name: 'Dracula', description: 'Purple-tinted dark with vivid pink and purple.' },
  { id: 'nord', scheme: 'dark', name: 'Nord', description: 'Arctic slate with frosty blue accents.' },
  { id: 'gruvbox', scheme: 'dark', name: 'Gruvbox', description: 'Retro brown-grey with warm yellow and orange.' },
  { id: 'catppuccin', scheme: 'dark', name: 'Catppuccin Mocha', description: 'Soothing pastel on deep indigo.' },
  { id: 'tokyo-night', scheme: 'dark', name: 'Tokyo Night', description: 'Night-city navy with soft blue and violet.' },
  { id: 'one-dark', scheme: 'dark', name: 'One Dark', description: 'Atom’s cool grey with balanced accents.' },
];

export const DEFAULT_THEME_ID = 'default';

export const COLOR_SCHEMES: readonly ColorScheme[] = ['light', 'dark'];

/** The themes on one side, in catalogue order. */
export function themesFor(scheme: ColorScheme): ThemeDef[] {
  return THEMES.filter(t => t.scheme === scheme);
}

/** True when `value` names a theme on that side. */
export function isThemeId(scheme: ColorScheme, value: unknown): value is string {
  return typeof value === 'string' && THEMES.some(t => t.scheme === scheme && t.id === value);
}

/** The value of `data-theme` that selects a theme's palette in the CSS. */
export function themeAttr(scheme: ColorScheme, id: string): string {
  return `${scheme}-${id}`;
}
