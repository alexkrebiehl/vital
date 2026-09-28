-- ── 0007 — training plans and their revisions ───────────────────────────────
--
-- The routine on the Workouts page follows a training plan: focus areas,
-- progression paths and their stages, the rules for moving on, time blocks,
-- session templates and a schedule. The analyst creates and edits plans with
-- its tools, and the reader can undo any change, so every write is kept as a
-- revision.
--
-- HARD RULE, unchanged from 0001: no health data ever reaches this database. A
-- plan is CONFIGURATION: targets ("3–4 sets of 8–12"), which stage a path is on
-- and the date it started, and holds the reader asked for ("paused: low-back
-- discomfort"). It never holds a measured set, a session, a weight reading or
-- any other observation — performance is read live from the workout sources
-- and Health Auto Export on every request and is never stored.
--
-- `plan` is the whole validated document (src/lib/routine/types.ts
-- `TrainingPlan`). It is JSONB rather than tables per concept because the plan is
-- always read and written as one unit and validated by the application on the
-- way in and out.
--
-- Immutable once shipped (see migrate-core.mjs): a later change arrives as a
-- new file with the next version number.
--
-- Numbered 0007, not 0004: it was written as 0004 on a branch while upstream's
-- lab migrations took 0004–0006, and the runner refuses two files with one
-- version. A database that already applied it as 0004 relabels that row once:
--   UPDATE schema_migrations SET version = '0007', checksum = '<sha256 of this file>'
--    WHERE version = '0004' AND name = 'training-plans';
-- after which 0004–0006 apply as usual. Every statement here is IF NOT EXISTS,
-- so running it again on such a database changes nothing.

CREATE TABLE IF NOT EXISTS training_plans (
  id             TEXT         PRIMARY KEY,
  status         TEXT         NOT NULL CHECK (status IN ('active', 'archived')),
  plan           JSONB        NOT NULL,
  schema_version INTEGER      NOT NULL DEFAULT 1,
  revision       INTEGER      NOT NULL DEFAULT 1,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- At most one plan is active at a time.
CREATE UNIQUE INDEX IF NOT EXISTS training_plans_one_active
  ON training_plans (status)
  WHERE status = 'active';

COMMENT ON TABLE training_plans IS
  'Training plans (configuration only — targets and stage choices, never measured sets). At most one is active.';
COMMENT ON COLUMN training_plans.plan IS
  'The validated TrainingPlan document. Never contains an observation.';
COMMENT ON COLUMN training_plans.revision IS
  'Bumped on every write; a write naming a stale revision is refused.';

CREATE TABLE IF NOT EXISTS training_plan_revisions (
  plan_id    TEXT         NOT NULL REFERENCES training_plans (id) ON DELETE CASCADE,
  revision   INTEGER      NOT NULL,
  source     TEXT         NOT NULL CHECK (source IN ('analyst', 'user')),
  summary    TEXT         NOT NULL,
  plan       JSONB        NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (plan_id, revision)
);

COMMENT ON TABLE training_plan_revisions IS
  'Every saved version of a plan, for undo and history. Configuration only.';
COMMENT ON COLUMN training_plan_revisions.summary IS
  'One line saying what changed and why ("Moved horizontal push to decline push-up").';
