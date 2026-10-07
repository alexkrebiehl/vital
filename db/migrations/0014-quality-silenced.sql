-- ── 0014 — silenced data-quality findings ───────────────────────────────────
--
-- Some data-quality findings (see `src/lib/adapters/quality.ts`) cannot be
-- resolved: the reader cannot re-export a gap, or does not want to. Settings →
-- Sources lets them silence a finding; a silenced finding is no longer shown as
-- an issue anywhere, including the data pipeline status and its counts.
--
-- HARD RULE, unchanged from 0001: no health data ever reaches this database.
-- A silenced finding is CONFIGURATION: which check, and which metric when the
-- check is per metric. It never holds a record, a day range or a value — the
-- days a finding covers are recomputed from the health data every time, and a
-- silenced check + metric hides the finding for all of its days, including days
-- that show up later.
--
--   check_id   a QualityCheckId ('late-start', 'missing-days', …)
--   metric_id  the registry metric id, or '' when the check is not per metric
--
-- Immutable once shipped (see migrate-core.mjs).

CREATE TABLE IF NOT EXISTS quality_silenced (
  check_id    TEXT        NOT NULL,
  metric_id   TEXT        NOT NULL DEFAULT '',
  silenced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (check_id, metric_id)
);
