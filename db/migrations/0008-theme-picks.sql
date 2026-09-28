-- ── 0008 — light and dark theme picks ───────────────────────────────────────
--
-- The Themes page lets a reader pick one colour theme for the light side and one
-- for the dark side; the existing `theme` column keeps the mode (light, dark or
-- system) that chooses between them. See `src/lib/prefs/themes.ts`.
--
-- Additive, with a default, so the existing row reads as Default/Default and
-- stays valid unchanged. There is deliberately NO CHECK on the ids: every new
-- theme would otherwise need a migration. The application validates an id on
-- write and reads an unknown one (a theme since removed) as the default.
--
-- Display configuration only; no health data is involved.

ALTER TABLE preferences
  ADD COLUMN light_theme TEXT NOT NULL DEFAULT 'default',
  ADD COLUMN dark_theme  TEXT NOT NULL DEFAULT 'default';
