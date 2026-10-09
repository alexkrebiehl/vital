// ── app.data_quality (SERVER ONLY) ───────────────────────────────────────────
//
// The findings the Settings panel shows, from the one function the quality route
// calls: what was found, which metrics and days, and how to fix it, with the findings
// the reader silenced marked. The findings' own words may name the data source; they
// are written for the reader, so the name is replaced here (only app.pipeline names a
// source, design §9.1).

import type { QualityFinding } from '../../../adapters/quality';
import type { SilencedFinding } from '../../../adapters/quality-silenced';
import { getMetric } from '../../../metrics/registry';
import { scrubForModel } from '../../scrub';
import { manifestEntry } from '../manifest';
import { ok, sourceUnavailable } from '../envelope';
import type { CapabilityContext } from '../types';
import { guarded, type Args, type Read } from './common';
import { clean } from './app-common';
import { countOf } from './app-format';
import { neutralSourceNames } from './app-names';
import { readersOf } from './app-readers';

/** Text the model reads: scrubbed of addresses and credentials, and free of source names. */
const say = (text: string, max = 400): string => scrubForModel(neutralSourceNames(text), max);
const metricName = (id: string): string => getMetric(id)?.displayName ?? id;

function findingRow(f: QualityFinding) {
  return clean({
    silenced: false,
    severity: f.severity,
    title: say(f.title),
    what: say(f.detail),
    metrics: f.metrics.length ? f.metrics.map(metricName) : undefined,
    days: countOf(f.affectedDays, 'day'),
    ranges: f.ranges.length ? f.ranges.map(r => `${r.from} to ${r.to}`) : undefined,
    fix: f.remedy.map(step => say(step)),
  });
}

function silencedRow(s: SilencedFinding) {
  return clean({
    silenced: true,
    severity: s.severity ?? undefined,
    title: say(s.title),
    metrics: s.metricLabel ? [s.metricLabel] : undefined,
    firstDay: s.firstDay ?? undefined,
    lastDay: s.lastDay ?? undefined,
  });
}

export function readDataQuality(_args: Args, ctx: CapabilityContext): Promise<Read> {
  const entry = manifestEntry('app.data_quality');
  return guarded(entry, ctx, async () => {
    const answer = await readersOf(ctx).quality(ctx.env);
    if (answer.state !== 'ready' || !answer.quality) {
      const why = answer.state === 'computing' ? 'The data-quality checks are still running.' : answer.detail ? say(answer.detail, 200) : 'The data-quality checks have not run.';
      return sourceUnavailable(entry, why);
    }
    const { checks, findings } = answer.quality;
    const hidden = answer.silenced.filter(s => s.found);
    const flagged = checks.filter(c => c.outcome === 'flagged').length;
    const summary = flagged === 0 && hidden.length === 0 ? `All ${checks.length} checks passed.` : `${flagged} of ${checks.length} checks flagged something${hidden.length ? `; ${countOf(hidden.length, 'finding')} silenced by the reader` : ''}.`;
    return ok(entry, {
      summary,
      checks: checks.map(c => ({ check: say(c.label), outcome: c.outcome, summary: say(c.summary) })),
      findings: [...findings.map(findingRow), ...hidden.map(silencedRow)],
    });
  });
}
