// ── get_app_data: labs.documents ────────────────────────────────────────────
//
// Dates, lab names and result counts of the stored lab documents, and nothing that
// identifies the file or the person.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetToDemoDataset } from '../../adapters/dataset';
import { assertNoPii } from '../../db/lab-store';
import { appCtx, healthyReaders, installBodyDataset, labReport, REPORTS, REPORT_FILENAME, REPORT_HASH } from './app.fake';
import type { Envelope } from './envelope';
import { capabilityById } from './registry';
import { expectClean } from './test-context.fake';
import type { CapabilityContext } from './types';

beforeEach(() => void installBodyDataset());
afterEach(() => resetToDemoDataset());

const read = (id: string, args: Record<string, unknown> = {}, ctx: CapabilityContext = appCtx()): Promise<Envelope<unknown>> => {
  const cap = capabilityById(id);
  if (!cap) throw new Error(`no capability ${id}`);
  return cap.read(args, ctx);
};
const data = (env: Envelope<unknown>) => env.data as Record<string, any>;

describe('labs.documents', () => {
  it('lists each document by date, lab and result count, newest first', async () => {
    const env = await read('labs.documents');
    expectClean(env);
    const docs = data(env).documents as Record<string, any>[];
    expect(docs.map(d => d.reportDate)).toEqual(['2026-09-29', '2026-03-12']);
    expect(docs[0]).toMatchObject({ lab: 'Northside Clinical Lab', collected: '2026-09-28', results: 31, display: { results: '31 results' } });
    expect(docs[1]).toMatchObject({ collected: '2026-03-10 to 2026-03-11', display: { results: '1 result' } });
    expect(env.coverage).toMatchObject({ kind: 'known', first: '2026-03-12', last: '2026-09-29', count: 2 });
  });

  it('carries no file name, hash, id, note or extraction metadata', async () => {
    const text = JSON.stringify(await read('labs.documents'));
    for (const secret of [REPORT_FILENAME, REPORT_HASH, 'private note', 'parserVersion', REPORTS[0].id, 'sourceBytes']) expect(text).not.toContain(secret);
  });

  it('passes the lab store\'s PII checks, and drops a lab name that looks like a person', async () => {
    const env = await read('labs.documents');
    const names = (data(env).documents as { lab?: string }[]).flatMap(d => (d.lab ? [d.lab] : []));
    expect(names.length).toBeGreaterThan(0);
    expect(() => assertNoPii(names.map(panel => ({ panel })))).not.toThrow();

    const person = await read('labs.documents', {}, appCtx(healthyReaders({ labReports: async () => [labReport({ labName: 'SMITH, JOHN Q' })] })));
    expect(JSON.stringify(person)).not.toMatch(/SMITH/);
    expect(data(person).documents[0].lab).toBeUndefined();
  });

  it('says none are stored when the store is empty', async () => {
    const env = await read('labs.documents', {}, appCtx(healthyReaders({ labReports: async () => [] })));
    expect(env.status).toBe('no_data_in_window');
    expect(env.next).toMatch(/none at all/);
  });

  it('is source_unavailable, with unavailable coverage, when no store is configured', async () => {
    const ctx = appCtx(healthyReaders({ labReports: async () => null, databaseConfigured: () => false }));
    const env = await read('labs.documents', {}, ctx);
    expect(env.status).toBe('source_unavailable');
    expect(env.next).toMatch(/says nothing about whether records exist/);
    expect(await capabilityById('labs.documents')!.coverage(ctx)).toMatchObject({ kind: 'unavailable' });
  });

  it('reports a store that throws as unavailable, with no address in the reason', async () => {
    const ctx = appCtx(healthyReaders({ labReports: async () => { throw new Error('connect ECONNREFUSED https://db.internal.example.com:5432/vital'); } }));
    const env = await read('labs.documents', {}, ctx);
    expect(env.status).toBe('source_unavailable');
    expect(JSON.stringify(env)).not.toMatch(/example\.com|https?:/);
    expect(await capabilityById('labs.documents')!.coverage(ctx)).toMatchObject({ kind: 'unavailable' });
  });
});

