import { describe, expect, it } from 'vitest';
import {
  deleteConversationForApi,
  listConversationsForApi,
  memoryTurnsFor,
  readConversationForApi,
  renameConversationForApi,
  appendExchange,
} from '@/lib/analyst/conversations';
import { askAnalyst } from '@/lib/analyst/service';
import { FakeAnalystDb } from '@/lib/analyst/test-doubles';
import { insertConversation, insertMessage } from '@/lib/db/analyst-store';
import { recordActiveSources, syncLifecycle } from '@/lib/sources/lifecycle';

async function tagged(db: FakeAnalystDb, title: string, sourceIds: string[]): Promise<number> {
  const conversation = await insertConversation(db, title);
  await insertMessage(db, conversation.id, { role: 'user', content: 'a question' }, 200);
  await insertMessage(
    db,
    conversation.id,
    { role: 'assistant', content: 'an answer', status: 'ok', provider: 'p', model: 'm', attribution: 'a', sourceIds },
    200
  );
  return conversation.id;
}

async function world() {
  const db = new FakeAnalystDb();
  await recordActiveSources(db, ['hae', 'oura']);
  const hae = await tagged(db, 'Watch only', ['hae']);
  const ring = await tagged(db, 'Ring only', ['oura']);
  const mixed = await tagged(db, 'Both', ['hae', 'oura']);
  return { db, hae, ring, mixed };
}

describe('recordActiveSources', () => {
  it('stamps the active sources and marks none removed', async () => {
    const db = new FakeAnalystDb();
    const change = await recordActiveSources(db, ['oura', 'hae']);
    expect(change.removed).toEqual([]);
    expect([...db.seen.keys()].sort()).toEqual(['hae', 'oura']);
    expect([...db.seen.values()].every(row => row.removed_at === null)).toBe(true);
  });

  it('marks a source seen before but not active now as removed, once', async () => {
    const db = new FakeAnalystDb();
    await recordActiveSources(db, ['hae', 'oura']);
    db.advanceDays(1);
    expect((await recordActiveSources(db, ['hae'])).removed).toEqual(['oura']);
    const removedAt = db.seen.get('oura')!.removed_at;
    expect(removedAt).toEqual(db.now);
    expect(db.seen.get('hae')!.removed_at).toBeNull();

    // A second pass does not move the timestamp: the grace period is counted
    // from the first time the removal was noticed.
    db.advanceDays(2);
    expect((await recordActiveSources(db, ['hae'])).removed).toEqual([]);
    expect(db.seen.get('oura')!.removed_at).toEqual(removedAt);
  });

  it('clears the removal when the source is active again', async () => {
    const db = new FakeAnalystDb();
    await recordActiveSources(db, ['hae', 'oura']);
    await recordActiveSources(db, ['hae']);
    await recordActiveSources(db, ['hae', 'oura']);
    expect(db.seen.get('oura')!.removed_at).toBeNull();
  });

  it('does not invent a source it never saw', async () => {
    const db = new FakeAnalystDb();
    await recordActiveSources(db, ['hae']);
    await recordActiveSources(db, []);
    expect([...db.seen.keys()]).toEqual(['hae']);
  });
});

describe('syncLifecycle', () => {
  it('does nothing without a database', async () => {
    expect(await syncLifecycle(['hae'], {} as NodeJS.ProcessEnv, () => null)).toBeNull();
  });

  it('records through the injected client', async () => {
    const db = new FakeAnalystDb();
    await syncLifecycle(['hae'], {} as NodeJS.ProcessEnv, () => db);
    expect([...db.seen.keys()]).toEqual(['hae']);
  });
});

describe('hiding what came from a removed source', () => {
  it('lists every conversation while all sources are active', async () => {
    const { db } = await world();
    const listed = await listConversationsForApi({ client: db });
    expect(listed.ok && listed.conversations.map(c => c.title).sort()).toEqual(['Both', 'Ring only', 'Watch only']);
  });

  it('hides the oura-tagged conversations and keeps the hae-only one', async () => {
    const { db, hae } = await world();
    await recordActiveSources(db, ['hae']);
    const listed = await listConversationsForApi({ client: db });
    expect(listed.ok && listed.conversations.map(c => c.id)).toEqual([hae]);
  });

  it('answers 404 for a hidden conversation, exactly as for one that never existed', async () => {
    const { db, hae, ring, mixed } = await world();
    await recordActiveSources(db, ['hae']);
    const never = await readConversationForApi({ client: db }, 9999);
    for (const id of [ring, mixed]) {
      const hidden = await readConversationForApi({ client: db }, id);
      expect(hidden.ok).toBe(false);
      expect(hidden.status).toBe(404);
      expect(hidden.ok === false && hidden.error.replace(String(id), 'N')).toBe(
        never.ok === false ? never.error.replace('9999', 'N') : ''
      );
    }
    expect((await readConversationForApi({ client: db }, hae)).ok).toBe(true);
  });

  it('cannot rename or delete a hidden conversation', async () => {
    const { db, ring } = await world();
    await recordActiveSources(db, ['hae']);
    expect((await renameConversationForApi({ client: db }, ring, 'x')).status).toBe(404);
    expect((await deleteConversationForApi({ client: db }, ring)).status).toBe(404);
    expect(db.conversationCount()).toBe(3);
  });

  it('cannot load a hidden conversation as thread memory', async () => {
    const { db, ring, hae } = await world();
    expect((await memoryTurnsFor({ client: db }, ring)).length).toBeGreaterThan(0);
    await recordActiveSources(db, ['hae']);
    expect(await memoryTurnsFor({ client: db }, ring)).toEqual([]);
    expect((await memoryTurnsFor({ client: db }, hae)).length).toBeGreaterThan(0);
  });

  it('refuses a new turn on a hidden conversation instead of resurrecting it', async () => {
    const { db, ring } = await world();
    await recordActiveSources(db, ['hae']);
    const response = await askAnalyst({ query: 'How is my HRV trending?' }, { env: {} as NodeJS.ProcessEnv });
    const before = db.messageCountOf(ring);
    const result = await appendExchange({ client: db }, ring, 'How is my HRV trending?', response, ['hae']);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
    expect(db.messageCountOf(ring)).toBe(before);
  });

  it('makes the conversations visible again when the source returns within the grace period', async () => {
    const { db, ring, mixed } = await world();
    await recordActiveSources(db, ['hae']);
    expect((await readConversationForApi({ client: db }, ring)).status).toBe(404);
    db.advanceDays(3);
    await recordActiveSources(db, ['hae', 'oura']);
    for (const id of [ring, mixed]) expect((await readConversationForApi({ client: db }, id)).ok).toBe(true);
    const listed = await listConversationsForApi({ client: db });
    expect(listed.ok && listed.conversations).toHaveLength(3);
  });

  it('hides lab-tagged conversations when the last lab report is gone', async () => {
    const db = new FakeAnalystDb();
    await recordActiveSources(db, ['hae', 'lab']);
    const lab = await tagged(db, 'Panels', ['lab']);
    await recordActiveSources(db, ['hae']);
    expect((await readConversationForApi({ client: db }, lab)).status).toBe(404);
  });
});
