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
import { CAPABILITY_MANIFEST } from './manifest';
import type { Capability } from './types';

export type AnyCapability = Capability<Record<string, unknown>, unknown>;

const BY_ID = new Map<string, AnyCapability>(
  [
    metrics.summary,
    metrics.compare,
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
  ].map(c => [c.id, c])
);

/** Every capability, in manifest order. */
export const CAPABILITIES: readonly AnyCapability[] = CAPABILITY_MANIFEST.map(entry => {
  const cap = BY_ID.get(entry.id);
  if (!cap) throw new Error(`Capability "${entry.id}" is in the manifest but has no area implementation.`);
  return cap;
});

if (BY_ID.size !== CAPABILITIES.length) {
  throw new Error(`Capabilities without a manifest entry: ${[...BY_ID.keys()].filter(id => !CAPABILITY_MANIFEST.some(e => e.id === id)).join(', ')}.`);
}

export function capabilityById(id: string): AnyCapability | undefined {
  return CAPABILITIES.find(c => c.id === id);
}

/** The capabilities a tool serves (a tool may serve several). */
export function capabilitiesForTool(tool: string): AnyCapability[] {
  return CAPABILITIES.filter(c => c.tool === tool);
}
