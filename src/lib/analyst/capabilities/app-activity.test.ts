// ── get_app_data: activity.coverage and activity.maps ───────────────────────
//
// Area-level summaries only. The map service answers with routes, coordinates and
// the longest sessions' tracks; none of it may reach the model.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetToDemoDataset } from '../../adapters/dataset';
import type { CoverageRequest } from '../../activity-maps/service';
import { addDays } from '../../analytics/windows';
import { installBodyDataset } from './app.fake';
import { allReaders } from './app-state.fake';
import { appCtxWith } from './app-ctx.fake';
import { coverageOf, HOST, LAT, LON, MAPS } from './app-status.fake';
import type { Envelope } from './envelope';
import { capabilityById } from './registry';
import { expectClean } from './test-context.fake';
import { REF } from './test-dataset.fake';
import type { CapabilityContext } from './types';

beforeEach(() => void installBodyDataset());
afterEach(() => resetToDemoDataset());

const read = (id: string, args: Record<string, unknown> = {}, ctx: CapabilityContext = appCtxWith()): Promise<Envelope<unknown>> => capabilityById(id)!.read(args, ctx);
const data = (env: Envelope<unknown>) => env.data as Record<string, any>;
const FORBIDDEN_KEYS = /"(lat|lon|lng|coordinates|coords|points|polyline|lines|bbox|south|west|north|east)"/i;

describe('activity.coverage', () => {
  it('asks the map service for each saved area over the window, with that area\'s own filter', async () => {
    const asked: CoverageRequest[] = [];
    const ctx = appCtxWith(allReaders({ coverage: async req => (asked.push(req), coverageOf()) }));
    await read('activity.coverage', {}, ctx);
    expect(asked).toHaveLength(2);
    expect(asked[0]).toMatchObject({ bbox: MAPS[0].bbox, types: ['Running'], span: { fromKey: addDays(REF, -29), toKey: REF }, metric: 'frequency' });
    expect(asked[1].types).toBeNull();
    await read('activity.coverage', { window: { month: '2026-08' } }, ctx);
    expect(asked[2].span).toEqual({ fromKey: '2026-08-01', toKey: '2026-08-31' });
  });

  it('summarises each area in display strings: distance, time, new ground, by type', async () => {
    const env = await read('activity.coverage');
    expectClean(env);
    expect(env.window).toMatchObject({ start: addDays(REF, -29), end: REF });
    const areas = data(env).areas as Record<string, any>[];
    expect(areas.map(a => a.area)).toEqual(['Home loop', 'Lake trail']);
    expect(areas[0]).toMatchObject({ workouts: 7, distance: '52.0 km', time: '4:00', newGround: '20 % of the ground covered is new', display: { workouts: '7 workouts' } });
    expect(areas[0].byType[0]).toMatchObject({ type: 'Running', workouts: 5, distance: '40.0 km' });
  });

  it('says an area had no workouts instead of a zero distance', async () => {
    const env = await read('activity.coverage');
    const empty = (data(env).areas as Record<string, any>[])[1];
    expect(empty).toMatchObject({ area: 'Lake trail', display: 'No workouts in this area in the window.' });
    expect(empty).not.toHaveProperty('distance');
    expect(JSON.stringify(empty)).not.toMatch(/\b0(\.0)? (km|mi)\b/);
  });

  it('carries no coordinate, route, bounding box or polyline', async () => {
    const text = JSON.stringify(await read('activity.coverage'));
    expect(text).not.toMatch(FORBIDDEN_KEYS);
    for (const digits of [String(LAT).slice(0, 6), String(Math.abs(LON)).slice(0, 6), String(MAPS[0].bbox.south), String(MAPS[0].bbox.west)]) expect(text).not.toContain(digits);
  });

  it('keeps the areas it could read when one cannot be read, scrubbed', async () => {
    const ctx = appCtxWith(allReaders({ coverage: async req => (req.bbox.south === MAPS[0].bbox.south ? coverageOf() : coverageOf({ available: false, reason: `The routes could not be read from https://${HOST}/x` })) }));
    const env = await read('activity.coverage', {}, ctx);
    expect(env.status).toBe('ok');
    const areas = data(env).areas as Record<string, any>[];
    expect(areas[1]).toMatchObject({ area: 'Lake trail', unreadable: expect.stringContaining('could not be read') });
    expect(JSON.stringify(env)).not.toContain(HOST);
  });

  it('is unavailable when no area can be read, or when the map service throws', async () => {
    const none = await read('activity.coverage', {}, appCtxWith(allReaders({ coverage: async () => coverageOf({ available: false, reason: 'down' }) })));
    expect(none.status).toBe('source_unavailable');
    const boom = await read('activity.coverage', {}, appCtxWith(allReaders({ coverage: async () => { throw new Error(`boom at ${HOST}`); } })));
    expect(boom.status).toBe('source_unavailable');
    expect(JSON.stringify(boom)).not.toContain(HOST);
  });

  it('says so when no area is saved, and is unavailable without a store', async () => {
    const nothing = await read('activity.coverage', {}, appCtxWith(allReaders({ maps: async () => [] })));
    expect(nothing).toMatchObject({ status: 'no_data_in_window' });
    expect(nothing.next).toMatch(/No map areas are saved/);
    const ctx = appCtxWith(allReaders({ maps: async () => null, databaseConfigured: () => false }));
    expect((await read('activity.coverage', {}, ctx)).status).toBe('source_unavailable');
    expect(await capabilityById('activity.coverage')!.coverage(ctx)).toMatchObject({ kind: 'unavailable' });
  });

  it('refuses a bad window', async () => {
    expect((await read('activity.coverage', { window: { lastDays: 0 } })).status).toBe('invalid_args');
  });
});

describe('activity.maps', () => {
  it('lists each saved area by name and size only', async () => {
    const env = await read('activity.maps');
    expectClean(env);
    const maps = data(env).maps as Record<string, any>[];
    expect(maps.map(m => m.name)).toEqual(['Home loop', 'Lake trail']);
    expect(maps[0].size).toMatch(/^about \d+(\.\d)? (km|mi) by \d+(\.\d)? (km|mi)$/);
    const text = JSON.stringify(env);
    expect(text).not.toMatch(FORBIDDEN_KEYS);
    expect(text).not.toContain(String(MAPS[0].bbox.south));
    for (const key of ['id', 'settings', 'basemap', 'revision', 'updatedAt']) expect(text).not.toContain(`"${key}"`);
  });

  it('sizes in the reader\'s units', async () => {
    const env = await read('activity.maps', {}, appCtxWith(allReaders(), { system: 'imperial' }));
    expect((data(env).maps as { size: string }[])[0].size).toMatch(/ mi by .* mi$/);
  });

  it('says so when none are saved, and is unavailable without a store', async () => {
    expect((await read('activity.maps', {}, appCtxWith(allReaders({ maps: async () => [] })))).next).toMatch(/No map areas are saved/);
    expect((await read('activity.maps', {}, appCtxWith(allReaders({ maps: async () => null, databaseConfigured: () => false })))).status).toBe('source_unavailable');
  });
});
