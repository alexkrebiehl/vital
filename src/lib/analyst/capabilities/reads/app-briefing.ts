// ── app.briefing and app.dashboard (SERVER ONLY) ─────────────────────────────
//
// Today's briefing as already written (design: the AI-connection contract). The read
// looks at the cache for the question's own profile, goal and unit system, the same key
// the Overview uses, and never starts, regenerates or warms one. The dashboard: which
// metric and which dates each card shows, and no value.

import type { BriefingView } from '../../../briefing/types';
import type { CardRecord, DateSpec } from '../../../dashboard/types';
import { getMetric } from '../../../metrics/registry';
import { scrubForModel } from '../../scrub';
import { manifestEntry } from '../manifest';
import { ok, sourceUnavailable } from '../envelope';
import type { CapabilityContext } from '../types';
import { guarded, type Args, type Read } from './common';
import { clean, nothing, NO_DATABASE } from './app-common';
import { readersOf } from './app-readers';

function briefingRow(v: BriefingView) {
  // Provider, destination, engine detail, latency and the number audit are bookkeeping about the model, not the briefing.
  return clean({
    kind: v.kind,
    headline: v.headline,
    body: v.body,
    recommendations: v.recommendations.length ? v.recommendations : undefined,
    attribution: v.attribution,
    coversDay: v.coversDay,
    writtenAt: v.generatedAt,
    dataAsOf: v.asOf,
  });
}

export function readBriefingCapability(_args: Args, ctx: CapabilityContext): Promise<Read> {
  const entry = manifestEntry('app.briefing');
  return guarded(entry, ctx, async () => {
    const readers = readersOf(ctx);
    const profile = await readers.profile(ctx.env);
    // Another profile would be another day boundary, so another key: do not look under a guessed one.
    if (profile.error) return sourceUnavailable(entry, scrubForModel(profile.error));
    const bodyGoal = await readers.activeGoal(ctx.env);
    const view = readers.briefing({ system: ctx.system, profile: profile.profile, bodyGoal });
    return view ? ok(entry, briefingRow(view)) : nothing(entry, 'No briefing has been written today yet.');
  });
}

function dateText(date: DateSpec): string {
  return date.kind === 'range' ? `${date.start} to ${date.end}` : date.kind;
}

function cardRow(card: CardRecord) {
  const spec = card.spec as { metricId?: unknown; date?: DateSpec } | null;
  if (card.status !== 'ok' || !spec || typeof spec.metricId !== 'string' || !spec.date) return { type: card.type, status: 'unreadable' };
  return clean({ type: card.type, metric: getMetric(spec.metricId)?.displayName, metricId: spec.metricId, date: dateText(spec.date) });
}

export function readDashboard(_args: Args, ctx: CapabilityContext): Promise<Read> {
  const entry = manifestEntry('app.dashboard');
  return guarded(entry, ctx, async () => {
    const dash = await readersOf(ctx).dashboard(ctx.env);
    if (dash === null) return sourceUnavailable(entry, `${NO_DATABASE} The cards are stored there.`);
    if (dash.cards.length === 0) return nothing(entry, 'No dashboard cards are set up.');
    return ok(entry, { cards: dash.cards.map(cardRow) });
  });
}
