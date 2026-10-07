import { describe, expect, it } from 'vitest';
import { deleteConfirmMessage, readLabDeleteImpact } from '@/lib/lab/delete-impact';
import type { PoolLike } from '@/lib/db/pool';

function pool(row: Record<string, unknown>): PoolLike {
  return { query: async () => ({ rows: [row] }) };
}

describe('readLabDeleteImpact', () => {
  it('counts the conversations that would go only when deleting the last report', async () => {
    expect(await readLabDeleteImpact(pool({ reports: 1, conversations: 4 }))).toEqual({
      reports: 1,
      lastReport: true,
      conversations: 4,
    });
    expect(await readLabDeleteImpact(pool({ reports: 3, conversations: 4 }))).toEqual({
      reports: 3,
      lastReport: false,
      conversations: 0,
    });
  });

  it('with no report stored, nothing would be deleted', async () => {
    expect(await readLabDeleteImpact(pool({ reports: 0, conversations: 0 }))).toEqual({
      reports: 0,
      lastReport: false,
      conversations: 0,
    });
  });

  it('asks Postgres for counts only, never a value', async () => {
    const seen: string[] = [];
    await readLabDeleteImpact({ query: async text => (seen.push(text), { rows: [{ reports: 1, conversations: 0 }] }) });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatch(/count\(\*\)/);
    expect(seen[0]).not.toMatch(/lab_results|content|value/i);
  });
});

describe('deleteConfirmMessage', () => {
  const base = 'Delete report A?';
  it('is the plain confirmation when other reports remain', () => {
    const text = deleteConfirmMessage(base, { reports: 2, lastReport: false, conversations: 0 });
    expect(text).toContain('Its observations are removed with it');
    expect(text).not.toMatch(/conversation/);
  });

  it('names the number of conversations and suggests replacements when it is the last report', () => {
    const text = deleteConfirmMessage(base, { reports: 1, lastReport: true, conversations: 3 });
    expect(text).toContain('last lab report');
    expect(text).toContain('3 conversations');
    expect(text).toMatch(/upload replacement reports first/i);
    expect(text).toContain('cannot be undone');
  });

  it('says "1 conversation" in the singular', () => {
    expect(deleteConfirmMessage(base, { reports: 1, lastReport: true, conversations: 1 })).toContain('1 conversation ');
  });

  it('with no conversations at stake, still warns that it is the last report', () => {
    const text = deleteConfirmMessage(base, { reports: 1, lastReport: true, conversations: 0 });
    expect(text).toContain('last lab report');
    expect(text).not.toMatch(/\b0 conversation/);
  });

  it('when the count could not be read, warns without inventing a number', () => {
    const text = deleteConfirmMessage(base, null);
    expect(text).toMatch(/last lab report/i);
    expect(text).not.toMatch(/\d+ conversation/);
  });
});
