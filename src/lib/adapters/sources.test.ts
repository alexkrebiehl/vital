import { describe, expect, it } from 'vitest';
import {
  SOURCE_DEDUPE_RULE,
  SOURCE_RULES,
  dedupeByInterval,
  dedupeSameInstant,
  excludesSource,
  familyOf,
  sourceLabel,
  sourceRank,
  sourceRuleFor,
  splitSources,
} from '@/lib/adapters/sources';
import type { SourcedRecord } from '@/lib/adapters/sources';

const WATCH = 'Apple Watch';
const PHONE = 'iPhone';
const SCALE = 'Smart Scale';

const day = (r: SourcedRecord) => r.date.slice(0, 10);

describe('source parsing (SPEC §9, §10)', () => {
  it('splits a composite source into its contributing devices', () => {
    expect(splitSources(`${WATCH}|${PHONE}`)).toEqual([WATCH, PHONE]);
    expect(splitSources(`${WATCH}|Renpho|${SCALE}`)).toEqual([WATCH, 'Renpho', SCALE]);
    expect(splitSources(WATCH)).toEqual([WATCH]);
  });

  it('handles the empty source some metrics really carry', () => {
    expect(splitSources('')).toEqual([]);
    expect(splitSources('   ')).toEqual([]);
    expect(splitSources(undefined)).toEqual([]);
    expect(splitSources(null)).toEqual([]);
    expect(sourceLabel('')).toBe('unattributed source');
    expect(sourceLabel(`${WATCH}|${PHONE}`)).toBe(`${WATCH} · ${PHONE}`);
  });

  it('classifies the device names the API actually reports', () => {
    expect(familyOf(WATCH)).toBe('watch');
    expect(familyOf('watch')).toBe('watch');
    expect(familyOf(PHONE)).toBe('phone');
    expect(familyOf('iPhone')).toBe('phone');
    expect(familyOf('Renpho')).toBe('scale');
    expect(familyOf(SCALE)).toBe('scale');
    expect(familyOf('ViHealth')).toBe('cuff');
    expect(familyOf('Some Unknown App')).toBe('other');
    expect(familyOf('')).toBe('other');
  });

  it('ranks a composite record by its best contributing device', () => {
    const rule = sourceRuleFor('step_count');
    expect(sourceRank(WATCH, rule)).toBe(0);
    expect(sourceRank(`${WATCH}|${PHONE}`, rule)).toBe(0);
    // A ring sits between the watch and the phone, so the phone is third.
    expect(sourceRank(PHONE, rule)).toBe(rule.priority.indexOf('phone'));
    expect(sourceRank('', rule)).toBe(rule.priority.length);
  });

  it('prefers the scale for body metrics and the cuff for blood pressure', () => {
    const scaleRule = sourceRuleFor('weight_body_mass');
    expect(sourceRank(SCALE, scaleRule)).toBe(0);
    expect(sourceRank(WATCH, scaleRule)).toBeGreaterThan(0);
    const cuffRule = sourceRuleFor('blood_pressure');
    expect(sourceRank('ViHealth', cuffRule)).toBe(0);
    expect(sourceRank(PHONE, cuffRule)).toBeGreaterThan(0);
  });

  it('states the rule it applies', () => {
    expect(SOURCE_DEDUPE_RULE).toContain('One device is used per metric per interval');
    expect(SOURCE_RULES.watch_first.explanation).toContain('Apple Watch is preferred');
  });
});

describe('de-duplication (never blind-sum overlapping devices)', () => {
  it('keeps one device per interval and sets the other aside', () => {
    const records: SourcedRecord[] = [
      { date: '2026-09-16T05:00:00.000Z', source: PHONE, qty: 100 },
      { date: '2026-09-16T05:00:00.000Z', source: WATCH, qty: 120 },
      { date: '2026-09-16T06:00:00.000Z', source: `${WATCH}|${PHONE}`, qty: 7 },
      { date: '2026-09-16T07:00:00.000Z', source: PHONE, qty: 3 },
      { date: '2026-09-17T05:00:00.000Z', source: PHONE, qty: 55 },
    ];

    const result = dedupeByInterval(records, sourceRuleFor('step_count'), day);

    // The watch recorded 2026-09-16, so the phone's records for that day are set
    // aside rather than added.
    expect(result.kept.map(r => [r.date, r.qty])).toEqual([
      ['2026-09-16T05:00:00.000Z', 120],
      ['2026-09-16T06:00:00.000Z', 7],
      // 2026-09-17 has no watch record, so the phone is used for that interval.
      ['2026-09-17T05:00:00.000Z', 55],
    ]);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].intervalKey).toBe('2026-09-16');
    expect(result.dropped[0].droppedCount).toBe(2);
    expect(result.dropped[0].droppedSources.sort()).toEqual([PHONE]);
    // Order-insensitive: which devices survived is the point here, not how they
    // happen to sort.
    expect([...result.keptSources].sort()).toEqual([PHONE, WATCH].sort());
  });

  it('treats two records at one instant as a single observation', () => {
    const records: SourcedRecord[] = [
      { date: '2026-09-16T05:00:00.000Z', source: PHONE, qty: 100 },
      { date: '2026-09-16T05:00:00.000Z', source: WATCH, qty: 120 },
    ];
    const result = dedupeSameInstant(records, sourceRuleFor('step_count'));
    expect(result.kept).toHaveLength(1);
    expect(result.kept[0].qty).toBe(120);
    expect(result.duplicates).toBe(1);
  });

  it('keeps every distinct interval when only one device recorded the day', () => {
    const records: SourcedRecord[] = [
      { date: '2026-09-16T05:00:00.000Z', source: PHONE, qty: 10 },
      { date: '2026-09-16T06:00:00.000Z', source: PHONE, qty: 20 },
    ];
    const result = dedupeByInterval(records, sourceRuleFor('step_count'), day);
    expect(result.kept).toHaveLength(2);
    expect(result.dropped).toHaveLength(0);
  });

  it('honours the empty source without discarding the record', () => {
    const records: SourcedRecord[] = [
      { date: '2026-09-16T05:00:00.000Z', source: '', qty: 12 },
    ];
    const result = dedupeByInterval(records, sourceRuleFor('apple_stand_hours'), day);
    expect(result.kept).toHaveLength(1);
    expect(result.kept[0].qty).toBe(12);
  });
});

describe('ring family (device names are synthetic)', () => {
  it('classifies a ring by its name', () => {
    expect(familyOf('Oura')).toBe('ring');
    expect(familyOf('Oura Ring')).toBe('ring');
    expect(familyOf("Sample's Oura")).toBe('ring');
    expect(familyOf('Sample Smart Ring')).toBe('ring');
  });

  it('leaves the other families alone', () => {
    expect(familyOf("Sample's Apple Watch")).toBe('watch');
    expect(familyOf('iPhone')).toBe('phone');
    expect(familyOf('Sample Scale')).toBe('scale');
    expect(familyOf('Sample Spring Mattress')).toBe('other');
  });

  it('ranks a ring right after the watch in every watch-led rule', () => {
    for (const rule of Object.values(SOURCE_RULES)) {
      const i = rule.priority.indexOf('ring');
      expect(i, rule.explanation).toBeGreaterThan(-1);
      if (rule.priority.includes('watch')) expect(i).toBe(rule.priority.indexOf('watch') + 1);
    }
    const rule = sourceRuleFor('step_count');
    expect(sourceRank('Oura', rule)).toBeGreaterThan(sourceRank("Sample's Apple Watch", rule));
    expect(sourceRank('Oura', rule)).toBeLessThan(sourceRank('iPhone', rule));
  });

  it('excludes a record only when every contributing device is in an excluded family', () => {
    expect(excludesSource('Oura', ['ring'])).toBe(true);
    expect(excludesSource('Oura|Sample Smart Ring', ['ring'])).toBe(true);
    expect(excludesSource("Sample's Apple Watch|Oura", ['ring'])).toBe(false);
    expect(excludesSource("Sample's Apple Watch", ['ring'])).toBe(false);
    expect(excludesSource('Oura', [])).toBe(false);
    expect(excludesSource('Oura', undefined)).toBe(false);
  });

  it('never excludes a record that names no device', () => {
    expect(excludesSource('', ['ring'])).toBe(false);
    expect(excludesSource(undefined, ['ring'])).toBe(false);
  });
});
