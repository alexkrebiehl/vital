// ── What the answer view says while a tool runs ─────────────────────────────
//
// Every health-data tool's line comes from the capability manifest; a plan tool keeps its
// derived words; a name the app no longer offers (a retired tool in a stored conversation,
// or one a model invented) gets the same derived words and never breaks the view.

import { describe, expect, it } from 'vitest';
import { DATA_TOOL_LABELS } from '@/lib/analyst/capabilities/manifest';
import { toolStatus } from './AnswerView';

describe('toolStatus', () => {
  it('is the manifest\'s status line for every data tool', () => {
    for (const [tool, label] of Object.entries(DATA_TOOL_LABELS)) expect(toolStatus(tool), tool).toBe(label);
    expect(toolStatus('get_metric_series')).toBe('Looking up your metric series…');
    expect(toolStatus('list_capabilities')).toBe('Checking what the app holds…');
  });

  it('keeps the plan-tool fallback text', () => {
    expect(toolStatus('get_routine_progress')).toBe('Using the plan tool: get routine progress…');
    expect(toolStatus('get_training_sessions')).toBe('Using the plan tool: get training sessions…');
  });

  it('reads a retired tool name as words, as the stored "Tools used" line does', () => {
    expect(toolStatus('get_metrics')).toBe('Using the plan tool: get metrics…');
    expect(toolStatus('compare_periods')).toBe('Using the plan tool: compare periods…');
  });
});
