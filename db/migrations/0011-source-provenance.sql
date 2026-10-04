-- ── 0011 — which sources fed each answer ────────────────────────────────────
--
-- "Removing a source erases it" (plan §8): when a data source is removed, the
-- analyst conversations derived from it must be hidden at once and deleted after
-- a grace period. For that, each turn and each conversation records WHICH
-- sources fed it: a set of source ids ('hae', 'oura', 'hevy', 'lab').
--
-- SOURCE TAGS ONLY: ids of sources, never a health value, a metric or a source's
-- own device name. The hard rule of 0001 is unchanged.
--
-- `data_sources_seen` is the lifecycle record: when a source was first and last
-- active, and when it was found removed (NULL while active). It is what turns
-- "this source is gone" into "hide, then purge after VITAL_SOURCE_PURGE_GRACE_DAYS".
--
-- BACKFILL. Every answer written before this migration was built from Health
-- Auto Export, so every message and conversation gets {hae}. An assistant turn
-- whose retrieval handler, retrieval note or tool list shows lab retrieval gets
-- 'lab' as well. A conversation's set is the union over its messages.
-- (The payload keys used are the ones `StoredAssistantPayload` writes:
-- retrieval.note and toolsUsed. handler_id is its own column.)

ALTER TABLE analyst_messages
  ADD COLUMN IF NOT EXISTS source_ids text[] NOT NULL DEFAULT '{}';

ALTER TABLE analyst_conversations
  ADD COLUMN IF NOT EXISTS source_ids text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN analyst_messages.source_ids IS
  'Ids of the data sources whose data entered this turn (hae, oura, hevy, lab). Tags only.';
COMMENT ON COLUMN analyst_conversations.source_ids IS
  'Union of the source_ids of the conversation''s turns. A tag of a removed source hides the conversation.';

CREATE INDEX IF NOT EXISTS analyst_conversations_source_ids
  ON analyst_conversations USING gin (source_ids);

CREATE TABLE IF NOT EXISTS data_sources_seen (
  source_id       text        PRIMARY KEY,
  first_active_at timestamptz NOT NULL DEFAULT now(),
  last_active_at  timestamptz NOT NULL DEFAULT now(),
  removed_at      timestamptz                       -- NULL while active
);

COMMENT ON TABLE data_sources_seen IS
  'When each data source was first and last active, and when it was found removed. Lifecycle only: no health data.';

-- Backfill: only rows that carry no tag yet, so a re-run changes nothing.
UPDATE analyst_messages
   SET source_ids = CASE
     WHEN role = 'assistant' AND (
            handler_id = 'lab-results'
         OR payload #>> '{retrieval,note}' LIKE '%Lab results: %'
         OR jsonb_exists_any(payload -> 'toolsUsed', ARRAY['get_lab_results', 'compare_lab_panels'])
     ) THEN ARRAY['hae', 'lab']
     ELSE ARRAY['hae']
   END
 WHERE source_ids = '{}'::text[];

UPDATE analyst_conversations c
   SET source_ids = COALESCE(
     NULLIF(
       ARRAY(
         SELECT DISTINCT s
           FROM analyst_messages m
          CROSS JOIN LATERAL unnest(m.source_ids) AS s
          WHERE m.conversation_id = c.id
          ORDER BY s
       ),
       '{}'::text[]
     ),
     ARRAY['hae']
   )
 WHERE c.source_ids = '{}'::text[];
