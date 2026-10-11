// ── Measured budgets (design §8) ────────────────────────────────────────────
//
// What the model is sent, measured over the synthetic dataset (installBodyDataset:
// seed 11, 400 days, 420 workouts, a food log and weigh-ins): the ten data tool
// specs, the static map, the coverage index and every tool result at its default
// and its maximum limit. The ceilings are the design's; the numbers below are what
// the code measured when this gate landed, so the next change sees how much room it
// has. Characters, not tokens.
//
// Measured (characters; ceiling in brackets):
//   data tool specs, ten            10,810 [12,000]
//   static capability map            3,143 [4,000]
//   coverage index                   2,362 [6,000]
//   result, default / max limit      [12,000 each]
//     get_metric_series (3 metrics)  11,227 / 11,036
//     get_metric_relationship           588
//     get_workouts sessions           5,483 / 6,680     summary 5,700
//     get_sleep nights                3,745 / 8,019     summary 1,972
//     get_blood_pressure              5,384 / 6,161
//     get_medications doses           7,815 / 9,997     summary 1,373
//     get_lab_results (3 series, history) 1,091   compare_lab_panels 305
//     get_app_data labs.documents       487
//     get_app_data nutrition_adherence 5,897 / 6,616
//     get_app_data insights.reports   9,296 / 9,392
// Each run also prints its number (console.info "budget: ...").
//
// A change that grows one of these past its ceiling fails here, naming the number.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetToDemoDataset } from '../../adapters/dataset';
import { createDataAccess } from '../dataAccess';
import { runTool, toolSpecs } from '../tools';
import { MAX_DATA_RESULT_CHARS, DATA_TOOLS } from '../tools/data';
import { installBodyDataset } from './app.fake';
import { allReaders } from './app-state.fake';
import { buildCoverageIndex, COVERAGE_INDEX_MAX_CHARS } from './coverage-index';
import { CAPABILITY_MAP_MAX_CHARS, renderCapabilityMap } from './map';
import { CAPABILITIES } from './registry';
import { DEMO, testCtx } from './test-context.fake';
import { BUDGET_CALLS } from './budget.calls';
import { REF, strengthSessions, trainingData } from './test-dataset.fake';
import { DATED_LABS } from './lab.fake';
import { records, TZ } from './medications.fake';

const SPECS_MAX_CHARS = 12_000;

let data: ReturnType<typeof installBodyDataset>;
beforeEach(() => void (data = installBodyDataset()));
afterEach(() => resetToDemoDataset());

function toolCtx() {
  const access = createDataAccess({
    system: 'metric',
    refKey: REF,
    env: DEMO,
    app: allReaders(),
    medicationLog: async () => ({ available: true, reason: null, timezone: TZ, records: records() }),
    labSource: async () => DATED_LABS,
    training: async () => trainingData(strengthSessions(data)),
  });
  return { system: 'metric' as const, deps: { env: DEMO }, changes: [], data: access };
}

describe('prompt budgets', () => {
  it('keeps the ten data tool specs within 12,000 characters together', () => {
    expect(DATA_TOOLS).toHaveLength(10);
    const size = JSON.stringify(toolSpecs(DATA_TOOLS)).length;
    console.info(`budget: data tool specs ${size} of ${SPECS_MAX_CHARS}`);
    expect(size).toBeLessThanOrEqual(SPECS_MAX_CHARS);
  });

  it('keeps the static capability map within 4,000 characters', () => {
    const size = renderCapabilityMap(CAPABILITIES).length;
    console.info(`budget: static map ${size} of ${CAPABILITY_MAP_MAX_CHARS}`);
    expect(CAPABILITY_MAP_MAX_CHARS).toBe(4_000);
    expect(size).toBeLessThanOrEqual(4_000);
  });

  it('keeps the coverage index within 6,000 characters', async () => {
    const cctx = testCtx({ app: allReaders() });
    const { text } = await buildCoverageIndex(CAPABILITIES, cctx);
    console.info(`budget: coverage index ${text.length} of ${COVERAGE_INDEX_MAX_CHARS}`);
    expect(COVERAGE_INDEX_MAX_CHARS).toBe(6_000);
    expect(text.length).toBeLessThanOrEqual(6_000);
  });
});

describe('result budgets: every tool at its default and its maximum limit', () => {
  it('measures the design ceiling of one result as 12,000', () => {
    expect(MAX_DATA_RESULT_CHARS).toBe(12_000);
  });

  it.each(BUDGET_CALLS)('$label stays within 12,000 characters', async ({ label, tool, args }) => {
    const r = await runTool(tool, args, toolCtx());
    console.info(`budget: ${label} ${r.content.length} of ${MAX_DATA_RESULT_CHARS}`);
    expect(r.isError, r.content.slice(0, 200)).toBe(false);
    expect(r.content.length).toBeLessThanOrEqual(MAX_DATA_RESULT_CHARS);
  });

  it('covers every paged capability at its maximum limit', () => {
    const paged = CAPABILITIES.filter(c => c.page && c.page.maxLimit > c.page.defaultLimit).map(c => c.id);
    const covered = BUDGET_CALLS.filter(c => c.max).map(c => c.capability);
    expect(paged.filter(id => !covered.includes(id))).toEqual([]);
  });
});
