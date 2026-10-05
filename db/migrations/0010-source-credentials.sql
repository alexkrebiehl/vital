-- ── 0010 — source credentials ───────────────────────────────────────────────
--
-- OAuth credentials for live data sources (Oura today). CREDENTIALS ONLY: no
-- health value is ever stored here or anywhere else in this database.
--
-- Oura's refresh token is single-use and rotates on every refresh, so it cannot
-- live in .env. The access and refresh tokens are kept together as one JSON
-- document, AES-256-GCM encrypted with VITAL_SECRET_KEY (see
-- `src/lib/secrets/crypto.ts`). `key_id` is the first 8 hex characters of
-- sha256(key): a row written under a different key is reported as "needs
-- reconnect" rather than being decrypted with the wrong one.
--
-- `scopes` is what the user actually granted, space separated. `revision` goes
-- up on every write, so a refresh and a reconnect can be told apart.

CREATE TABLE IF NOT EXISTS source_credentials (
  source_id         text        PRIMARY KEY,           -- 'oura'
  ciphertext        bytea       NOT NULL,              -- JSON {access_token, refresh_token}
  iv                bytea       NOT NULL,              -- 12 bytes
  auth_tag          bytea       NOT NULL,              -- 16 bytes
  key_id            text        NOT NULL,              -- detects a rotated key
  scopes            text        NOT NULL DEFAULT '',   -- granted scopes, space separated
  access_expires_at timestamptz NOT NULL,
  connected_at      timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  revision          integer     NOT NULL DEFAULT 1
);

COMMENT ON TABLE source_credentials IS
  'Encrypted OAuth credentials for live data sources. Credentials only: no health value is stored here.';
