-- ── 0012 — body goals ───────────────────────────────────────────────────────
--
-- Body → Overview and Body → Nutrition are read against a goal the reader sets:
-- a target body weight or a target body-fat percentage, and optionally the pace
-- they want to move at. See `src/lib/body-goal/types.ts`.
--
-- HARD RULE, unchanged from 0001: no health data ever reaches this database. A
-- goal is CONFIGURATION: a kind, a target and a pace the reader chose, and the
-- day they chose it. It never holds a weigh-in, a body-fat reading or a logged
-- meal — where the reader started is read from the health data on `started_on`
-- every time it is shown, and is never stored.
--
-- At most one goal is active. Setting a new goal archives the active one (with
-- `ended_on`), so the history of phases — a cut, then maintenance, then a bulk —
-- stays readable.
--
--   kind              'weight' (target in kg) or 'body_fat' (target in %)
--   pace_kg_per_week  the reader's own pace, signed (negative = losing), or NULL
--                     to follow the recommended pace
--
-- Immutable once shipped (see migrate-core.mjs).

CREATE TABLE IF NOT EXISTS body_goals (
  id               TEXT         PRIMARY KEY,
  kind             TEXT         NOT NULL CHECK (kind IN ('weight', 'body_fat')),
  target           NUMERIC      NOT NULL CHECK (target > 0),
  pace_kg_per_week NUMERIC,
  started_on       DATE         NOT NULL,
  ended_on         DATE,
  status           TEXT         NOT NULL CHECK (status IN ('active', 'archived')),
  schema_version   INTEGER      NOT NULL DEFAULT 1,
  revision         INTEGER      NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- At most one goal is active at a time.
CREATE UNIQUE INDEX IF NOT EXISTS body_goals_one_active
  ON body_goals (status)
  WHERE status = 'active';

COMMENT ON TABLE body_goals IS
  'Body-weight and body-fat goals (configuration only — a target and a pace, never a reading). At most one is active.';
COMMENT ON COLUMN body_goals.target IS
  'kg for a weight goal, percent for a body-fat goal.';
COMMENT ON COLUMN body_goals.pace_kg_per_week IS
  'The reader''s own pace in kg/week, negative when losing; NULL follows the recommendation.';
COMMENT ON COLUMN body_goals.revision IS
  'Bumped on every write; a write naming a stale revision is refused.';
