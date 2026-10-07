// SAFETY (critical): a source's data is erased only when the source is genuinely
// and explicitly gone. Every transient failure must leave EVERYTHING in place.
//
// The registry, the lifecycle and the purgers run for real here. Only the
// Postgres pool is replaced, by an in-memory store that can be made to fail.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeAnalystDb } from '@/lib/analyst/test-doubles';
import { insertConversation, insertMessage } from '@/lib/db/analyst-store';

class StoreDb extends FakeAnalystDb {
  rows = new Set<string>();
  labReports = 0;
  /** Return an error for a statement to make it fail; null lets it through. */
  fault: ((text: string) => Error | null) | null = null;

  override async query(text: string, params: unknown[] = []) {
    const error = this.fault?.(text) ?? null;
    if (error) throw error;
    if (/FROM source_credentials WHERE source_id/.test(text)) {
      return { rows: this.rows.has(String(params[0])) ? [{ present: 1 }] : [] };
    }
    if (/FROM lab_reports/.test(text)) return { rows: [{ n: this.labReports }] };
    return super.query(text, params);
  }
}

const holder: { db: StoreDb | null } = { db: null };
vi.mock('@/lib/db/pool', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/db/pool')>()),
  getPool: () => holder.db,
}));

import { markRemoved } from '@/lib/sources/lifecycle';
import { clearPurgersForTests, reconcileActiveSources, reconcileQuietly, registerPurger, resetPurgeStateForTests } from '@/lib/sources/purge';
import { defaultContext } from '@/lib/sources/registry';

async function tagged(db: StoreDb, title: string, sourceIds: string[]): Promise<void> {
  const c = await insertConversation(db, title);
  await insertMessage(db, c.id, { role: 'user', content: 'q' }, 200);
  await insertMessage(db, c.id, { role: 'assistant', content: 'a', status: 'ok', provider: 'p', model: 'm', attribution: 'x', sourceIds }, 200);
}

const KEY = Buffer.alloc(32, 7).toString('base64');
const envWith = (extra: Record<string, string> = {}) => ({ ...extra }) as unknown as NodeJS.ProcessEnv;

/** A store with every source connected, one conversation each, and a first reconcile done. */
async function connected(env: NodeJS.ProcessEnv) {
  const db = new StoreDb();
  holder.db = db;
  for (const id of ['hae', 'oura', 'oura-app', 'hevy']) db.rows.add(id);
  db.labReports = 2;
  for (const id of ['hae', 'oura', 'hevy', 'lab']) await tagged(db, `about ${id}`, [id]);
  const purger = vi.fn();
  registerPurger('t', purger);
  await reconcileActiveSources(defaultContext(env));
  return { db, purger };
}

describe('nothing is purged on a transient failure', () => {
  beforeEach(() => {
    clearPurgersForTests();
    resetPurgeStateForTests();
  });
  afterEach(() => {
    holder.db = null;
    vi.unstubAllGlobals();
  });

  it('is the baseline: four sources, four conversations, nothing purged', async () => {
    const { db, purger } = await connected(envWith({ VITAL_SECRET_KEY: KEY }));
    expect(db.conversationCount()).toBe(4);
    expect(purger).not.toHaveBeenCalled();
  });

  it('the credential read throws', async () => {
    const env = envWith({ VITAL_SECRET_KEY: KEY });
    const { db, purger } = await connected(env);
    db.fault = text => (/source_credentials/.test(text) ? new Error('read failed') : null);
    await expect(reconcileActiveSources(defaultContext(env))).rejects.toThrow();
    expect(await reconcileQuietly(defaultContext(env))).toBeNull();
    expect(db.conversationCount()).toBe(4);
    expect(db.seen.size).toBe(4);
    expect(purger).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', envWith()],
    ['wrong', envWith({ VITAL_SECRET_KEY: Buffer.alloc(32, 9).toString('base64') })],
    ['malformed', envWith({ VITAL_SECRET_KEY: 'not-a-key' })],
  ])('the secret key is %s, so every stored key is unreadable ("needs re-entry")', async (_label, env) => {
    const { db, purger } = await connected(envWith({ VITAL_SECRET_KEY: KEY }));
    const result = await reconcileActiveSources(defaultContext(env));
    expect(result.active).toEqual(['hae', 'hevy', 'lab', 'oura']);
    expect(result.removed).toEqual([]);
    expect(db.conversationCount()).toBe(4);
    expect(purger).not.toHaveBeenCalled();
  });

  it('the database is unreachable', async () => {
    const env = envWith({ VITAL_SECRET_KEY: KEY });
    const { db, purger } = await connected(env);
    db.fault = () => new Error('ECONNREFUSED');
    expect(await reconcileQuietly(defaultContext(env))).toBeNull();
    db.fault = null;
    expect(db.conversationCount()).toBe(4);
    expect(purger).not.toHaveBeenCalled();
  });

  it('the lab count fails while the credentials read fine', async () => {
    const env = envWith({ VITAL_SECRET_KEY: KEY });
    const { db, purger } = await connected(env);
    db.fault = text => (/lab_reports/.test(text) ? new Error('timeout') : null);
    expect(await reconcileQuietly(defaultContext(env))).toBeNull();
    expect(db.conversationCount()).toBe(4);
    expect(purger).not.toHaveBeenCalled();
  });

  it('the lifecycle write fails: nothing is erased, and the pass is retried', async () => {
    const env = envWith({ VITAL_SECRET_KEY: KEY });
    const { db } = await connected(env);
    db.rows.delete('hevy'); // genuinely gone ...
    await markRemoved(['hevy'], db); // ... removed on purpose ...
    db.fault = text => (/FOR UPDATE/.test(text) ? new Error('deadlock') : null); // ... but the store fails
    await reconcileActiveSources(defaultContext(env));
    expect(db.conversationCount()).toBe(4);
    db.fault = null;
    await reconcileActiveSources(defaultContext(env)); // pending record retried
    expect(db.conversationCount()).toBe(3);
  });

  it('a source server that is unreachable or answers an error is never consulted, so never a removal', async () => {
    const env = envWith({ VITAL_SECRET_KEY: KEY, HAE_API_URL: 'http://127.0.0.1:1', HEVY_API_URL: 'http://127.0.0.1:1' });
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    vi.stubGlobal('fetch', fetchMock);
    const { db, purger } = await connected(env);
    fetchMock.mockResolvedValue(new Response('boom', { status: 500 }));
    const result = await reconcileActiveSources(defaultContext(env));
    expect(result.removed).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.conversationCount()).toBe(4);
    expect(purger).not.toHaveBeenCalled();
  });

  it('the app restarts with the same sources', async () => {
    const env = envWith({ VITAL_SECRET_KEY: KEY });
    const { db, purger } = await connected(env);
    resetPurgeStateForTests(); // a fresh process: nothing remembered in memory
    const result = await reconcileActiveSources(defaultContext(env));
    expect(result.removed).toEqual([]);
    expect(db.conversationCount()).toBe(4);
    expect(db.seen.size).toBe(4);
    expect(purger).not.toHaveBeenCalled();
  });

  it('no database is configured: nothing is stored, nothing is erased', async () => {
    const env = envWith({ VITAL_SECRET_KEY: KEY });
    const { db } = await connected(env);
    holder.db = null;
    const result = await reconcileActiveSources(defaultContext(env));
    expect(result.active).toEqual([]);
    expect(db.conversationCount()).toBe(4);
  });
});

describe('what does erase', () => {
  beforeEach(() => {
    clearPurgersForTests();
    resetPurgeStateForTests();
  });
  afterEach(() => {
    holder.db = null;
  });

  it('a credential row deleted AND the removal marked, with a healthy store, erases that source at once', async () => {
    const env = envWith({ VITAL_SECRET_KEY: KEY });
    const { db, purger } = await connected(env);
    db.rows.delete('hevy');
    await markRemoved(['hevy'], db);
    const result = await reconcileActiveSources(defaultContext(env));
    expect(result.removed).toEqual(['hevy']);
    expect(purger).toHaveBeenCalledWith(['hevy']);
    expect(db.conversationCount()).toBe(3);
    expect(db.seen.has('hevy')).toBe(false);
  });

  it('a credential row that is simply missing (no marker) drops memory but keeps the conversations', async () => {
    const env = envWith({ VITAL_SECRET_KEY: KEY });
    const { db, purger } = await connected(env);
    db.rows.delete('hevy');
    const result = await reconcileActiveSources(defaultContext(env));
    expect(result.removed).toEqual(['hevy']);
    expect(purger).toHaveBeenCalledWith(['hevy']); // in-memory purgers still run
    expect(db.conversationCount()).toBe(4);
    expect(db.seen.has('hevy')).toBe(true);
  });

  it('upgrade from 0.3.0: seen sources, no credential rows yet, nothing marked: nothing is erased', async () => {
    const env = envWith({ VITAL_SECRET_KEY: KEY });
    const { db } = await connected(env);
    db.rows.clear();
    db.labReports = 0;
    resetPurgeStateForTests(); // the first pass after the upgrade
    await reconcileActiveSources(defaultContext(env));
    expect(db.conversationCount()).toBe(4);
    expect([...db.seen.keys()].sort()).toEqual(['hae', 'hevy', 'lab', 'oura']);
  });

  it('a removal marked for a source this process never saw active still erases at once', async () => {
    const env = envWith({ VITAL_SECRET_KEY: KEY });
    const { db } = await connected(env);
    db.rows.delete('oura');
    await reconcileActiveSources(defaultContext(env)); // observed inactive, unmarked: kept
    expect(db.conversationCount()).toBe(4);
    await markRemoved(['oura'], db); // the person now disconnects it for real
    await reconcileActiveSources(defaultContext(env)); // active set unchanged, yet the pass runs
    expect(db.conversationCount()).toBe(3);
  });

  it('the last lab report deleted and marked erases lab conversations at once', async () => {
    const env = envWith({ VITAL_SECRET_KEY: KEY });
    const { db } = await connected(env);
    db.labReports = 0;
    await markRemoved(['lab'], db);
    await reconcileActiveSources(defaultContext(env));
    expect(db.conversationCount()).toBe(3);
    expect(db.conversationIds().map(id => db.sourceIdsOf(id)).flat().sort()).toEqual(['hae', 'hevy', 'oura']);
  });

  it('removed on purpose while the app was down: the first reconcile after restart erases it', async () => {
    const env = envWith({ VITAL_SECRET_KEY: KEY });
    const { db } = await connected(env);
    db.rows.delete('oura');
    await markRemoved(['oura'], db);
    resetPurgeStateForTests();
    await reconcileActiveSources(defaultContext(env));
    expect(db.conversationCount()).toBe(3);
  });

  it('a credential re-entered after a removal is not purged by a late reconcile', async () => {
    const env = envWith({ VITAL_SECRET_KEY: KEY });
    const { db } = await connected(env);
    db.rows.delete('hae');
    await markRemoved(['hae'], db);
    db.rows.add('hae'); // re-entered before the reconcile ran
    await reconcileActiveSources(defaultContext(env));
    expect(db.conversationCount()).toBe(4);
    expect(db.seen.get('hae')!.removed_at).toBeNull();
  });
});
