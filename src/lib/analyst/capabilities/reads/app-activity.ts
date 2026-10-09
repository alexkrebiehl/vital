// ── activity.coverage and activity.maps (SERVER ONLY) ────────────────────────
//
// Where the workouts went, by saved area. The map service answers with every route
// as a list of coordinates; only the totals survive here: workouts, distance and time
// per area, how much of the ground was new, and the same by activity type. A
// coordinate, a bounding box and a track never leave this file.

import type { CoverageResponse } from '../../../activity-maps/service';
import type { ActivityMap, BBox } from '../../../activity-maps/types';
import { M_PER_DEG_LAT } from '../../../activity-maps/types';
import { formatDurationHm, formatMetricWithUnit } from '../../../metrics/format';
import { manifestEntry } from '../manifest';
import { ok, sourceUnavailable } from '../envelope';
import { scrubForModel } from '../../scrub';
import type { CapabilityContext, Coverage } from '../types';
import { asWindow, guarded, problemsOf, windowOf, type Args, type Read } from './common';
import { clean, nothing, NO_DATABASE } from './app-common';
import { countOf } from './app-format';
import { readersOf } from './app-readers';

export const COVERAGE_DEFAULT_DAYS = 30;
const NO_MAPS = 'No map areas are saved, so there is no area-level coverage to report.';

const distance = (metres: number, ctx: CapabilityContext): string => formatMetricWithUnit('distance_walking_running', metres / 1000, ctx.system);

function areaRow(map: ActivityMap, r: CoverageResponse, ctx: CapabilityContext) {
  const totals = r.highlights?.totals;
  if (!r.available || !totals) return { area: map.name, unreadable: scrubForModel(r.reason ?? 'The routes could not be read.') };
  if (totals.workouts === 0) return { area: map.name, display: 'No workouts in this area in the window.' };
  const ground = r.highlights!.coverage;
  return clean({
    area: map.name,
    workouts: totals.workouts,
    distance: distance(totals.distanceM, ctx),
    time: formatDurationHm(totals.seconds / 60),
    newGround: ground.uniqueDistanceM > 0 ? `${Math.round((ground.newDistanceM / ground.uniqueDistanceM) * 100)} % of the ground covered is new` : undefined,
    byType: totals.byType.map(t => ({ type: t.type, workouts: t.workouts, distance: distance(t.distanceM, ctx), time: formatDurationHm(t.seconds / 60), display: { workouts: countOf(t.workouts, 'workout') } })),
    note: r.unreadWorkouts > 0 ? `${countOf(r.unreadWorkouts, 'workout')} could not be read, so the totals leave them out.` : undefined,
    display: { workouts: countOf(totals.workouts, 'workout') },
  });
}

export async function readActivityCoverage(args: Args, ctx: CapabilityContext): Promise<Read> {
  const entry = manifestEntry('activity.coverage');
  return guarded(entry, ctx, async () => {
    const w = windowOf(args, ctx, COVERAGE_DEFAULT_DAYS);
    if (!w.ok) return problemsOf(entry, w.problems);
    const readers = readersOf(ctx);
    const maps = await readers.maps(ctx.env);
    if (maps === null) return sourceUnavailable(entry, `${NO_DATABASE} The saved areas live there.`);
    if (maps.length === 0) return nothing(entry, NO_MAPS);
    const span = { fromKey: w.window.start, toKey: w.window.end };
    const answers = await Promise.all(
      maps.map(async map => {
        try {
          return await readers.coverage({ bbox: map.bbox, types: map.settings.activityTypes, range: 'all', span, metric: 'frequency' });
        } catch (error) {
          return { available: false, reason: error instanceof Error ? error.message : 'The routes could not be read.', unreadWorkouts: 0, referenceKey: null, range: null, mode: null } as CoverageResponse;
        }
      })
    );
    if (answers.every(a => !a.available)) return sourceUnavailable(entry, answers[0].reason ?? 'The workout routes could not be read.');
    return ok(entry, { areas: maps.map((map, i) => areaRow(map, answers[i], ctx)) }, { window: asWindow(w.window) });
  });
}

/** An area's width and height in kilometres, to the nearest tenth: a size, not a place. */
function sizeKm(b: BBox): { w: number; h: number } {
  const km = M_PER_DEG_LAT / 1000;
  const midLat = ((b.north + b.south) / 2) * (Math.PI / 180);
  return { w: Math.abs(b.east - b.west) * km * Math.cos(midLat), h: Math.abs(b.north - b.south) * km };
}

export async function mapsCoverage(ctx: CapabilityContext): Promise<Coverage> {
  try {
    const maps = await readersOf(ctx).maps(ctx.env);
    return maps === null ? { kind: 'unavailable', reason: NO_DATABASE } : { kind: 'known', first: null, last: null, count: maps.length, unit: 'saved map areas' };
  } catch (error) {
    return { kind: 'unavailable', reason: scrubForModel(error instanceof Error ? error.message : 'The saved areas could not be read.') };
  }
}

export async function readActivityMaps(_args: Args, ctx: CapabilityContext): Promise<Read> {
  const entry = manifestEntry('activity.maps');
  return guarded(entry, ctx, async () => {
    const maps = await readersOf(ctx).maps(ctx.env);
    if (maps === null) return sourceUnavailable(entry, `${NO_DATABASE} The saved areas live there.`);
    if (maps.length === 0) return nothing(entry, NO_MAPS);
    const fmt = (km: number) => formatMetricWithUnit('distance_walking_running', km, ctx.system);
    return ok(entry, { maps: maps.map(m => ({ name: m.name, size: `about ${fmt(sizeKm(m.bbox).w)} by ${fmt(sizeKm(m.bbox).h)}` })) });
  });
}
