// ── app.profile and app.preferences (SERVER ONLY) ────────────────────────────
//
// The profile as context for reading the numbers: age, sex, timezone and the notes the
// owner wrote for exactly this. Never the name, the date of birth (only the age it
// makes), the briefing hour or where the profile is stored. Preferences: the unit
// system and nothing else.

import { ageInYears } from '../../../profile/types';
import { scrubForModel } from '../../scrub';
import { manifestEntry } from '../manifest';
import { ok, sourceUnavailable } from '../envelope';
import type { CapabilityContext } from '../types';
import { guarded, type Args, type Read } from './common';
import { clean, nothing } from './app-common';
import { readersOf } from './app-readers';

export function readProfileCapability(_args: Args, ctx: CapabilityContext): Promise<Read> {
  const entry = manifestEntry('app.profile');
  return guarded(entry, ctx, async () => {
    const state = await readersOf(ctx).profile(ctx.env);
    // A profile that could not be read is not an empty one: the defaults would read as "nothing set".
    if (state.error) return sourceUnavailable(entry, scrubForModel(state.error));
    if (!state.stored) return nothing(entry, 'No profile details have been saved yet.');
    const p = state.profile;
    // The age on the question's own day, from the date of birth, which is not sent.
    const age = ageInYears(p.dateOfBirth, new Date(`${ctx.refKey}T12:00:00Z`));
    return ok(entry, clean({
      ageYears: age ?? undefined,
      sex: p.sex,
      timezone: p.timezone,
      notes: p.notes?.trim() || undefined,
      display: age === null ? undefined : { ageYears: `${age} years` },
    }));
  });
}

export function readPreferencesCapability(_args: Args, ctx: CapabilityContext): Promise<Read> {
  const entry = manifestEntry('app.preferences');
  return guarded(entry, ctx, async () => {
    const state = await readersOf(ctx).preferences(ctx.env);
    if (state.error) return sourceUnavailable(entry, scrubForModel(state.error));
    return ok(entry, { units: state.preferences.units });
  });
}
