import { describe, expect, it } from 'vitest';
import { pgReadSilenced, pgRestore, pgSilence } from './quality-silenced-store';
import type { PoolLike } from './pool';

/** An in-memory stand-in for the quality_silenced table, matching the store's statements. */
class FakeSilenced implements PoolLike {
  rows: { check_id: string; metric_id: string; silenced_at: string }[] = [];
  statements: string[] = [];
  private clock = Date.parse('2026-10-06T12:00:00Z');

  async query(text: string, params: unknown[] = []): Promise<{ rows: Record<string, unknown>[] }> {
    const sql = text.replace(/\s+/g, ' ').trim();
    this.statements.push(sql);
    if (sql.startsWith('SELECT check_id, metric_id FROM quality_silenced')) {
      return { rows: [...this.rows].sort((a, b) => a.silenced_at.localeCompare(b.silenced_at)).map(({ check_id, metric_id }) => ({ check_id, metric_id })) };
    }
    if (sql.startsWith('INSERT INTO quality_silenced') && sql.includes('ON CONFLICT (check_id, metric_id) DO NOTHING')) {
      if (!this.rows.some(r => r.check_id === params[0] && r.metric_id === params[1])) {
        this.clock += 1000;
        this.rows.push({ check_id: String(params[0]), metric_id: String(params[1]), silenced_at: new Date(this.clock).toISOString() });
      }
      return { rows: [] };
    }
    if (sql.startsWith('DELETE FROM quality_silenced WHERE check_id = $1 AND metric_id = $2')) {
      this.rows = this.rows.filter(r => !(r.check_id === params[0] && r.metric_id === params[1]));
      return { rows: [] };
    }
    throw new Error(`Unexpected statement: ${sql}`);
  }
}

describe('quality silenced store', () => {
  it('reads nothing before anything is silenced', async () => {
    expect(await pgReadSilenced(new FakeSilenced())).toEqual([]);
  });

  it('silences and reads back, oldest first', async () => {
    const db = new FakeSilenced();
    await pgSilence(db, { checkId: 'late-start', metricId: 'dietary_energy' });
    await pgSilence(db, { checkId: 'stale', metricId: '' });
    expect(await pgReadSilenced(db)).toEqual([
      { checkId: 'late-start', metricId: 'dietary_energy' },
      { checkId: 'stale', metricId: '' },
    ]);
  });

  it('silencing twice keeps one row', async () => {
    const db = new FakeSilenced();
    await pgSilence(db, { checkId: 'stale', metricId: '' });
    await pgSilence(db, { checkId: 'stale', metricId: '' });
    expect(db.rows).toHaveLength(1);
  });

  it('restores one, and restoring something not silenced is not an error', async () => {
    const db = new FakeSilenced();
    await pgSilence(db, { checkId: 'stale', metricId: '' });
    await pgSilence(db, { checkId: 'late-start', metricId: 'step_count' });
    await pgRestore(db, { checkId: 'stale', metricId: '' });
    await pgRestore(db, { checkId: 'stale', metricId: '' });
    expect(await pgReadSilenced(db)).toEqual([{ checkId: 'late-start', metricId: 'step_count' }]);
  });

  it('drops a stored row whose check id is no longer known, instead of serving it', async () => {
    const db = new FakeSilenced();
    db.rows.push({ check_id: 'removed-check', metric_id: '', silenced_at: '2026-10-01T00:00:00.000Z' });
    expect(await pgReadSilenced(db)).toEqual([]);
  });

  it('writes only the two ids: no day, range or value reaches the statement', async () => {
    const db = new FakeSilenced();
    await pgSilence(db, { checkId: 'late-start', metricId: 'step_count' });
    expect(db.statements.join(' ')).not.toMatch(/\b(day|range|value|from|to)\b\s*[,)=]/i);
    expect(Object.keys(db.rows[0]).sort()).toEqual(['check_id', 'metric_id', 'silenced_at']);
  });
});
