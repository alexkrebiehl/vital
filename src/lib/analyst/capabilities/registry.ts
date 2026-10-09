// ── The capability registry (SERVER ONLY) ───────────────
//
// One entry per manifest entry, in manifest order. The manifest says what exists;
// the area files say how to read it. This module checks they agree when it loads,
// so a capability cannot be added to one and forgotten in the other.

import * as metrics from './areas/metrics';
import * as workouts from './areas/workouts';
import * as sleep from './areas/sleep';
import * as heart from './areas/heart';
import * as labs from './areas/labs';
import * as medications from './areas/medications';
import * as training from './areas/training';
import * as body from './areas/body';
import * as insights from './areas/insights';
import * as activity from './areas/activity';
import * as app from './areas/app';
import { CAPABILITY_MANIFEST } from './manifest';
import { EXAMPLES } from './guide.examples';
import { HOLDS } from './guide.holds';
import type { Capability } from './types';

export type AnyCapability = Capability<Record<string, unknown>, unknown>;

const IMPLEMENTED: readonly AnyCapability[] = [
  metrics.series,
  metrics.relationship,
  workouts.sessions,
  workouts.summary,
  sleep.nights,
  sleep.summary,
  heart.bloodPressure,
  labs.series,
  labs.compare,
  medications.summary,
  medications.doses,
  training.progress,
  training.plan,
  training.sessions,
  training.exerciseTemplates,
  training.referencePlans,
  labs.documents,
  body.goal,
  body.nutritionAdherence,
  insights.current,
  insights.reports,
  activity.coverage,
  activity.maps,
  app.dataQuality,
  app.pipeline,
  app.profile,
  app.preferences,
  app.briefing,
  app.dashboard,
  training.workoutTemplate,
];

/** Every capability, in manifest order. */
export const CAPABILITIES: readonly AnyCapability[] = CAPABILITY_MANIFEST.map(entry => {
  const cap = IMPLEMENTED.find(c => c.id === entry.id);
  if (!cap) throw new Error(`Capability "${entry.id}" is in the manifest but has no area implementation.`);
  // The words the model reads about it, written once beside the registry (guide.*.ts).
  return { ...cap, holds: HOLDS[cap.id], examples: EXAMPLES[cap.id] };
});

if (IMPLEMENTED.length !== CAPABILITIES.length) {
  throw new Error(`Capabilities without a manifest entry: ${IMPLEMENTED.filter(c => !CAPABILITY_MANIFEST.some(e => e.id === c.id)).map(c => c.id).join(', ')}.`);
}

export function capabilityById(id: string): AnyCapability | undefined {
  return CAPABILITIES.find(c => c.id === id);
}

/** The capabilities a tool serves (a tool may serve several). */
export function capabilitiesForTool(tool: string): AnyCapability[] {
  return CAPABILITIES.filter(c => c.tool === tool);
}
