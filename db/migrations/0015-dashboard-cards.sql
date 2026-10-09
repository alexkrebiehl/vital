-- ── 0015 — dashboard cards ──────────────────────────────────────────────────
--
-- The Dashboard page (src/app/dashboard) shows cards the reader placed: for now
-- one card type, `value` — one metric over one date spec (today, yesterday, or
-- a fixed range of days). Each card is one row here, in the order the reader
-- put it, with the grid size it occupies.
--
-- HARD RULE, unchanged from 0001: no health data ever reaches this database.
-- A card is CONFIGURATION: an id, the data mode it belongs to, its type, a
-- `spec` (a metric id and day keys, e.g. {"metricId": "…", "date": {…}}), a
-- layout and timestamps. It never holds a reading, a total or any other value;
-- values are computed in the browser from the active dataset on every render.
--
--   mode            'demo' or 'live', set by the server from the data mode and
--                   never sent by the browser: demo and live never share cards
--   card_type       the type id ('value'). Deliberately NOT an enum and with
--                   no list in a CHECK: a new card type must not need a
--                   migration. The pattern only bounds the shape; the
--                   application's card registry decides which types are valid
--                   and serves a row of an unknown type as unreadable instead
--                   of dropping it
--   spec            JSONB object, at most 2048 bytes, validated by the type's
--                   schema on every write and read
--   schema_version  the version of `spec` for its type, for in-memory upgrades
--   position        order within a mode, 0-based; deletes leave gaps
--   width, height   grid units, 1..4 (the widest grid is four columns)
--   revision        bumped on every edit; edits and deletes name the revision
--                   they saw, so a stale tab cannot overwrite a newer change
--
-- UNIQUE (mode, position) is DEFERRABLE so that one UPDATE can permute the
-- positions of several cards (reordering): a deferrable constraint is checked
-- at the end of the statement, not row by row, so a swap does not trip on the
-- moment two cards briefly share a position.
--
-- Immutable once shipped (see migrate-core.mjs).

CREATE TABLE IF NOT EXISTS dashboard_cards (
  id             TEXT        PRIMARY KEY,
  mode           TEXT        NOT NULL CHECK (mode IN ('demo', 'live')),
  card_type      TEXT        NOT NULL CHECK (card_type ~ '^[a-z][a-z0-9-]{0,31}$'),
  spec           JSONB       NOT NULL CHECK (jsonb_typeof(spec) = 'object'
                                             AND octet_length(spec::text) <= 2048),
  schema_version INTEGER     NOT NULL CHECK (schema_version >= 1),
  position       INTEGER     NOT NULL CHECK (position >= 0),
  width          SMALLINT    NOT NULL DEFAULT 1 CHECK (width BETWEEN 1 AND 4),
  height         SMALLINT    NOT NULL DEFAULT 1 CHECK (height BETWEEN 1 AND 4),
  revision       INTEGER     NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT dashboard_cards_mode_position UNIQUE (mode, position)
    DEFERRABLE INITIALLY IMMEDIATE
);
