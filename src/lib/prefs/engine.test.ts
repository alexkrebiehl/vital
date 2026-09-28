// Tabs of one browser move together: a save the server accepted reaches the
// other tabs, which adopt it only when it is newer than what they show.

import { describe, expect, it } from 'vitest';
import { createPrefsEngine, type PrefsEngineDeps, type PrefsStorage } from './engine';
import { PREFS_SCHEMA_VERSION, defaultPreferences, type PreferencesRecord, type VitalPreferences } from './types';

/** One server record, revision-checked like /api/preferences. */
function fakeServer() {
  let record: PreferencesRecord = {
    ...defaultPreferences(),
    schemaVersion: PREFS_SCHEMA_VERSION,
    revision: 1,
    updatedAt: '2026-09-28T00:00:00.000Z',
  };
  let failWrites = false;
  const fetchImpl: PrefsEngineDeps['fetchImpl'] = async (_input, init) => {
    if (init?.method === 'PUT') {
      if (failWrites) return new Response(JSON.stringify({ error: 'down' }), { status: 503 });
      const { revision, ...prefs } = JSON.parse(String(init.body)) as VitalPreferences & { revision: number };
      if (revision !== record.revision) return new Response(JSON.stringify({ error: 'stale', preferences: record }), { status: 409 });
      record = { ...record, ...prefs, revision: record.revision + 1 };
    }
    return new Response(JSON.stringify(record), { status: 200 });
  };
  return { fetchImpl, get record() { return record; }, failWrites: (v: boolean) => { failWrites = v; } };
}

/** A BroadcastChannel stand-in: a post reaches every OTHER member. */
function fakeBus() {
  const members: { id: number; cb: (payload: unknown) => void }[] = [];
  let next = 0;
  const posted: unknown[] = [];
  return {
    posted,
    join(): NonNullable<PrefsEngineDeps['tabs']> {
      const id = next++;
      return {
        post: record => {
          posted.push(record);
          for (const m of members) if (m.id !== id) m.cb(structuredClone(record));
        },
        listen: cb => members.push({ id, cb }),
      };
    },
  };
}

function memoryStorage(): PrefsStorage {
  const m = new Map<string, string>();
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: k => void m.delete(k) };
}

function tab(server: ReturnType<typeof fakeServer>, bus: ReturnType<typeof fakeBus>) {
  const storage = memoryStorage();
  return createPrefsEngine({ getStorage: () => storage, fetchImpl: server.fetchImpl, now: () => 0, tabs: bus.join() });
}

describe('preferences across tabs', () => {
  it('a saved theme reaches the other tab at once', async () => {
    const server = fakeServer();
    const bus = fakeBus();
    const a = tab(server, bus);
    const b = tab(server, bus);
    a.start();
    b.start();
    await a.sync();
    await b.sync();

    const seen: string[] = [];
    b.subscribe(() => seen.push(b.getState().preferences.darkTheme));
    const outcome = await a.save({ ...a.loadPreferences(), theme: 'dark', darkTheme: 'nord' });

    expect(outcome.ok).toBe(true);
    expect(b.getState().preferences).toMatchObject({ theme: 'dark', darkTheme: 'nord' });
    expect(b.getState().revision).toBe(server.record.revision);
    expect(seen).toContain('nord');
  });

  it('the other tab can save next without a conflict', async () => {
    const server = fakeServer();
    const bus = fakeBus();
    const a = tab(server, bus);
    const b = tab(server, bus);
    a.start();
    b.start();
    await a.sync();
    await b.sync();

    await a.save({ ...a.loadPreferences(), darkTheme: 'dracula' });
    const outcome = await b.save({ ...b.loadPreferences(), lightTheme: 'github' });

    expect(outcome.ok).toBe(true);
    expect(a.getState().preferences).toMatchObject({ darkTheme: 'dracula', lightTheme: 'github' });
  });

  it('ignores a record that is not newer than the one shown', async () => {
    const server = fakeServer();
    const bus = fakeBus();
    const a = tab(server, bus);
    const sender = bus.join();
    a.start();
    await a.save({ ...a.loadPreferences(), darkTheme: 'monokai' });
    const shown = a.getState();

    sender.post({ ...server.record, darkTheme: 'nord', revision: shown.revision });
    sender.post({ ...server.record, darkTheme: 'nord', revision: shown.revision - 1 });

    expect(a.getState().preferences.darkTheme).toBe('monokai');
  });

  it('ignores a malformed message', async () => {
    const server = fakeServer();
    const bus = fakeBus();
    const a = tab(server, bus);
    const sender = bus.join();
    a.start();
    await a.sync();

    sender.post({ hello: 'world' } as unknown as PreferencesRecord);
    sender.post({ ...server.record, revision: 99, theme: 'sepia' } as unknown as PreferencesRecord);

    expect(a.getState().revision).toBe(1);
  });

  it('a save the server refused is not posted', async () => {
    const server = fakeServer();
    const bus = fakeBus();
    const a = tab(server, bus);
    a.start();
    await a.sync();
    server.failWrites(true);

    const outcome = await a.save({ ...a.loadPreferences(), darkTheme: 'nord' });

    expect(outcome.ok).toBe(false);
    expect(bus.posted).toEqual([]);
  });
});
