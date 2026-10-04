-- ── 0010 — users: one row per profile, and every per-person table keyed by it ─
--
-- Vital serves the profiles the deployment declares (VITAL_PROFILES; see
-- src/lib/identity/profiles.ts). Each profile is one `users` row, and every
-- table that holds one person's configuration or records now carries `user_id`.
--
-- Existing data: everything stored before this migration belonged to the one
-- owner. It is assigned to a `users` row with slug `owner`; at runtime that row
-- is renamed to the first declared profile when VITAL_PROFILES names one (see
-- src/lib/db/users-store.ts), so an upgrade loses nothing and moves nothing.
--
-- `external_issuer` / `external_subject` are unused today. They are where an
-- external identity provider (OIDC: issuer + subject) attaches to an existing
-- person without re-keying any data.
--
-- HARD RULE, unchanged from 0001: no health data reaches this database. A user
-- row is a slug and an id.
--
-- IMMUTABLE ONCE SHIPPED (see migrate-core.mjs).

CREATE TABLE IF NOT EXISTS users (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  slug             TEXT         NOT NULL UNIQUE CHECK (slug ~ '^[a-z][a-z0-9-]{0,31}$'),
  external_issuer  TEXT,
  external_subject TEXT,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (external_issuer, external_subject),
  CHECK ((external_issuer IS NULL) = (external_subject IS NULL))
);

COMMENT ON TABLE users IS
  'One row per declared profile. Configuration only — no health data.';
COMMENT ON COLUMN users.slug IS
  'The profile slug from VITAL_PROFILES (or `owner` when none is declared).';
COMMENT ON COLUMN users.external_subject IS
  'Reserved for an external identity provider: the subject it names this person by.';

INSERT INTO users (slug) VALUES ('owner') ON CONFLICT (slug) DO NOTHING;

-- ── profile, preferences: one row per user instead of id = 1 ────────────────

ALTER TABLE profile ADD COLUMN user_id UUID REFERENCES users (id) ON DELETE CASCADE;
UPDATE profile SET user_id = (SELECT id FROM users WHERE slug = 'owner');
ALTER TABLE profile DROP COLUMN id;
ALTER TABLE profile ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE profile ADD PRIMARY KEY (user_id);

ALTER TABLE preferences ADD COLUMN user_id UUID REFERENCES users (id) ON DELETE CASCADE;
UPDATE preferences SET user_id = (SELECT id FROM users WHERE slug = 'owner');
ALTER TABLE preferences DROP COLUMN id;
ALTER TABLE preferences ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE preferences ADD PRIMARY KEY (user_id);

COMMENT ON TABLE profile IS
  'One profile record per user. Configuration only — no health data.';
COMMENT ON TABLE preferences IS
  'One display-preferences record per user. Configuration only — no health data.';

-- ── analyst conversations ───────────────────────────────────────────────────
-- Messages are reached only through their conversation, so they stay keyed by it.

ALTER TABLE analyst_conversations ADD COLUMN user_id UUID REFERENCES users (id) ON DELETE CASCADE;
UPDATE analyst_conversations SET user_id = (SELECT id FROM users WHERE slug = 'owner');
ALTER TABLE analyst_conversations ALTER COLUMN user_id SET NOT NULL;

DROP INDEX IF EXISTS analyst_conversations_recent_idx;
CREATE INDEX analyst_conversations_recent_idx
  ON analyst_conversations (user_id, updated_at DESC, id DESC)
  WHERE archived_at IS NULL;

-- ── lab reports and results ─────────────────────────────────────────────────
-- A document is unique per PERSON: two people may upload the same file.
-- `lab_results.user_id` repeats its report's owner so the per-analyte history
-- queries filter on one column.

ALTER TABLE lab_reports ADD COLUMN user_id UUID REFERENCES users (id) ON DELETE CASCADE;
UPDATE lab_reports SET user_id = (SELECT id FROM users WHERE slug = 'owner');
ALTER TABLE lab_reports ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE lab_reports DROP CONSTRAINT IF EXISTS lab_reports_source_sha256_key;
ALTER TABLE lab_reports
  ADD CONSTRAINT lab_reports_user_sha256_unique UNIQUE (user_id, source_sha256);

ALTER TABLE lab_results ADD COLUMN user_id UUID REFERENCES users (id) ON DELETE CASCADE;
UPDATE lab_results l SET user_id = r.user_id FROM lab_reports r WHERE r.id = l.report_id;
ALTER TABLE lab_results ALTER COLUMN user_id SET NOT NULL;

DROP INDEX IF EXISTS lab_results_analyte_idx;
CREATE INDEX lab_results_analyte_idx ON lab_results (user_id, analyte_key, result_on);
DROP INDEX IF EXISTS lab_results_analyte_panel_idx;
CREATE INDEX lab_results_analyte_panel_idx ON lab_results (user_id, analyte_key, panel, result_on);

-- ── training plans: at most one active plan PER USER ────────────────────────

ALTER TABLE training_plans ADD COLUMN user_id UUID REFERENCES users (id) ON DELETE CASCADE;
UPDATE training_plans SET user_id = (SELECT id FROM users WHERE slug = 'owner');
ALTER TABLE training_plans ALTER COLUMN user_id SET NOT NULL;

DROP INDEX IF EXISTS training_plans_one_active;
CREATE UNIQUE INDEX training_plans_one_active
  ON training_plans (user_id)
  WHERE status = 'active';

-- ── activity maps: ordered per user ─────────────────────────────────────────

ALTER TABLE activity_maps ADD COLUMN user_id UUID REFERENCES users (id) ON DELETE CASCADE;
UPDATE activity_maps SET user_id = (SELECT id FROM users WHERE slug = 'owner');
ALTER TABLE activity_maps ALTER COLUMN user_id SET NOT NULL;

DROP INDEX IF EXISTS activity_maps_position;
CREATE INDEX activity_maps_position ON activity_maps (user_id, position);
