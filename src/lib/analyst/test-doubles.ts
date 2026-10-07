// ── Test doubles for the analyst conversation store ──────────────────────────
//
// A small in-memory stand-in for Postgres that implements exactly the statements
// `@/lib/db/analyst-store` issues, with the semantics the real database has:
//
//   * a conversation list ordered by last activity, newest first;
//   * one conversation's turns in the order they were said;
//   * the per-conversation turn cap enforced inside the INSERT, exactly where the
//     real SQL enforces it;
//   * DELETE ... CASCADE: removing a conversation removes its turns;
//   * a rename changes the title but not the conversation's last-activity time.
//
// It is a TEST DOUBLE, not the store: the real SQL is exercised against the real
// database in the project's evidence run. Imported only by *.test.ts files; no
// application module imports it.

import type { SqlClient } from '@/lib/db/analyst-store';

type Row = Record<string, unknown>;

export interface RecordedCall {
  text: string;
  params: unknown[];
}

export class FakeAnalystDb implements SqlClient {
  private conversations = new Map<number, Row>();
  private messages: Row[] = [];
  private nextConversationId = 1;
  private nextMessageId = 1;
  private clock = 0;

  /** Every statement this fake was asked to run, in order. */
  readonly calls: RecordedCall[] = [];

  /** The `data_sources_seen` table. `removed_at` is only ever set by a test seeding a 0.3.0 install. */
  readonly seen = new Map<string, { first_active_at: Date; last_active_at: Date; removed_at: Date | null }>();

  /** The `source_credentials` table, as the ids that hold a row (the purge deletes them). */
  readonly credentials = new Set<string>();

  /** What `now()` answers. */
  now = new Date('2026-10-04T12:00:00Z');

  /** When set, the next query throws it (and then clears). */
  failNext: Error | null = null;

  private stamp(): string {
    this.clock += 1;
    return new Date(Date.UTC(2026, 0, 1, 0, 0, this.clock)).toISOString();
  }

  private summary(conversation: Row): Row {
    return {
      id: conversation.id,
      title: conversation.title,
      message_count: conversation.message_count,
      created_at: conversation.created_at,
      updated_at: conversation.updated_at,
    };
  }

  private messageRow(message: Row): Row {
    return { ...message };
  }

  async query(text: string, params: unknown[] = []): Promise<{ rows: Row[] }> {
    this.calls.push({ text, params: [...params] });
    if (this.failNext) {
      const error = this.failNext;
      this.failNext = null;
      throw error;
    }

    if (/^\s*(BEGIN|COMMIT|ROLLBACK)/.test(text)) return { rows: [] };

    // The explicit removal marker: create the row if missing, stamp `removed_at`.
    if (/INSERT INTO data_sources_seen \(source_id, removed_at\)/.test(text)) {
      for (const id of params[0] as string[]) {
        const prior = this.seen.get(id);
        this.seen.set(id, {
          first_active_at: prior?.first_active_at ?? this.now,
          last_active_at: prior?.last_active_at ?? this.now,
          removed_at: this.now,
        });
      }
      return { rows: [] };
    }

    if (/INSERT INTO data_sources_seen/.test(text)) {
      for (const id of params[0] as string[]) {
        const prior = this.seen.get(id);
        this.seen.set(id, {
          first_active_at: prior?.first_active_at ?? this.now,
          last_active_at: this.now,
          removed_at: null,
        });
      }
      return { rows: [] };
    }

    // The sources the lifecycle knows that are not in the active set (locked for the purge).
    if (/FOR UPDATE/.test(text) && /FROM data_sources_seen/.test(text)) {
      const active = new Set(params[0] as string[]);
      // Only a source removed on purpose (marker set) is gone; one that is merely inactive is kept.
      const rows = [...this.seen.entries()]
        .filter(([id, row]) => !active.has(id) && (!/removed_at IS NOT NULL/.test(text) || row.removed_at !== null))
        .map(([id]) => id)
        .sort()
        .map(id => ({ source_id: id }));
      return { rows };
    }

    if (/WHERE source_ids && \$1::text\[\]/.test(text)) {
      const ids = new Set(params[0] as string[]);
      const doomed = [...this.conversations.values()].filter(c => (c.source_ids as string[]).some(id => ids.has(id)));
      for (const c of doomed) {
        this.conversations.delete(c.id as number);
        // ON DELETE CASCADE.
        this.messages = this.messages.filter(m => Number(m.conversation_id) !== c.id);
      }
      return { rows: doomed.map(c => ({ id: c.id })) };
    }

    if (/DELETE FROM source_credentials/.test(text)) {
      for (const id of params[0] as string[]) this.credentials.delete(id);
      return { rows: [] };
    }

    if (/DELETE FROM data_sources_seen/.test(text)) {
      for (const id of params[0] as string[]) this.seen.delete(id);
      return { rows: [] };
    }

    if (/INSERT INTO analyst_conversations/.test(text)) {
      const [title] = params as [string, number];
      const now = this.stamp();
      const row: Row = {
        id: this.nextConversationId++,
        title,
        message_count: 0,
        archived_at: null,
        source_ids: [],
        created_at: now,
        updated_at: now,
      };
      this.conversations.set(row.id as number, row);
      return { rows: [this.summary(row)] };
    }

    if (/FROM analyst_conversations/.test(text) && /archived_at IS NULL/.test(text)) {
      const limit = Number((params as number[])[0] ?? 100);
      const rows = [...this.conversations.values()]
        .filter(c => c.archived_at === null)
        // Mirrors the real SELECT: newest CONVERSATION first, by created_at.
        .sort((a, b) => {
          const at = String(a.created_at);
          const bt = String(b.created_at);
          if (at !== bt) return at < bt ? 1 : -1;
          return Number(b.id) - Number(a.id);
        })
        .slice(0, limit)
        .map(c => this.summary(c));
      return { rows };
    }

    if (/INSERT INTO analyst_messages/.test(text)) {
      const p = params as [
        number, string, string, string | null, string | null, string | null,
        string | null, string | null, string | null, string | null, number, number, string[],
      ];
      const [conversationId, role, content, title, status, provider, model, attribution, handlerId, payload, , cap, tags] = p;
      const conversation = this.conversations.get(Number(conversationId));
      if (!conversation) return { rows: [] };
      const count = this.messages.filter(m => Number(m.conversation_id) === Number(conversationId)).length;
      if (count >= Number(cap)) return { rows: [] };
      const row: Row = {
        id: this.nextMessageId++,
        conversation_id: Number(conversationId),
        role,
        content,
        title: title ?? null,
        status: status ?? null,
        provider: provider ?? null,
        model: model ?? null,
        attribution: attribution ?? null,
        handler_id: handlerId ?? null,
        // jsonb: the driver hands back an object, so the double stores one too.
        payload: typeof payload === 'string' ? (JSON.parse(payload) as Row) : (payload ?? null),
        source_ids: [...(tags ?? [])],
        created_at: this.stamp(),
      };
      this.messages.push(row);
      conversation.message_count = count + 1;
      conversation.updated_at = row.created_at;
      conversation.revision = Number(conversation.revision ?? 1) + 1;
      // The conversation's tags are the union of its turns' tags.
      conversation.source_ids = [...new Set([...((conversation.source_ids as string[]) ?? []), ...(tags ?? [])])].sort();
      return { rows: [this.messageRow(row)] };
    }

    if (/SELECT count\(\*\)/.test(text)) {
      const id = Number((params as number[])[0]);
      return { rows: [{ count: this.messages.filter(m => Number(m.conversation_id) === id).length }] };
    }

    if (/LIMIT \$2/.test(text)) {
      const [conversationId, limit] = params as [number, number];
      const rows = this.messages
        .filter(m => Number(m.conversation_id) === Number(conversationId))
        .sort((a, b) => Number(b.id) - Number(a.id))
        .slice(0, Number(limit))
        .sort((a, b) => Number(a.id) - Number(b.id))
        .map(m => this.messageRow(m));
      return { rows };
    }

    if (/FROM analyst_messages/.test(text)) {
      const [conversationId] = params as [number];
      const rows = this.messages
        .filter(m => Number(m.conversation_id) === Number(conversationId))
        .sort((a, b) => Number(a.id) - Number(b.id))
        .map(m => this.messageRow(m));
      return { rows };
    }

    if (/UPDATE analyst_conversations/.test(text)) {
      const [id, title] = params as [number, string];
      const row = this.conversations.get(Number(id));
      if (!row) return { rows: [] };
      row.title = title;
      row.revision = Number(row.revision ?? 1) + 1;
      return { rows: [this.summary(row)] };
    }

    if (/DELETE FROM analyst_conversations/.test(text)) {
      const id = Number((params as number[])[0]);
      if (!this.conversations.has(id)) return { rows: [] };
      this.conversations.delete(id);
      // ON DELETE CASCADE.
      this.messages = this.messages.filter(m => Number(m.conversation_id) !== id);
      return { rows: [{ id }] };
    }

    // The generic single-row lookup comes LAST: several of the statements above
    // mention `analyst_conversations` in a subquery or a WHERE clause, and they
    // must be matched by their own branch first.
    if (/FROM analyst_conversations/.test(text)) {
      const id = Number((params as number[])[0]);
      const row = this.conversations.get(id);
      return { rows: row ? [this.summary(row)] : [] };
    }

    throw new Error(`FakeAnalystDb does not recognise this statement: ${text.slice(0, 60)}…`);
  }

  // ── Assertions helpers ─────────────────────────────────
  conversationCount(): number {
    return this.conversations.size;
  }

  messageCountOf(id: number): number {
    return this.messages.filter(m => Number(m.conversation_id) === id).length;
  }

  conversationIds(): number[] {
    return [...this.conversations.keys()].sort((a, b) => a - b);
  }

  /** The source tags a conversation carries. */
  sourceIdsOf(id: number): string[] {
    return [...((this.conversations.get(id)?.source_ids as string[] | undefined) ?? [])];
  }

  allMessages(): Row[] {
    return this.messages.map(m => ({ ...m }));
  }
}