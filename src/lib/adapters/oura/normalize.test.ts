import { describe, expect, it } from 'vitest';
import type { MetricObservation, SleepObservation } from '@/lib/metrics/types';
import { OURA_SOURCE_NAME, normalizeOura, type OuraRawBundle } from './normalize';
import sleepFx from './__fixtures__/sleep.json';
import activityFx from './__fixtures__/daily_activity.json';
import spo2Fx from './__fixtures__/daily_spo2.json';
import readinessFx from './__fixtures__/daily_readiness.json';
import vo2Fx from './__fixtures__/vO2_max.json';
import heartFx from './__fixtures__/heartrate.json';
import workoutFx from './__fixtures__/workout.json';

// Synthetic documents in the shape of Oura's sandbox. Every value is invented.

const CTX = { tz: 'America/Chicago', referenceKey: '2026-09-29', windowStartKey: '2026-09-20' };

function bundle(): OuraRawBundle {
  return {
    sleep: sleepFx.data,
    dailyActivity: activityFx.data,
    dailySpo2: spo2Fx.data,
    dailyReadiness: readinessFx.data,
    vo2Max: vo2Fx.data,
    heartrate: heartFx.data,
    workouts: workoutFx.data,
  } as unknown as OuraRawBundle;
}

const contribution = normalizeOura(bundle(), CTX);
const series = (id: string) => (contribution.metrics[id] ?? []) as MetricObservation[];
const nights = () => (contribution.metrics['sleep_analysis'] ?? []) as SleepObservation[];
const byDate = <T extends { date: string }>(rows: T[], date: string) => rows.find(r => r.date === date);

describe('normalizeOura: shape', () => {
  it('tags every record with the ring source and lists it once', () => {
    expect(contribution.sources).toEqual(['Oura Ring']);
    expect(OURA_SOURCE_NAME).toBe('Oura Ring');
    for (const rows of Object.values(contribution.metrics)) {
      for (const r of rows as { source: string }[]) expect(r.source).toBe('Oura Ring');
    }
    for (const w of contribution.workouts) expect(w.source).toBe('Oura Ring');
    for (const c of Object.values(contribution.coverage)) expect(c.sourceNames).toEqual(['Oura Ring']);
  });

  it('counts the documents it read', () => {
    const b = bundle();
    const total = Object.values(b).reduce((n, rows) => n + (rows?.length ?? 0), 0);
    expect(contribution.recordsRead).toBe(total);
  });

  it('maps no vendor score and no energy-equivalent distance', () => {
    const ids = Object.keys(contribution.metrics);
    expect(ids.filter(id => /score|stress|resilien|cardiovascular_age|distance/.test(id))).toEqual([]);
    expect(ids.sort()).toEqual([
      'active_energy', 'blood_oxygen_saturation', 'heart_rate', 'hrv_rmssd_sleep',
      'lowest_heart_rate_sleep', 'respiratory_rate', 'sleep_analysis', 'step_count',
      'temperature_deviation', 'vo2max',
    ]);
  });
});

describe('normalizeOura: sleep', () => {
  it('converts a long_sleep to minutes and maps light to core', () => {
    expect(byDate(nights(), '2026-09-20')).toEqual({
      date: '2026-09-20',
      bedtime: '2026-09-19T23:10:00-05:00',
      wakeTime: '2026-09-20T07:05:00-05:00',
      durationMinutes: 470,
      inBedMinutes: 470,
      asleepMinutes: 430,
      stages: { deep: 85, rem: 90, core: 255, awake: 40 },
      source: 'Oura Ring',
    });
  });

  it('keeps one night per day: the nap is not added to the long sleep', () => {
    const night = byDate(nights(), '2026-09-22')!;
    expect(nights().filter(n => n.date === '2026-09-22')).toHaveLength(1);
    expect(night.asleepMinutes).toBe(440);
    expect(night.inBedMinutes).toBe(480);
  });

  it('ignores a deleted sleep, however long it was', () => {
    const night = byDate(nights(), '2026-09-24')!;
    expect(night.asleepMinutes).toBe(420);
    expect(byDate(series('hrv_rmssd_sleep'), '2026-09-24')?.qty).toBe(52);
  });

  it('with no long_sleep takes the longest period, never a sum', () => {
    const night = byDate(nights(), '2026-09-25')!;
    expect(night.asleepMinutes).toBe(320);
    expect(night.inBedMinutes).toBe(340);
    expect(byDate(series('lowest_heart_rate_sleep'), '2026-09-25')?.qty).toBe(53);
  });

  it('writes nothing for a day without a sleep', () => {
    expect(byDate(nights(), '2026-09-27')).toBeUndefined();
    expect(byDate(series('respiratory_rate'), '2026-09-27')).toBeUndefined();
    expect(nights()).toHaveLength(9);
  });

  it('takes breathing rate, overnight HRV and lowest heart rate from the chosen period', () => {
    expect(byDate(series('respiratory_rate'), '2026-09-20')).toMatchObject({ qty: 14, units: 'breaths/min' });
    expect(byDate(series('hrv_rmssd_sleep'), '2026-09-20')).toMatchObject({ qty: 55, units: 'ms' });
    expect(byDate(series('lowest_heart_rate_sleep'), '2026-09-20')).toMatchObject({ qty: 48, units: 'bpm' });
    // the nap's values (hrv 33) never reach the day
    expect(byDate(series('hrv_rmssd_sleep'), '2026-09-22')?.qty).toBe(61);
  });

  it('keeps an in-bed-only period as in-bed only, with no invented stages', () => {
    const out = normalizeOura(
      {
        sleep: [{
          id: 'x', day: '2026-09-21', type: 'long_sleep',
          bedtime_start: '2026-09-20T23:00:00-05:00', bedtime_end: '2026-09-21T06:00:00-05:00',
          time_in_bed: 25200, total_sleep_duration: null, deep_sleep_duration: null,
          light_sleep_duration: null, rem_sleep_duration: null, awake_time: null,
          average_breath: null, average_hrv: null, lowest_heart_rate: null,
        }],
      } as unknown as OuraRawBundle,
      CTX
    );
    const n = (out.metrics['sleep_analysis'] as SleepObservation[])[0];
    expect(n.inBedMinutes).toBe(420);
    expect(n.stages).toEqual({ deep: 0, rem: 0, core: 0, awake: 0 });
    expect(out.metrics['respiratory_rate']).toBeUndefined();
    expect(out.metrics['hrv_rmssd_sleep']).toBeUndefined();
  });

  it('skips a period that has neither a duration nor a window', () => {
    const out = normalizeOura(
      { sleep: [{ id: 'y', day: '2026-09-21', type: 'long_sleep', time_in_bed: null, total_sleep_duration: null }] } as unknown as OuraRawBundle,
      CTX
    );
    expect(out.metrics['sleep_analysis']).toBeUndefined();
  });
});

describe('normalizeOura: daily documents', () => {
  it('maps steps and active calories, flagging the still-open reference day', () => {
    expect(byDate(series('step_count'), '2026-09-20')).toMatchObject({ qty: 6000, units: 'count' });
    expect(byDate(series('active_energy'), '2026-09-20')).toMatchObject({ qty: 310, units: 'kcal' });
    expect(byDate(series('step_count'), '2026-09-29')?.partial).toBe(true);
    expect(byDate(series('step_count'), '2026-09-28')?.partial).toBeUndefined();
  });

  it('maps average SpO2 and leaves out a missing day and a null average', () => {
    expect(byDate(series('blood_oxygen_saturation'), '2026-09-20')).toMatchObject({ qty: 95.5, units: '%' });
    expect(byDate(series('blood_oxygen_saturation'), '2026-09-23')).toBeUndefined();
    expect(byDate(series('blood_oxygen_saturation'), '2026-09-26')).toBeUndefined();
    expect(series('blood_oxygen_saturation')).toHaveLength(8);
  });

  it('maps the temperature deviation in °C and omits a null', () => {
    expect(byDate(series('temperature_deviation'), '2026-09-20')).toMatchObject({ qty: -0.3, units: 'degC' });
    expect(byDate(series('temperature_deviation'), '2026-09-28')).toBeUndefined();
    expect(series('temperature_deviation')).toHaveLength(9);
  });

  it('maps VO2 max as an integer estimate', () => {
    expect(series('vo2max').map(o => [o.date, o.qty, o.units])).toEqual([
      ['2026-09-21', 38, 'ml/kg/min'],
      ['2026-09-28', 39, 'ml/kg/min'],
    ]);
  });

  it('never writes a zero for a null', () => {
    for (const rows of Object.values(contribution.metrics)) {
      for (const r of rows as unknown as { qty?: number }[]) {
        if (r.qty !== undefined) expect(Number.isFinite(r.qty)).toBe(true);
      }
    }
    const out = normalizeOura(
      {
        dailyActivity: [{ day: '2026-09-21', steps: null, active_calories: null }],
        dailySpo2: [{ day: '2026-09-21', spo2_percentage: null }],
        dailyReadiness: [{ day: '2026-09-21', temperature_deviation: null }],
        vo2Max: [{ day: '2026-09-21', vo2_max: null }],
      } as unknown as OuraRawBundle,
      CTX
    );
    expect(out.metrics).toEqual({});
    expect(out.coverage).toEqual({});
    expect(out.provenance).toEqual([]);
  });
});

describe('normalizeOura: heart rate', () => {
  it('averages every sample of a local day, whatever its source tag', () => {
    const hr = series('heart_rate') as (MetricObservation & { dailyMax: number; dailyMin: number; readings: number })[];
    const day = byDate(hr, '2026-09-20')!;
    // 68, 74, 90, 61 on the day, plus 53 sampled at 03:30 UTC on the 21st (22:30 local on the 20th)
    expect(day).toMatchObject({ qty: 69.2, units: 'bpm', dailyMax: 90, dailyMin: 53, readings: 5 });
  });

  it('buckets UTC timestamps with the profile timezone', () => {
    const hr = series('heart_rate');
    expect(byDate(hr, '2026-09-19')).toMatchObject({ qty: 52 });
    const utc = normalizeOura({ heartrate: heartFx.data } as unknown as OuraRawBundle, { ...CTX, tz: 'UTC' });
    expect((utc.metrics['heart_rate'] as MetricObservation[]).find(o => o.date === '2026-09-19')).toBeUndefined();
  });
});

describe('normalizeOura: workouts', () => {
  const w = contribution.workouts;

  it('maps an activity, converting metres to km and keeping known calories', () => {
    expect(w[0]).toEqual({
      id: 'oura:wk-1',
      workout_type: 'Cycling',
      start_time: '2026-09-21T12:00:00-05:00',
      end_time: '2026-09-21T12:50:00-05:00',
      duration_minutes: 50,
      calories_burned: 412,
      source: 'Oura Ring',
      distance_km: 18.25,
    });
  });

  it('prefers the label, and leaves unknown calories and distance unknown', () => {
    expect(w[1].workout_type).toBe('Leg Day');
    expect(w[1].calories_burned).toBeNull();
    expect('distance_km' in w[1]).toBe(false);
    expect(w[2]).toMatchObject({ workout_type: 'Walking', calories_burned: null, distance_km: 2.5, duration_minutes: 30 });
  });

  it('humanises an underscored activity', () => {
    const out = normalizeOura(
      { workouts: [{ id: 'q', activity: 'strength_training', label: null, calories: 90, distance: null,
        start_datetime: '2026-09-21T10:00:00-05:00', end_datetime: '2026-09-21T10:30:00-05:00' }] } as unknown as OuraRawBundle,
      CTX
    );
    expect(out.workouts[0].workout_type).toBe('Strength Training');
  });
});

describe('normalizeOura: coverage and provenance', () => {
  it('computes coverage from the series it wrote', () => {
    expect(contribution.coverage['sleep_analysis']).toMatchObject({
      firstObservation: '2026-09-20', lastObservation: '2026-09-29', observedDays: 9,
      expectedDays: 10, samplingFrequency: 'nightly', sourceNames: ['Oura Ring'],
    });
    expect(contribution.coverage['vo2max']).toMatchObject({ observedDays: 2 });
  });

  it('names the Oura collection and field in each provenance row', () => {
    const row = (id: string) => contribution.provenance.find(p => p.metricId === id)!;
    expect(row('step_count')).toMatchObject({ haeMetric: 'daily_activity.steps', aggregation: 'sum', sources: ['Oura Ring'], recordsRead: 10, observations: 10 });
    expect(row('hrv_rmssd_sleep').haeMetric).toBe('sleep.average_hrv');
    expect(row('vo2max').haeMetric).toBe('vO2_max.vo2_max');
    expect(row('heart_rate').haeMetric).toBe('heartrate.bpm');
    expect(row('sleep_analysis')).toMatchObject({ aggregation: 'sleep', canonicalUnit: 'min' });
    expect(contribution.provenance).toHaveLength(Object.keys(contribution.metrics).length);
  });

  it('returns an empty contribution for an empty bundle', () => {
    const out = normalizeOura({}, CTX);
    expect(out).toMatchObject({ metrics: {}, coverage: {}, workouts: [], provenance: [], recordsRead: 0, sources: [] });
  });
});
