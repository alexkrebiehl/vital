-- ── 0017 — AI providers and the model each use runs on ──────────────────────
--
-- AI configuration moves out of the environment (ANALYST_*, VITAL_LLM_*) and
-- into Settings. CONFIGURATION ONLY: no health value is stored here.
--
-- `ai_providers` holds the model servers a person has added: a name, the wire
-- protocol (`openai` = any OpenAI-compatible /chat/completions endpoint,
-- `anthropic` = the Messages API), a base URL and an optional API key. The key
-- is one AES-256-GCM encrypted JSON document under VITAL_SECRET_KEY, exactly as
-- in `source_credentials` (see `src/lib/secrets/crypto.ts`); the four key
-- columns are NULL together when the provider needs no key (a model server on
-- this machine). `key_id` detects a rotated key: such a row reads as "enter the
-- key again", never as a decryption with the wrong key.
--
-- `ai_assignments` holds which provider and model each use runs on:
--   analyst          — the chat analyst (and the lab-report second pass)
--   summary          — today's briefing and the training notes
--   summary_fallback — asked once when the summary model is unreachable or its
--                      reply fails the number check
-- A use with no row has no model: the analyst is the built-in demo and the
-- summary is computed. `options` holds the tuning chosen in Settings; it is
-- validated by the application (`src/lib/ai/types.ts`), which ignores an
-- unknown or out-of-range field rather than failing on it.
--
-- PER USER. Both tables carry `user_id`, and an assignment can only name one of
-- its own user's providers (the composite foreign key). There is no users table
-- yet, so every row is written as 'owner' (see `src/lib/identity/current-user.ts`).
-- The multi-user migration converts the column to `users.id` by joining on
-- `users.slug = 'owner'`, the slug that existing data is given there.
--
-- Deleting a provider deletes the assignments that name it (ON DELETE CASCADE);
-- the Settings page says so before it removes one.
--
-- IMMUTABLE ONCE SHIPPED (see migrate-core.mjs).

CREATE TABLE IF NOT EXISTS ai_providers (
  id          text        PRIMARY KEY,                      -- random UUID
  user_id     text        NOT NULL DEFAULT 'owner',
  name        text        NOT NULL,
  kind        text        NOT NULL CHECK (kind IN ('openai', 'anthropic')),
  base_url    text        NOT NULL,                         -- http(s), no user name or password
  ciphertext  bytea,                                        -- JSON {apiKey}; NULL = no key
  iv          bytea,                                        -- 12 bytes
  auth_tag    bytea,                                        -- 16 bytes
  key_id      text,                                         -- detects a rotated key
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  revision    integer     NOT NULL DEFAULT 1,
  UNIQUE (user_id, name),
  UNIQUE (id, user_id),
  CHECK ((ciphertext IS NULL) = (iv IS NULL)
     AND (ciphertext IS NULL) = (auth_tag IS NULL)
     AND (ciphertext IS NULL) = (key_id IS NULL))
);

COMMENT ON TABLE ai_providers IS
  'AI model servers added in Settings, per user. The API key is encrypted. Configuration only: no health value is stored here.';

CREATE TABLE IF NOT EXISTS ai_assignments (
  user_id     text        NOT NULL DEFAULT 'owner',
  use         text        NOT NULL CHECK (use IN ('analyst', 'summary', 'summary_fallback')),
  provider_id text        NOT NULL,
  model       text        NOT NULL CHECK (length(model) > 0),
  options     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  revision    integer     NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, use),
  FOREIGN KEY (provider_id, user_id) REFERENCES ai_providers (id, user_id) ON DELETE CASCADE
);

COMMENT ON TABLE ai_assignments IS
  'Which AI provider and model each use (analyst, summary, summary fallback) runs on, per user. Configuration only.';
