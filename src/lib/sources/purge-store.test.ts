import { describe, expect, it } from 'vitest';
import { FakeAnalystDb } from '@/lib/analyst/test-doubles';
import { insertConversation, insertMessage, listConversations } from '@/lib/db/analyst-store';
import { recordActiveSources, syncLifecycle } from '@/lib/sources/lifecycle';
import { listRemovedSources, purgeDueSources, purgeGraceDays, purgeSources } from '@/lib/sources/purge-store';

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
  db.credentials.add('oura');
  await recordActiveSources(db, ['hae', 'oura']);
  const hae = await tagged(db, 'Watch only', ['hae']);
  const ring = await tagged(db, 'Ring only', ['oura']);
  const mixed = await tagged(db, 'Both', ['hae', 'oura']);
  return { db, hae, ring, mixed };
}

function env(days?: string): NodeJS.ProcessEnv {
  return (days === undefined ? {} : { VITAL_SOURCE_PURGE_GRACE_DAYS: days }) as unknown as NodeJS.ProcessEnv;
}

/** Everything the fake holds that mentions the source, in any table. */
function mentions(db: FakeAnalystDb, sourceId: string): string[] {
  const found: string[] = [];
  for (const id of db.conversationIds()) if (db.sourceIdsOf(id).includes(sourceId)) found.push(`conversation ${id}`);
  for (const m of db.allMessages()) if ((m.source_ids as string[]).includes(sourceId)) found.push(`message ${m.id}`);
  if (db.credentials.has(sourceId)) found.push('credentials');
  if (db.seen.has(sourceId)) found.push('data_sources_seen');
  return found;
}

describe('purgeGraceDays', () => {
  it('defaults to 7', () => {
    expect(purgeGraceDays(env())).toBe(7);
    expect(purgeGraceDays(env(''))).toBe(7);
  });
  it('reads a whole number of days, 0 included', () => {
    expect(purgeGraceDays(env('0'))).toBe(0);
    expect(purgeGraceDays(env('30'))).toBe(30);
  });
  it('falls back to the default for anything else: a typo must never shorten the grace period', () => {
    for (const bad of ['-1', '1.5', 'soon', '7d', '1e3', '999999']) {
      expect(purgeGraceDays(env(bad)), bad).toBe(7);
    }
  });
});

describe('purgeSources', () => {
  it('leaves no row that mentions the source, in any table', async () => {
    const { db } = await world();
    await recordActiveSources(db, ['hae']);
    expect(mentions(db, 'oura').length).toBeGreaterThan(0);

    const outcome = await purgeSources(db, ['oura']);
    expect(outcome).toEqual({ purged: ['oura'], conversationsDeleted: 2 });
    expect(mentions(db, 'oura')).toEqual([]);
  });

  it('never touches conversations tagged only with active sources', async () => {
    const { db, hae } = await world();
    await recordActiveSources(db, ['hae']);
    await purgeSources(db, ['oura']);
    expect(db.conversationIds()).toEqual([hae]);
    expect(db.messageCountOf(hae)).toBe(2);
    expect(db.seen.has('hae')).toBe(true);
    expect((await listConversations(db)).map(c => c.id)).toEqual([hae]);
  });

  it('refuses a source that is still active, and one that was never seen', async () => {
    const { db } = await world();
    expect(await purgeSources(db, ['oura'])).toEqual({ purged: [], conversationsDeleted: 0 });
    expect(await purgeSources(db, ['hevy'])).toEqual({ purged: [], conversationsDeleted: 0 });
    expect(db.conversationIds()).toHaveLength(3);
    expect(db.credentials.has('oura')).toBe(true);
  });

  it('runs in one transaction', async () => {
    const { db } = await world();
    await recordActiveSources(db, ['hae']);
    db.calls.length = 0;
    await purgeSources(db, ['oura']);
    const texts = db.calls.map(c => c.text.replace(/\s+/g, ' ').trim());
    expect(texts[0]).toBe('BEGIN');
    expect(texts.at(-1)).toBe('COMMIT');
    expect(texts.filter(t => /^DELETE/.test(t))).toHaveLength(3);
  });

  it('does nothing for an empty list', async () => {
    const { db } = await world();
    expect(await purgeSources(db, [])).toEqual({ purged: [], conversationsDeleted: 0 });
  });
});

describe('listRemovedSources', () => {
  it('lists each removed source with its date and the conversations it hides', async () => {
    const { db } = await world();
    db.advanceDays(1);
    await recordActiveSources(db, ['hae']);
    expect(await listRemovedSources(db)).toEqual([
      { sourceId: 'oura', removedAt: db.now.toISOString(), hiddenConversations: 2 },
    ]);
  });

  it('is empty while every source is active', async () => {
    const { db } = await world();
    expect(await listRemovedSources(db)).toEqual([]);
  });
});

describe('the grace period', () => {
  it('does not purge before it has elapsed, and purges once it has', async () => {
    const { db } = await world();
    await recordActiveSources(db, ['hae']);
    db.advanceDays(6);
    expect(await purgeDueSources(db, 7)).toEqual({ purged: [], conversationsDeleted: 0 });
    expect(mentions(db, 'oura').length).toBeGreaterThan(0);
    db.advanceDays(1);
    expect((await purgeDueSources(db, 7)).purged).toEqual(['oura']);
    expect(mentions(db, 'oura')).toEqual([]);
  });

  it('with grace 0 purges at once, in the same pass that notices the removal', async () => {
    const { db } = await world();
    const e = env('0');
    await syncLifecycle(['hae'], e, () => db);
    expect(mentions(db, 'oura')).toEqual([]);
    expect(db.conversationIds()).toHaveLength(1);
  });

  it('with the default grace the same pass only hides', async () => {
    const { db } = await world();
    await syncLifecycle(['hae'], env(), () => db);
    expect(db.seen.get('oura')!.removed_at).not.toBeNull();
    expect(db.conversationIds()).toHaveLength(3);
    db.advanceDays(7);
    await syncLifecycle(['hae'], env(), () => db);
    expect(mentions(db, 'oura')).toEqual([]);
  });

  it('a source that comes back before the purge keeps everything', async () => {
    const { db } = await world();
    await syncLifecycle(['hae'], env(), () => db);
    db.advanceDays(5);
    await syncLifecycle(['hae', 'oura'], env(), () => db);
    db.advanceDays(10);
    await syncLifecycle(['hae', 'oura'], env(), () => db);
    expect(db.conversationIds()).toHaveLength(3);
  });
});
