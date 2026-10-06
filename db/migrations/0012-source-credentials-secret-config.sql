-- ── 0012 — source credentials: secret configuration rows ────────────────────
--
-- Health Auto Export is configured from Settings: an endpoint and an API key,
-- stored as one AES-256-GCM encrypted JSON document in the same table as the
-- OAuth credentials (source_id = 'hae'). It has no access token and so no
-- expiry; the column becomes nullable. Oura rows still always carry a value.
-- CREDENTIALS ONLY: no health value is stored here.

ALTER TABLE source_credentials ALTER COLUMN access_expires_at DROP NOT NULL;
