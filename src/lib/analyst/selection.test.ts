// ── The selection is labelled (design §5.3) ──────────────────

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REFERENCE_KEY } from '../adapters/dataset';
import { ALLOW_ALL } from './capabilities/types';
import { retrieveGeneral, retrieveNone } from './retrieval';
import { applyPolicy, selectionIncludes, selectionNote } from './selection';
import { buildAnalystUserMessage, buildContextPayload, DEFAULT_ANALYST_SYSTEM_PROMPT, buildDataToolsPrompt } from './systemPrompt';
import type { LabContextSnapshot, MedicationContextSnapshot } from './types';

const WITH_TOOLS = [
  'This is a STARTING SELECTION, not the record. It holds: A; B. Everything else the app holds is listed in the coverage index above and was not included here.',
  'If the question needs anything that is not in this selection, fetch it with the tools.',
  'Never say that something is not recorded, missing or absent because it is not in this selection; say that only after a tool returned no_data_in_window for it.',
].join(' ');
const NO_TOOLS = [
  'This is a STARTING SELECTION, not the record. It holds: A; B. Everything else the app holds is listed in the coverage index above.',
  'You cannot fetch more in this answer.',
  'For anything the question needs that is not here, say that it was not included in what you were given and how much of it the app holds (from the index); never say it is not recorded.',
].join(' ');

describe('selectionNote', () => {
  it('is the design text when tools are available', () => expect(selectionNote(['A', 'B'], true)).toBe(WITH_TOOLS));
  it('is the design text when tools are not available', () => expect(selectionNote(['A', 'B'], false)).toBe(NO_TOOLS));
  it('says it holds nothing when nothing was selected', () => expect(selectionNote([], true)).toContain('It holds: nothing.'));
  it('never says the rest was not sent anywhere', () => {
    expect(selectionNote(['A'], true)).not.toMatch(/not sent anywhere/);
    expect(selectionNote(['A'], false)).not.toMatch(/not sent anywhere/);
  });
});

describe('selectionIncludes', () => {
  it('lists the metric summaries, the workout roll-up, each with its window', () => {
    const general = retrieveGeneral(REFERENCE_KEY);
    const includes = selectionIncludes(general);
    expect(includes.some(i => /^metric summaries \(.+\) for .+, \d{4}-\d\d-\d\d\.\.\d{4}-\d\d-\d\d$/.test(i))).toBe(true);
    expect(includes.some(i => /^the workout roll-up for \d{4}-\d\d-\d\d\.\.\d{4}-\d\d-\d\d$/.test(i))).toBe(true);
  });

  it('lists nothing for an empty selection', () => expect(selectionIncludes(retrieveNone('general', REFERENCE_KEY))).toEqual([]));

  it('lists an available lab block and medication block, and leaves out an unavailable one', () => {
    const base = retrieveNone('general', REFERENCE_KEY);
    const lab = { available: true, selection: 'overview', requestedName: null, shownSeries: 30, totalSeries: 80 } as unknown as LabContextSnapshot;
    const med = { available: true, windowFrom: '2026-09-09', windowTo: '2026-10-08', referenceDay: '2026-10-08' } as unknown as MedicationContextSnapshot;
    expect(selectionIncludes({ ...base, lab, medications: med })).toEqual(['a lab results overview (30 of 80 stored series)', 'medication records for 2026-09-09..2026-10-08']);
    expect(selectionIncludes({ ...base, lab: { ...lab, available: false } as LabContextSnapshot, medications: { ...med, available: false } as MedicationContextSnapshot })).toEqual([]);
  });
});

describe('buildContextPayload', () => {
  it('labels the selection incomplete and lists what it includes', () => {
    const bundle = retrieveGeneral(REFERENCE_KEY);
    const payload = buildContextPayload(bundle, 'metric', { tools: true });
    expect(payload.selection.complete).toBe(false);
    expect(payload.selection.includes).toEqual(selectionIncludes(bundle));
    expect(payload.selectionNote).toBe(selectionNote(selectionIncludes(bundle), true));
  });

  it('uses the no-tools wording when tools are not available, and by default', () => {
    const bundle = retrieveGeneral(REFERENCE_KEY);
    expect(buildContextPayload(bundle, 'metric', { tools: false }).selectionNote).toBe(selectionNote(selectionIncludes(bundle), false));
    expect(buildContextPayload(bundle, 'metric').selectionNote).toBe(selectionNote(selectionIncludes(bundle), false));
  });

  it('does not hand the user-facing note to the model', () => {
    const bundle = retrieveGeneral(REFERENCE_KEY);
    expect(bundle.note).toContain('The rest of the dataset was not sent anywhere');
    expect(JSON.stringify(buildContextPayload(bundle, 'metric', { tools: true }))).not.toContain('not sent anywhere');
  });
});

describe('the user message', () => {
  const base = { question: 'How many workouts did I do in March?', system: 'metric' as const };

  it('puts the coverage index before the selection JSON', () => {
    const msg = buildAnalystUserMessage({ ...base, bundle: retrieveGeneral(REFERENCE_KEY), index: 'COVERAGE-INDEX-TEXT', tools: true });
    const at = msg.indexOf('COVERAGE-INDEX-TEXT');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(msg.indexOf('"selection"'));
    expect(msg).toContain('STARTING SELECTION');
  });

  it('wraps the index as untrusted data', () => {
    const msg = buildAnalystUserMessage({ ...base, bundle: retrieveGeneral(REFERENCE_KEY), index: 'COVERAGE-INDEX-TEXT', tools: false });
    const before = msg.slice(0, msg.indexOf('COVERAGE-INDEX-TEXT'));
    expect(before.lastIndexOf('<<<UNTRUSTED_CONTEXT_START>>>')).toBeGreaterThan(before.lastIndexOf('<<<UNTRUSTED_CONTEXT_END>>>'));
    expect(msg).toContain('You cannot fetch more in this answer.');
  });

  it('keeps the lab rule that a name in notIncludedSeries exists', () => {
    const msg = buildAnalystUserMessage({ ...base, bundle: retrieveGeneral(REFERENCE_KEY), index: 'x', tools: true });
    expect(msg).toContain('notIncludedSeries');
    expect(msg).toContain('the selection is incomplete');
  });
});

describe('applyPolicy', () => {
  const deny = (...cats: string[]) => ({ allows: (c: string) => !cats.includes(c) });
  const bundle = { ...retrieveGeneral(REFERENCE_KEY), lab: { available: true } as unknown as LabContextSnapshot, medications: { available: true } as unknown as MedicationContextSnapshot };

  it('keeps everything under ALLOW_ALL', () => expect(applyPolicy(bundle, ALLOW_ALL)).toEqual(bundle));

  it('removes each category the policy withholds, and only that', () => {
    expect(applyPolicy(bundle, deny('workouts')).workouts).toBeNull();
    expect(applyPolicy(bundle, deny('workouts')).summaries.length).toBeGreaterThan(0);
    expect(applyPolicy(bundle, deny('metric-summaries')).summaries).toEqual([]);
    expect(applyPolicy(bundle, deny('lab-results')).lab).toBeNull();
    expect(applyPolicy(bundle, deny('medication-records')).medications).toBeNull();
  });
});

describe('the grounding sentences', () => {
  const OLD_ANSWER = 'Answer only from the context supplied in the user message.';
  const OLD_ZERO = 'was not recorded in the selected window';
  const NEW_ANSWER = 'Answer only from the context supplied in the user message and what the tools return.';
  const NEW_ZERO = 'has no records in that window (the tool states what the app holds and for which dates)';
  const NEW_RULE = 'A capability that is in the coverage index with records exists. Absence is a tool result (`no_data_in_window`), never an inference from a selection.';

  it('changes in the built-in prompt', () => {
    expect(DEFAULT_ANALYST_SYSTEM_PROMPT).not.toContain('supplied in the user message.');
    expect(DEFAULT_ANALYST_SYSTEM_PROMPT).toContain(NEW_ANSWER);
    expect(DEFAULT_ANALYST_SYSTEM_PROMPT).not.toContain(OLD_ZERO);
    expect(DEFAULT_ANALYST_SYSTEM_PROMPT).toContain(NEW_ZERO);
    expect(DEFAULT_ANALYST_SYSTEM_PROMPT).toContain(NEW_RULE);
  });

  it('changes in the deployed prompt file, config/analyst-prompt.md', () => {
    const file = readFileSync(join(process.cwd(), 'config/analyst-prompt.md'), 'utf8').replace(/\s+/g, ' ');
    expect(file).not.toContain(`- ${OLD_ANSWER}`);
    expect(file).toContain(NEW_ANSWER);
    expect(file).not.toContain(OLD_ZERO);
    expect(file).toContain('has no records in that window (the tool states what the app holds and for which dates)');
    expect(file).toContain(NEW_RULE);
  });
});

describe('the data tools prompt', () => {
  const prompt = buildDataToolsPrompt('THE-MAP');

  it('carries the map', () => expect(prompt).toContain('THE-MAP'));
  it('keeps the source-name rule', () => expect(prompt).toContain('Name a data source only when the question is about sources or connections.'));
  it('states that absence is a tool result', () => {
    expect(prompt).toMatch(/Absence is a tool result/);
    expect(prompt).toContain('no_data_in_window');
  });
  it('no longer says a name absent from the index is not recorded', () => {
    expect(prompt).not.toMatch(/in neither the index nor a tool result is not recorded/);
  });
  it('no longer lists the tools by name in prose (the map does)', () => {
    expect(prompt).not.toContain('get_metrics (one to three metrics');
    // Nor does it name the two tools get_metric_series replaced.
    expect(prompt).not.toContain('get_metrics');
    expect(prompt).not.toContain('compare_periods');
  });
});
