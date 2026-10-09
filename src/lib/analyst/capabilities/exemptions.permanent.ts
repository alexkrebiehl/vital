// ── Permanent exemptions: the analyst does not need these ─
//
// design §10.3, plus the dataset helpers that sit beneath a registered accessor.

import type { Exemption } from './exemptions';

const route = (key: string, reason: string): Exemption => ({ kind: 'route', key, reason });
const page = (key: string, reason: string): Exemption => ({ kind: 'page', key, reason });
const accessor = (key: string, reason: string): Exemption => ({ kind: 'accessor', key, reason });

const SOURCES = 'Connection and credential state; the analyst gets the app.pipeline capability for source status instead.';
const SELF = 'The analyst itself; reading its own conversations is out of scope (design §15).';
const HELPER = 'A helper beneath seriesFor, which is the registered way to read a metric; it is not a data capability of its own.';

export const PERMANENT_EXEMPTIONS: readonly Exemption[] = [
  route('GET /api/health', 'Readiness probe; it carries no data.'),
  route('GET /api/map-providers', 'Map tile configuration, not health data.'),
  route('GET /api/geocode', 'Forwards a query to a third-party geocoder; it would send model-written text there.'),
  route('GET /api/lab/delete-impact', 'Administrative preview of what a delete would remove; not data about the person.'),
  route('GET /api/sources/hae', SOURCES),
  route('GET /api/sources/hevy', SOURCES),
  route('GET /api/sources/oura', SOURCES),
  route('GET /api/sources/oura/app', SOURCES),
  route('GET /api/sources/oura/authorize', SOURCES),
  route('GET /api/sources/oura/callback', SOURCES),
  route('GET /api/analyst', SELF),
  route('GET /api/analyst/stream', SELF),
  route('GET /api/analyst/conversations', SELF),
  route('GET /api/analyst/conversations/[id]', SELF),

  page('/settings', 'Configuration and credentials; the analyst reads source status through app.pipeline instead.'),
  page('/themes', 'Appearance settings; no data about the person.'),
  page('/analyst', 'The analyst page itself; the analyst does not read its own screen.'),

  accessor('setActiveDataset', 'Installs a dataset for the process; it mutates, and the analyst is read-only.'),
  accessor('resetToDemoDataset', 'Replaces the installed dataset with the demo; it mutates, and the analyst is read-only.'),
  accessor('datasetMeta', 'Describes which dataset is installed (mode, reference date); every capability reads the installed one.'),
  accessor('dataMode', 'Reports demo or live; plumbing, not a health measurement.'),
  accessor('isLiveMode', 'Reports demo or live; plumbing, not a health measurement.'),
  accessor('activeDataset', 'The raw installed dataset; capabilities read it through the typed accessors, never whole.'),
  accessor('getFixtures', 'The raw installed dataset; capabilities read it through the typed accessors, never whole.'),
  accessor('canonicalDayKey', 'Date helper (a timestamp to its calendar day); no data of its own.'),
  accessor('isAccumulating', 'Predicate over a metric definition; no data of its own.'),
  accessor('excludePartialForSum', 'Drops the in-progress day before a sum; a rule applied inside the readers, not a reader.'),
  accessor('latestPoint', 'Picks the last point of a series already read; no data of its own.'),
  accessor('pointOn', 'Picks one day of a series already read; no data of its own.'),
  accessor('hasSleepStages', 'Predicate over a sleep night already read; no data of its own.'),
  accessor('metaFor', 'Looks up a metric definition (name, unit); the registry already carries it.'),
  accessor('metricSeries', HELPER),
  accessor('bloodOxygenSeries', HELPER),
  accessor('seriesInWindow', HELPER),
  accessor('metricObservationCount', HELPER),
  accessor('metricObservationsInWindow', HELPER),
];
