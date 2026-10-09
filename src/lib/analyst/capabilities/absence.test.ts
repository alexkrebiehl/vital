// ── The absence audit (design §5.5) ─────────────────────────

import { describe, expect, it } from 'vitest';
import { appUncertaintyLine, auditAbsence, answerFields, correctiveTurn, type AuditEntry, type Lookup } from './absence';
import { CAPABILITIES } from './registry';
import type { Coverage } from './types';

const known = (count: number, unit: string, first = '2026-01-02', last = '2026-10-08'): Coverage => ({ kind: 'known', first, last, count, unit });

/** Every real capability with the coverage a test gives it (the same real terms, titles and tools). */
function entries(coverage: Record<string, Coverage | { kind: 'withheld' }>, fallback: Coverage = { kind: 'known', first: null, last: null, count: 0, unit: 'x' }): AuditEntry[] {
  return CAPABILITIES.map(c => ({ id: c.id, title: c.title, tool: c.tool, absenceTerms: c.absenceTerms, coverage: coverage[c.id] ?? fallback }));
}
const HOLDS_WORKOUTS = entries({ 'workouts.sessions': known(412, 'sessions'), 'workouts.summary': known(412, 'sessions') });
const claims = (text: string, e = HOLDS_WORKOUTS, lookups: Lookup[] = []) => auditAbsence({ analysis: text }, e, lookups).map(v => v.id);

describe('the detector', () => {
  it.each([
    'This selection contains no workout records at all.',
    'The data contains no workouts.',
    'The selection contains no workouts for March.',
    'There are no workout records in the window.',
    'The selection does not contain any workouts.',
    'None of the workouts were recorded.',
  ])('finds the claim in %j', text => {
    expect(claims(text)).toContain('workouts.sessions');
  });

  it('finds "there aren\'t any sleep nights"', () => {
    const e = entries({ 'sleep.nights': known(300, 'nights') });
    expect(claims("There aren't any sleep nights in this data.", e)).toContain('sleep.nights');
    expect(claims('There isn\u2019t any sleep data here.', e)).toContain('sleep.nights');
  });

  it.each([
    'You logged 412 workouts in the last year.',
    'No workout on rest days was longer than twenty minutes.',
    'Sleep was steady.',
    'Your heart rate was not recorded as high.',
  ])('does not find a claim in %j', text => {
    expect(claims(text)).toEqual([]);
  });

  it('reads a generic term ("not recorded") only with a word of the capability in the sentence', () => {
    const e = entries({ 'sleep.nights': known(300, 'nights'), 'heart.blood_pressure': known(88, 'readings') });
    const ids = claims('Blood pressure is not recorded in this selection.', e);
    expect(ids).toContain('heart.blood_pressure');
    expect(ids).not.toContain('sleep.nights');
  });

  it('reads analysis, summary and uncertainty, and nothing else', () => {
    const say = (field: string) => auditAbsence({ [field]: field === 'analysis' ? 'There are no workouts.' : ['There are no workouts.'] } as never, HOLDS_WORKOUTS, []);
    for (const f of ['analysis', 'summary', 'uncertainty']) expect(say(f).length, f).toBeGreaterThan(0);
    for (const f of ['recommendations', 'followUps', 'title']) expect(say(f), f).toEqual([]);
  });

  it('does not take "no workout" for the workout template', () => {
    expect(claims('No workout on Sundays.', entries({ 'training.workout_template': { kind: 'unknown', reason: 'x' } }))).toEqual([]);
  });
});

describe('the violation rule', () => {
  const TEXT = 'The selection contains no workout records.';

  it('is a violation when the app holds records and no tool of that capability was called', () => {
    const v = auditAbsence({ analysis: TEXT }, HOLDS_WORKOUTS, []);
    expect(v.map(x => x.id).sort()).toEqual(['workouts.sessions', 'workouts.summary']);
  });

  it('is not a violation once a tool of the capability was called, whatever it returned', () => {
    for (const status of ['ok', 'no_data_in_window', 'source_unavailable', 'privacy_blocked']) {
      expect(claims(TEXT, HOLDS_WORKOUTS, [{ tool: 'get_workouts', status }]), status).toEqual([]);
    }
  });

  it('is not a violation after no_data_in_window for that capability', () => {
    expect(claims(TEXT, HOLDS_WORKOUTS, [{ tool: 'get_workouts', capability: 'workouts.sessions', status: 'no_data_in_window' }])).toEqual([]);
  });

  it('still is one when only another tool was called', () => {
    expect(claims(TEXT, HOLDS_WORKOUTS, [{ tool: 'get_sleep', status: 'ok' }]).length).toBe(2);
  });

  it('is not a violation when the app holds none', () => {
    expect(claims(TEXT, entries({ 'workouts.sessions': known(0, 'sessions'), 'workouts.summary': known(0, 'sessions') }))).toEqual([]);
  });

  it('is a violation when only the upstream can tell how many it holds', () => {
    const e = entries({ 'medications.doses': { kind: 'unknown', reason: 'asked when read' } });
    expect(claims('There are no dose records.', e)).toContain('medications.doses');
  });

  it('is not a violation when the capability is unavailable or withheld: nothing could be fetched', () => {
    expect(claims(TEXT, entries({ 'workouts.sessions': { kind: 'unavailable', reason: 'x' } }))).toEqual([]);
    expect(claims(TEXT, entries({ 'workouts.sessions': { kind: 'withheld' } }))).toEqual([]);
  });

  it('names the sentence that made the claim', () => {
    const v = auditAbsence({ analysis: `First sentence. ${TEXT} Third.` }, HOLDS_WORKOUTS, []);
    expect(v[0]!.sentence).toBe(TEXT);
  });
});

describe('the corrective turn', () => {
  it('is the design text, naming the title, the count, the dates and the tool', () => {
    const v = auditAbsence({ analysis: 'There are no workout records.' }, entries({ 'workouts.sessions': known(412, 'sessions') }), []);
    expect(correctiveTurn(v)).toBe(
      'Your answer says there are no Workout sessions records. The app holds 412 sessions from 2026-01-02 to 2026-10-08. Fetch them with get_workouts before answering, then answer again in the same JSON shape.'
    );
  });

  it('says it cannot count what only the upstream can, and still asks for the fetch', () => {
    const v = auditAbsence({ analysis: 'There are no dose records.' }, entries({ 'medications.doses': { kind: 'unknown', reason: 'x' } }), []);
    expect(correctiveTurn(v)).toBe(
      'Your answer says there are no Medication doses records. The app cannot say how many it holds until you fetch them. Fetch them with get_medications before answering, then answer again in the same JSON shape.'
    );
  });

  it('puts every violating capability in the one turn', () => {
    const v = auditAbsence({ analysis: 'There are no workout records and no sleep nights.' }, entries({ 'workouts.sessions': known(412, 'sessions'), 'sleep.nights': known(300, 'nights') }), []);
    const text = correctiveTurn(v);
    expect(text).toContain('Workout sessions');
    expect(text).toContain('Sleep nights');
    expect(text.match(/answer again in the same JSON shape/g)).toHaveLength(1);
  });
});

describe('the app-rendered line when no tools are available', () => {
  it('states what the app holds, computed from the coverage', () => {
    const v = auditAbsence({ analysis: 'There are no workout records.' }, entries({ 'workouts.sessions': known(412, 'sessions') }), []);
    expect(appUncertaintyLine(v[0]!)).toBe('The app holds 412 Workout sessions from 2026-01-02 to 2026-10-08 that were not part of this answer.');
  });

  it('does not invent a count when the upstream has not been asked', () => {
    const v = auditAbsence({ analysis: 'There are no dose records.' }, entries({ 'medications.doses': { kind: 'unknown', reason: 'x' } }), []);
    expect(appUncertaintyLine(v[0]!)).toBe('The app may hold Medication doses that were not part of this answer; how many is not known without fetching them.');
  });
});

describe('answerFields', () => {
  it('reads analysis, summary and uncertainty from the answer JSON, with or without a code fence', () => {
    const json = JSON.stringify({ title: 't', analysis: 'A', summary: ['S1', 'S2'], uncertainty: ['U'], recommendations: ['R'] });
    expect(answerFields(json)).toEqual({ analysis: 'A', summary: ['S1', 'S2'], uncertainty: ['U'] });
    expect(answerFields(`\`\`\`json\n${json}\n\`\`\``)).toEqual({ analysis: 'A', summary: ['S1', 'S2'], uncertainty: ['U'] });
  });

  it('treats a reply that is not JSON as one analysis text', () => {
    expect(answerFields('There are no workouts.')).toEqual({ analysis: 'There are no workouts.' });
  });
});
