import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  deleteProvider,
  getProvider,
  insertProvider,
  isForeignKeyViolation,
  isUniqueViolation,
  listAssignments,
  listProviders,
  putAssignment,
  updateProvider,
} from './ai-store';
import { fakeAiTables } from './ai-store.fake';

const key = () => randomBytes(32);
const PROVIDER = { name: 'OpenRouter', kind: 'openai' as const, baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk-sample-provider-key-1234' };

describe('AI provider store', () => {
  it('round-trips a provider with its key encrypted', async () => {
    const db = fakeAiTables();
    const k = key();
    await insertProvider(db, 'owner', 'p1', PROVIDER, k);
    const [read] = await listProviders(db, 'owner', k);
    expect(read).toMatchObject({ id: 'p1', name: 'OpenRouter', kind: 'openai', apiKey: PROVIDER.apiKey, keyState: 'ok', revision: 1 });

    const row = db.providers.get('p1')!;
    expect(Buffer.from(row.ciphertext as Buffer).toString('utf8')).not.toContain('sk-sample');
    expect(JSON.stringify(db.sent.map(s => s.text))).not.toContain('sk-sample');
  });

  it('stores no key at all for a provider that needs none, and needs no secret key to do so', async () => {
    const db = fakeAiTables();
    await insertProvider(db, 'owner', 'p1', { ...PROVIDER, baseUrl: 'http://127.0.0.1:1234/v1', apiKey: null }, null);
    const [read] = await listProviders(db, 'owner', null);
    expect(read).toMatchObject({ apiKey: null, keyState: 'none' });
    expect(db.providers.get('p1')!.ciphertext).toBeNull();
  });

  it('refuses to store a key without a secret key', async () => {
    await expect(insertProvider(fakeAiTables(), 'owner', 'p1', PROVIDER, null)).rejects.toThrow(/VITAL_SECRET_KEY/);
  });

  it('reads a key written under another secret key, or a corrupt one, as needing re-entry; never throws', async () => {
    const db = fakeAiTables();
    const k = key();
    await insertProvider(db, 'owner', 'p1', PROVIDER, k);
    expect((await listProviders(db, 'owner', key()))[0]).toMatchObject({ apiKey: null, keyState: 'needs_reentry' });
    expect((await listProviders(db, 'owner', null))[0]).toMatchObject({ apiKey: null, keyState: 'needs_reentry' });
    db.providers.get('p1')!.auth_tag = Buffer.alloc(16);
    expect((await listProviders(db, 'owner', k))[0]).toMatchObject({ apiKey: null, keyState: 'needs_reentry' });
  });

  it('keeps each user to their own providers and choices', async () => {
    const db = fakeAiTables();
    const k = key();
    await insertProvider(db, 'owner', 'p1', PROVIDER, k);
    await insertProvider(db, 'sam', 'p2', { ...PROVIDER, apiKey: 'sk-sam-only-key-5678' }, k);
    await putAssignment(db, 'owner', 'analyst', { providerId: 'p1', model: 'a', options: {} });

    expect((await listProviders(db, 'owner', k)).map(p => p.id)).toEqual(['p1']);
    expect((await listProviders(db, 'sam', k)).map(p => p.id)).toEqual(['p2']);
    expect(await listAssignments(db, 'sam')).toEqual([]);
    // Another user's provider id reads as absent, and cannot be changed or removed.
    expect(await getProvider(db, 'sam', 'p1', k)).toBeNull();
    expect(await updateProvider(db, 'sam', 'p1', PROVIDER, k)).toBe(false);
    expect(await deleteProvider(db, 'sam', 'p1')).toBe(false);
    expect(db.providers.has('p1')).toBe(true);
  });

  it('refuses a choice that names another user’s provider', async () => {
    const db = fakeAiTables();
    await insertProvider(db, 'owner', 'p1', PROVIDER, key());
    const attempt = putAssignment(db, 'sam', 'analyst', { providerId: 'p1', model: 'a', options: {} });
    await expect(attempt).rejects.toSatisfy(isForeignKeyViolation);
  });

  it('refuses a second provider with the same name for one user, but not across users', async () => {
    const db = fakeAiTables();
    const k = key();
    await insertProvider(db, 'owner', 'p1', PROVIDER, k);
    await expect(insertProvider(db, 'owner', 'p2', PROVIDER, k)).rejects.toSatisfy(isUniqueViolation);
    await expect(insertProvider(db, 'sam', 'p3', PROVIDER, k)).resolves.toBeUndefined();
  });

  it('removes a provider’s choices with it', async () => {
    const db = fakeAiTables();
    await insertProvider(db, 'owner', 'p1', PROVIDER, key());
    await putAssignment(db, 'owner', 'summary', { providerId: 'p1', model: 'a', options: {} });
    expect(await deleteProvider(db, 'owner', 'p1')).toBe(true);
    expect(await listAssignments(db, 'owner')).toEqual([]);
  });

  it('reads stored options through the same validation as a save', async () => {
    const db = fakeAiTables();
    await insertProvider(db, 'owner', 'p1', PROVIDER, key());
    await putAssignment(db, 'owner', 'analyst', { providerId: 'p1', model: 'm', options: { maxTokens: 2000 } });
    db.assignments.get('owner|analyst')!.options = { maxTokens: 2000, temperature: 99, unknown: 'x' };
    const [read] = await listAssignments(db, 'owner');
    expect(read.options).toEqual({ maxTokens: 2000 });
    await putAssignment(db, 'owner', 'analyst', { providerId: 'p1', model: 'm2', options: {} });
    expect((await listAssignments(db, 'owner'))[0]).toMatchObject({ model: 'm2', revision: 2 });
  });
});

describe('db/migrations/0017', () => {
  const sql = readFileSync(join(process.cwd(), 'db', 'migrations', '0017-ai-providers.sql'), 'utf8');

  it('keys both tables by user and ties a choice to the same user’s provider', () => {
    expect(sql).toMatch(/UNIQUE \(user_id, name\)/);
    expect(sql).toMatch(/PRIMARY KEY \(user_id, use\)/);
    expect(sql).toMatch(/FOREIGN KEY \(provider_id, user_id\) REFERENCES ai_providers \(id, user_id\) ON DELETE CASCADE/);
  });

  it('stores the key only as ciphertext', () => {
    expect(sql).not.toMatch(/api_key\s+text/i);
    expect(sql).toMatch(/ciphertext\s+bytea/);
  });
});
