import { describe, expect, it } from 'vitest';
import { FakeAnalystDb } from '@/lib/analyst/test-doubles';
import { insertConversation, insertMessage } from '@/lib/db/analyst-store';
import { recordActiveSources } from '@/lib/sources/lifecycle';
import { purgeSourceResponse, removedSourcesResponse } from '@/lib/sources/removed';
import type { SourceContext } from '@/lib/sources/registry';

function ctx(opts: { hae?: boolean; oura?: boolean } = {}): SourceContext {
  return {
    env: {
      VITAL_SECRET_KEY: Buffer.alloc(32, 1).toString('base64'),
    } as unknown as NodeJS.ProcessEnv,
    hasCredential: async id => (Boolean(opts.oura) && (id === 'oura' || id === 'oura-app')) || (Boolean(opts.hae) && id === 'hae'),
    labReportCount: async () => 0,
  };
}

const NO_ENV = {} as unknown as NodeJS.ProcessEnv;

async function tagged(db: FakeAnalystDb, sourceIds: string[]): Promise<number> {
  const c = await insertConversation(db, 'Sample conversation');
  await insertMessage(
    db,
    c.id,
    { role: 'assistant', content: 'an answer', status: 'ok', provider: 'p', model: 'm', attribution: 'a', sourceIds },
    200
  );
  return c.id;
}

const del = (confirm?: string) =>
  new Request(`http://localhost/api/sources/oura/data${confirm ? `?confirm=${confirm}` : ''}`, { method: 'DELETE' });

async function removedWorld() {
  const db = new FakeAnalystDb();
  db.credentials.add('oura');
  await recordActiveSources(db, ['hae', 'oura']);
  await tagged(db, ['hae']);
  await tagged(db, ['oura']);
  await recordActiveSources(db, ['hae']);
  return db;
}

describe('GET /api/sources/removed', () => {
  it('lists the removed source with its name, dates and hidden count', async () => {
    const db = await removedWorld();
    const res = await removedSourcesResponse({ client: db, env: NO_ENV });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
    const body = await res.json();
    expect(body.graceDays).toBe(7);
    expect(body.sources).toEqual([
      {
        id: 'oura',
        name: 'Oura Ring',
        removedAt: db.now.toISOString(),
        purgeOn: new Date(db.now.getTime() + 7 * 86_400_000).toISOString(),
        hiddenConversations: 1,
      },
    ]);
  });

  it('is empty without a database', async () => {
    const res = await removedSourcesResponse({ client: null, env: NO_ENV });
    expect(await res.json()).toEqual({ graceDays: 7, sources: [] });
  });

  it('reports a read failure without its detail', async () => {
    const db = new FakeAnalystDb();
    db.failNext = new Error('password=hunter2 at 10.0.0.5');
    const res = await removedSourcesResponse({ client: db, env: NO_ENV });
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('hunter2');
  });
});

describe('DELETE /api/sources/{id}/data', () => {
  it('needs a confirmation', async () => {
    const db = await removedWorld();
    const res = await purgeSourceResponse(del(), 'oura', { client: db, ctx: ctx({ hae: true }) });
    expect(res.status).toBe(400);
    expect(db.conversationIds()).toHaveLength(2);
    const wrong = await purgeSourceResponse(del('1'), 'oura', { client: db, ctx: ctx({ hae: true }) });
    expect(wrong.status).toBe(400);
  });

  it('is refused while the source is still active', async () => {
    const db = new FakeAnalystDb();
    await recordActiveSources(db, ['hae', 'oura']);
    await tagged(db, ['oura']);
    const res = await purgeSourceResponse(del('yes'), 'oura', { client: db, ctx: ctx({ hae: true, oura: true }) });
    expect(res.status).toBe(409);
    expect(db.conversationIds()).toHaveLength(1);
  });

  it('purges a removed source now, whatever the grace period', async () => {
    const db = await removedWorld();
    const res = await purgeSourceResponse(del('yes'), 'oura', { client: db, ctx: ctx({ hae: true }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ purged: ['oura'], conversationsDeleted: 1 });
    expect(db.credentials.has('oura')).toBe(false);
    expect(db.seen.has('oura')).toBe(false);
    expect(db.conversationIds()).toHaveLength(1);
  });

  it('notices a removal that was not recorded yet, then purges it', async () => {
    const db = new FakeAnalystDb();
    await recordActiveSources(db, ['hae', 'oura']);
    await tagged(db, ['oura']);
    // Oura is gone from the registry, but no reconcile has run since.
    const res = await purgeSourceResponse(del('yes'), 'oura', { client: db, ctx: ctx({ hae: true }) });
    expect(res.status).toBe(200);
    expect(db.conversationIds()).toEqual([]);
  });

  it('is a 404 for an unknown source and for one with nothing stored', async () => {
    const db = await removedWorld();
    expect((await purgeSourceResponse(del('yes'), 'nope', { client: db, ctx: ctx() })).status).toBe(404);
    expect((await purgeSourceResponse(del('yes'), 'hevy', { client: db, ctx: ctx({ hae: true }) })).status).toBe(404);
  });

  it('needs a database', async () => {
    const res = await purgeSourceResponse(del('yes'), 'oura', { client: null, ctx: ctx() });
    expect(res.status).toBe(503);
  });

  it('does not forward an error detail', async () => {
    const db = await removedWorld();
    db.failNext = new Error('password=hunter2');
    const res = await purgeSourceResponse(del('yes'), 'oura', { client: db, ctx: ctx({ hae: true }) });
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('hunter2');
  });
});
