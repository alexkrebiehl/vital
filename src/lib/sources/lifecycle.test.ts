import { describe, expect, it } from 'vitest';
import { listConversationsForApi, readConversationForApi } from '@/lib/analyst/conversations';
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

/** Everything the fake holds that mentions the source, in any table. */
function mentions(db: FakeAnalystDb, sourceId: string): string[] {
  const found: string[] = [];
  for (const id of db.conversationIds()) if (db.sourceIdsOf(id).includes(sourceId)) found.push(`conversation ${id}`);
  for (const m of db.allMessages()) if ((m.source_ids as string[]).includes(sourceId)) found.push(`message ${m.id}`);
  if (db.seen.has(sourceId)) found.push('data_sources_seen');
  return found;
}

describe('recordActiveSources', () => {
  it('stamps the active sources and purges nothing', async () => {
    const db = new FakeAnalystDb();
    const change = await recordActiveSources(db, ['oura', 'hae']);
    expect(change).toEqual({ purged: [], conversationsDeleted: 0 });
    expect([...db.seen.keys()].sort()).toEqual(['hae', 'oura']);
  });

  it('purges a source seen before but not active now, in the same call', async () => {
    const { db, hae } = await world();
    const change = await recordActiveSources(db, ['hae']);
    expect(change).toEqual({ purged: ['oura'], conversationsDeleted: 2 });
    expect(db.conversationIds()).toEqual([hae]);
  });

  it('leaves no row that mentions the purged source, in any table', async () => {
    const { db } = await world();
    await recordActiveSources(db, ['hae']);
    expect(mentions(db, 'oura')).toEqual([]);
    expect(mentions(db, 'hae')).not.toEqual([]);
  });

  it('never touches conversations tagged only with active sources', async () => {
    const { db, hae } = await world();
    await recordActiveSources(db, ['hae']);
    expect(db.sourceIdsOf(hae)).toEqual(['hae']);
    expect(db.messageCountOf(hae)).toBe(2);
  });

  it('forgets a purged source, so a second pass has nothing left to do', async () => {
    const { db } = await world();
    await recordActiveSources(db, ['hae']);
    expect(await recordActiveSources(db, ['hae'])).toEqual({ purged: [], conversationsDeleted: 0 });
  });

  it('does not invent a source it never saw', async () => {
    const db = new FakeAnalystDb();
    await recordActiveSources(db, ['hae']);
    await recordActiveSources(db, ['hae']);
    expect([...db.seen.keys()]).toEqual(['hae']);
  });

  it('a source that comes back is a fresh start: the purged conversations stay gone', async () => {
    const { db, ring } = await world();
    await recordActiveSources(db, ['hae']);
    await recordActiveSources(db, ['hae', 'oura']);
    const listed = await listConversationsForApi({ client: db });
    expect(listed.ok && listed.conversations).toHaveLength(1);
    expect((await readConversationForApi({ client: db }, ring)).status).toBe(404);
  });

  it('deletes lab-tagged conversations when lab leaves the active set', async () => {
    const db = new FakeAnalystDb();
    await recordActiveSources(db, ['hae', 'lab']);
    await tagged(db, 'Panels', ['lab']);
    expect((await recordActiveSources(db, ['hae'])).purged).toEqual(['lab']);
    expect(db.conversationCount()).toBe(0);
  });

  it('runs in one transaction: BEGIN first, COMMIT last', async () => {
    const { db } = await world();
    db.calls.length = 0;
    await recordActiveSources(db, ['hae']);
    const texts = db.calls.map(c => c.text.trim());
    expect(texts[0]).toMatch(/^BEGIN/);
    expect(texts[texts.length - 1]).toMatch(/^COMMIT/);
  });
});

describe('a 0.3.0 install: rows recorded as removed with a pending purge date', () => {
  it('purges them at once on the first reconcile, then forgets them', async () => {
    const { db, hae } = await world();
    // Removed yesterday under the old 7-day grace period: the purge was still six days off.
    db.seen.get('oura')!.removed_at = new Date(db.now.getTime() - 86_400_000);
    const change = await syncLifecycle(['hae'], {} as NodeJS.ProcessEnv, () => db);
    expect(change).toEqual({ purged: ['oura'], conversationsDeleted: 2 });
    expect(db.conversationIds()).toEqual([hae]);
    expect(mentions(db, 'oura')).toEqual([]);
  });

  it('a legacy removal on a source that is active again is cleared, not purged', async () => {
    const { db } = await world();
    db.seen.get('oura')!.removed_at = new Date(db.now.getTime() - 86_400_000);
    await syncLifecycle(['hae', 'oura'], {} as NodeJS.ProcessEnv, () => db);
    expect(db.seen.get('oura')!.removed_at).toBeNull();
    expect(db.conversationCount()).toBe(3);
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
