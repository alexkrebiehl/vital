import { describe, expect, it } from 'vitest';
import { addDays } from '../analytics/windows';
import { compactRecords, dataQualityReport, scanMetricRecords, startQualityJob, toRanges, type ScanRecord } from './quality';

const TZ = 'America/New_York';
const NOW = new Date('2026-10-05T14:00:00Z');
const TODAY = '2026-10-05';

/** An instant on a local (New York, EDT) day and clock time. */
const at = (day: string, h: number, m = 0, s = 0) =>
  new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)), h + 4, m, s)).toISOString();

/** Steps sample by sample: twelve 5-minute samples an hour, starting a few seconds past. */
function fineSteps(day: string, hours: number[], perSample = 50): ScanRecord[] {
  return hours.flatMap(h => Array.from({ length: 12 }, (_, i) => ({ date: at(day, h, i * 5, 7), value: perSample, source: '' })));
}

/** The same steps as hourly totals, on the hour. */
function hourlySteps(day: string, hours: number[], perSample = 50): ScanRecord[] {
  return hours.map(h => ({ date: at(day, h), value: perSample * 12, source: '' }));
}

const DAY_HOURS = [8, 9, 10, 12, 13, 15, 17, 18, 19, 20];

describe('overlapping exports', () => {
  it('flags hourly totals stored beside the samples they already contain', () => {
    const day = '2026-09-28';
    const scan = scanMetricRecords('step_count', 'sum', [...fineSteps(day, DAY_HOURS), ...hourlySteps(day, DAY_HOURS)], TZ);
    expect([...scan.overlapDays.keys()]).toEqual([day]);
    expect(scan.overlapDays.get(day)!.hours).toBe(DAY_HOURS.length);

    const report = dataQualityReport({ scans: [scan], daysByMetric: { step_count: [day] }, referenceKey: TODAY, now: NOW });
    const finding = report.findings.find(f => f.check === 'overlapping-exports')!;
    expect(finding.severity).toBe('problem');
    expect(finding.detail).toMatch(/Steps/);
    expect(finding.detail).toMatch(/about 100 % too high/);
    expect(finding.remedy.join(' ')).toMatch(/one time grouping/);
    expect(report.checks.find(c => c.id === 'overlapping-exports')!.outcome).toBe('flagged');
  });

  it('still flags an hour whose sample on the hour was overwritten by the total', () => {
    // The server merged the total into the sample that started exactly on the hour.
    const day = '2026-09-29';
    const records = DAY_HOURS.flatMap(h => [
      { date: at(day, h), value: 600, source: '' },
      ...Array.from({ length: 11 }, (_, i) => ({ date: at(day, h, (i + 1) * 5, 7), value: 50, source: '' })),
    ]);
    expect(scanMetricRecords('step_count', 'sum', records, TZ).overlapDays.has(day)).toBe(true);
  });

  it('leaves a single time grouping alone, hourly or sample by sample', () => {
    const day = '2026-07-14';
    expect(scanMetricRecords('step_count', 'sum', hourlySteps(day, DAY_HOURS), TZ).overlapDays.size).toBe(0);
    expect(scanMetricRecords('step_count', 'sum', fineSteps(day, DAY_HOURS), TZ).overlapDays.size).toBe(0);
  });

  it('does not mistake one-minute samples, one of which starts on the hour, for a total', () => {
    // Exercise minutes: a 1-minute sample at 16:00 and another at 16:41, on two hours.
    const day = '2025-11-09';
    const records = [16, 18].flatMap(h => [
      { date: at(day, h), value: 1, source: '' },
      { date: at(day, h, 41, 3), value: 1, source: '' },
    ]);
    expect(scanMetricRecords('apple_exercise_time', 'sum', records, TZ).overlapDays.size).toBe(0);
  });

  it('does not mistake minute totals (one of which falls on the hour) for an overlap', () => {
    const day = '2026-07-15';
    const minutes = DAY_HOURS.flatMap(h => Array.from({ length: 60 }, (_, m) => ({ date: at(day, h, m), value: 10, source: '' })));
    expect(scanMetricRecords('step_count', 'sum', minutes, TZ).overlapDays.size).toBe(0);
  });
});

describe('duplicate readings', () => {
  it('flags an on-the-hour copy of a weigh-in, and not a second scale’s reading', () => {
    const day = '2026-09-28';
    const scan = scanMetricRecords(
      'weight_body_mass',
      'latest',
      [
        { date: at(day, 7, 47, 12), value: 80.2, source: 'Weight Gurus' },
        { date: at(day, 7), value: 80.2, source: 'Weight Gurus' },
        { date: at(day, 10), value: 80.4, source: 'Lose It!' },
      ],
      TZ
    );
    expect([...scan.duplicateDays.entries()]).toEqual([[day, 1]]);
    const report = dataQualityReport({ scans: [scan], daysByMetric: {}, referenceKey: TODAY, now: NOW });
    expect(report.findings.find(f => f.check === 'duplicate-readings')!.severity).toBe('warning');
  });
});

describe('missing days and late starts', () => {
  const span = (from: string, to: string) => {
    const out: string[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
    return out;
  };
  const watch = span('2026-04-01', '2026-10-04');

  it('flags a daily metric missing on days the watch was in use, as runs', () => {
    // Only heart rate was exported for those months: the watch was worn, the rest was left out.
    const steps = [...span('2026-04-01', '2026-04-19'), ...span('2026-09-25', '2026-10-04')];
    const report = dataQualityReport({
      scans: [],
      daysByMetric: { step_count: steps, basal_energy_burned: steps, heart_rate: watch },
      referenceKey: TODAY,
      now: NOW,
    });
    const finding = report.findings.find(f => f.check === 'missing-days')!;
    expect(finding.severity).toBe('problem');
    expect(finding.metrics).toEqual(['step_count', 'basal_energy_burned']);
    expect(finding.ranges).toEqual([{ from: '2026-04-20', to: '2026-09-24', days: 158 }]);
    expect(finding.remedy.join(' ')).toMatch(/unlocked/);
  });

  it('does not count the day still being recorded, or days before a metric began', () => {
    const report = dataQualityReport({
      scans: [],
      daysByMetric: { step_count: span('2026-05-01', '2026-10-04'), basal_energy_burned: [...watch, TODAY], heart_rate: [...watch, TODAY] },
      referenceKey: TODAY,
      now: NOW,
    });
    expect(report.findings.find(f => f.check === 'missing-days')).toBeUndefined();
    expect(report.findings.find(f => f.check === 'late-start')!.metrics).toEqual(['step_count']);
  });

  it('notes a food log that starts long after everything else, once', () => {
    const report = dataQualityReport({
      scans: [],
      daysByMetric: {
        step_count: watch,
        heart_rate: watch,
        dietary_energy: span('2026-06-13', '2026-10-04'),
        dietary_protein: span('2026-06-13', '2026-10-04'),
      },
      referenceKey: TODAY,
      now: NOW,
    });
    const late = report.findings.filter(f => f.check === 'late-start');
    expect(late).toHaveLength(1);
    expect(late[0].severity).toBe('info');
    expect(late[0].detail).toMatch(/73 days after/);
    // A note by nature, not by age: no "more than 90 days ago" on it.
    const check = report.checks.find(c => c.id === 'late-start')!;
    expect(check.outcome).toBe('note');
    expect(check.summary).not.toMatch(/90 days/);
    expect(late[0].detail).not.toMatch(/90 days/);
  });
});

describe('older history', () => {
  const span = (from: string, to: string) => {
    const out: string[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
    return out;
  };
  const watch = span('2025-10-01', '2026-10-04');

  it('is a note when every affected day is more than 90 days old', () => {
    const steps = watch.filter(d => d < '2026-01-01' || d > '2026-03-31');
    const report = dataQualityReport({
      scans: [],
      daysByMetric: { step_count: steps, heart_rate: watch },
      referenceKey: TODAY,
      now: NOW,
    });
    const finding = report.findings.find(f => f.check === 'missing-days')!;
    expect(finding.severity).toBe('info');
    expect(finding.detail).toMatch(/more than 90 days old, so recent figures are not affected/);
    expect(report.checks.find(c => c.id === 'missing-days')!.outcome).toBe('note');
  });

  it('stays a problem when any of it falls within the last 90 days', () => {
    const steps = watch.filter(d => (d < '2026-01-01' || d > '2026-03-31') && (d < '2026-09-01' || d > '2026-09-05'));
    const report = dataQualityReport({
      scans: [],
      daysByMetric: { step_count: steps, heart_rate: watch },
      referenceKey: TODAY,
      now: NOW,
    });
    expect(report.findings.find(f => f.check === 'missing-days')!.severity).toBe('problem');
    expect(report.checks.find(c => c.id === 'missing-days')!.outcome).toBe('flagged');
  });
});

describe('days the watch was not worn', () => {
  it('are not missing days: with no heart rate and only phone steps, nothing was left out', () => {
    const days = ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05'];
    const report = dataQualityReport({
      scans: [],
      daysByMetric: {
        step_count: days,
        heart_rate: ['2026-08-01', '2026-08-05'],
        active_energy: ['2026-08-01', '2026-08-05'],
      },
      referenceKey: TODAY,
      now: NOW,
    });
    expect(report.findings.find(f => f.check === 'missing-days')).toBeUndefined();
  });
});

describe('a stalled automation', () => {
  it('flags watch data more than a day and a half old, and passes fresh data', () => {
    const stale = scanMetricRecords('heart_rate', 'mean', [{ date: '2026-10-03T08:00:00Z', value: 60, source: '' }], TZ);
    const report = dataQualityReport({ scans: [stale], daysByMetric: {}, referenceKey: TODAY, now: NOW });
    expect(report.findings.find(f => f.check === 'stale')!.detail).toMatch(/54 hours old/);

    const fresh = scanMetricRecords('heart_rate', 'mean', [{ date: '2026-10-05T13:30:00Z', value: 60, source: '' }], TZ);
    const ok = dataQualityReport({ scans: [fresh], daysByMetric: {}, referenceKey: TODAY, now: NOW });
    expect(ok.checks.find(c => c.id === 'stale')!.outcome).toBe('pass');
  });
});

describe('a clean export', () => {
  it('passes every check and lists each one', () => {
    const report = dataQualityReport({ scans: [], daysByMetric: {}, referenceKey: TODAY, now: NOW });
    expect(report.findings).toEqual([]);
    expect(report.checks.map(c => c.outcome)).toEqual(['pass', 'pass', 'pass', 'pass', 'pass']);
  });

  it('merges days into runs, newest first', () => {
    expect(toRanges(['2026-01-03', '2026-01-01', '2026-01-02', '2026-01-07'])).toEqual([
      { from: '2026-01-07', to: '2026-01-07', days: 1 },
      { from: '2026-01-01', to: '2026-01-03', days: 3 },
    ]);
  });
});

describe('running the checks in the background', () => {
  it('starts as computing, finishes with the same report as a direct run, and releases the records', async () => {
    const day = '2026-09-28';
    const records = [...fineSteps(day, DAY_HOURS), ...hourlySteps(day, DAY_HOURS)];
    const metrics = [
      { metricId: 'step_count', aggregation: 'sum' as const, data: compactRecords(records), newest: null },
      { metricId: 'heart_rate', aggregation: 'mean' as const, data: null, newest: Date.parse('2026-10-05T13:30:00Z') },
    ];
    const job = startQualityJob({ metrics, daysByMetric: { step_count: [day] }, referenceKey: TODAY, now: NOW, tz: TZ });
    expect(job.state).toBe('computing');
    expect(job.value).toBeNull();

    const report = await job.promise;
    expect(job.state).toBe('ready');
    expect(report).toBe(job.value);
    expect(report!.findings.map(f => f.check)).toEqual(['overlapping-exports']);
    expect(report!.checks.find(c => c.id === 'stale')!.outcome).toBe('pass');
    expect(metrics).toHaveLength(0);
  });
});
