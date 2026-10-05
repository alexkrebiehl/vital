# Data sources, modes and integrations

Where Vital reads your health and workout data from, how demo and live modes differ, and how the adapters are laid out.

[← Back to the README](../README.md)

> **Trademarks.** Health Auto Export, Apple Health, Hevy and every other source named here are
> trademarks of their respective owners and are mentioned only to describe compatibility. Vital is not
> affiliated with or endorsed by any of them, and this applies equally to sources added later. See
> [Trademarks and affiliations](../README.md#trademarks-and-affiliations).

---

# Data sources

**Vital supports exactly one health-data source today: Apple Health, via the Health Auto Export app for
iPhone, paired with a self-hosted metrics API server —
[HealthyApps/health-auto-export-server](https://github.com/HealthyApps/health-auto-export-server).**

The chain has three links, and Vital implements only the last one:

| Link | What it is | Provided by |
|------|-----------|-------------|
| iPhone | Apple Health records exported by the **Health Auto Export** app for iOS, on a schedule or on change | You (the app) |
| Metrics API server | [`HealthyApps/health-auto-export-server`](https://github.com/HealthyApps/health-auto-export-server) — a Node.js server that receives those exports, stores them, and exposes `GET /api/metrics/:metric` and `GET /api/workouts` | **Required** — paired with the app; it is the only thing Vital can read |
| Vital | Reads that server **server-side**, normalizes it into the internal dataset | This repository |

What that means in practice:

- **The metrics API server is not optional.** Apple Health has no public cloud API, a web app
  cannot read HealthKit, and the phone cannot be queried directly. Point `HAE_API_URL` at your
  `health-auto-export-server` instance and set `HAE_API_KEY` to its token, or run in `demo` mode.
- **No other source is supported, partially or otherwise.** There is no direct HealthKit or iCloud
  bridge; no Google Fit, Android or Samsung Health; no Garmin, Fitbit, Withings or Oura; no Apple
  Health `export.xml` upload and no CSV/JSON import. The adapter layer knows one wire protocol, and
  the pipeline panel lists only the stages this build can actually check.
- **Demo mode is not a source.** `VITAL_DATA_MODE=demo` serves the committed fixtures
  (`src/data/health-fixtures.json`) and is labelled as demo; it connects to nothing.
- **Adding a source means implementing its contract** under `src/lib/adapters/` (see
  *Integrations*): a module that knows the wire protocol, a mapping into the internal dataset
  shape, and a unit mapping. Nothing else in the app changes, because both modes produce the same
  dataset.

## Setting up Health Auto Export for complete data

Vital can only show what reaches the metrics server, and the server stores exactly what the app
sends it. Most "missing data" is a setup problem on the phone, not in Vital. These settings keep
the history complete and stop it from being counted twice. The app's menus change between
versions, so the setting names below describe what to look for rather than quote the app.

1. **Send everything to one server: the one Vital reads.** Every automation and every manual
   export should post to the same `…/api/data` URL that Vital's `HAE_API_URL` points at, with the
   server's write token in the `api-key` header. With a second server in the picture (an old
   local one, a test copy), the phone can export to one while Vital reads the other. The data is
   then "missing" in Vital even though the app reported success.
2. **Use the REST API automation, JSON format, and select every metric you want to see.**
   Nutrition (dietary energy, protein, carbohydrates, total fat, fiber and the rest) is a
   separate group of metrics in the app. If it isn't selected, the Nutrition page and the body
   goal's energy balance stay empty however long you log food.
3. **Choose one time grouping and keep it: 1 hour is recommended.** The app can send every
   individual sample or totals per minute, hour or day. Vital works with any of them, but the
   server merges two records only when their timestamp and source match exactly. Data re-sent
   at a different grouping is stored *beside* what is already there. Vital then adds both
   together, so steps, active and basal energy, distance and calories count twice on every day
   where the two overlap. Hourly totals are a good default for three reasons:
   - The payloads stay small.
   - Health has already counted steps that the iPhone and the Watch recorded at the same time
     once.
   - Food logged at a meal time lines up with the hour.
4. **Re-send a few recent days on every sync, not only what is new.** A food entry back-dated or
   edited after its day was synced never reaches the server if each sync sends only what is new
   since the last one. Re-sending a trailing window (the last several days) is safe at the same
   time grouping, because the server updates matching records instead of adding them.
5. **Backfill the history once, with the phone unlocked.** A new automation only sends from now
   on. Run a manual export over your whole history, at the **same time grouping** as the
   automation. iOS blocks apps from reading Health data while the phone is locked, so keep the
   app open until the export finishes. Split very long ranges into months.
6. **Check that the data arrived; the app's success message is not proof.** The server answers
   "N metrics saved successfully", where N is the number of metric *types* in the upload, not
   records. An upload whose metrics carry no data gets the same answer. Afterwards, open
   **Settings → Data & coverage** in Vital and check that the days you expect are covered. You
   can also ask the server directly:
   `GET /api/metrics/step_count?from=2026-06-01&to=2026-06-30` with the read token.

**Settings → Connections → Data pipeline** runs these checks for you under **Data quality**. They
run in the background after each load of the live data, so no page waits for them; the panel
shows that they are running until the result is ready. It reads the records as the server stores them, before they are
added up per day. Each finding explains what it found, lists the affected days, and gives the
steps that fix it:

| Check | What it flags |
|---|---|
| Overlapping exports | Hourly totals stored beside the finer records they already contain, so daily sums count that activity twice (step 3) |
| Duplicate readings | A weigh-in or similar reading stored again as an on-the-hour copy |
| Missing days | Steps, energy or distance absent on days the watch recorded heart rate or other activity (steps 2 and 5) |
| History that starts late | A metric, usually food, that begins long after the rest of the history (step 5) |
| New data arriving | Nothing new from the watch for 36 hours: the automation has stopped, or posts elsewhere (step 1) |

A finding whose affected days are all more than 90 days old is shown as a **note**, not a
problem: recent figures (the trends, baselines and body goal) are not affected, and fixing it
only completes the older history. The checks only report; they never change the data.

### If the data already mixes groupings

The symptom is daily steps, active energy or basal energy at roughly double the usual on some
days, usually right after a manual export at a different time grouping. To repair it:

1. **Back up the server's database first.** For the reference server this is
   `mongodump --db health-auto-export --gzip --archive=…`.
2. **Remove the finer records that the coarser totals already contain.** For each summed metric
   and each hour that has an hourly total, delete the other records inside that hour.
3. **Remove duplicate readings.** For weight, heart rate and other readings, delete the copies
   that the export added beside the original readings.

After that, keep to step 3 above.

## Workout sources (detailed training data)

Apple Health knows a strength session only as "Strength Training" with a duration and calories.
A **workout source** reads a training app's own API for what was actually done — exercises,
sets, reps, load, duration, distance and RPE — which the training routine on `/workouts` needs.
Sources are plugins under `src/lib/workout-sources/<id>/`, registered in `registry.ts`; each
normalizes into the shared `TrainingSession` model, so nothing downstream knows which app a
session came from.

**Hevy** is the first source (Hevy Pro; create a key at hevy.com/settings?developer):

```bash
# .env
HEVY_API_KEY=your-hevy-api-key
# HEVY_CACHE_TTL_SECONDS=300       # how long synced sessions are served before a refresh
# WORKOUT_SOURCE_LOOKBACK_DAYS=400 # how far back the first sync reads
```

The first sync pages `GET /v1/workouts` back to the lookback window and reads the exercise
catalogue once; later syncs read only Hevy's change feed (`GET /v1/workouts/events?since=`).
Like the Health Auto Export history, sessions live in server memory and are **never written to
the database**; demo mode serves committed demo sessions (`src/data/training-fixtures.json`)
and calls nothing. Settings → Connections shows each source's status.

## Workout routes (Activity → Maps)

Health Auto Export's workout list carries no GPS, so the maps read each workout's route and heart
rate from `GET /api/workouts/:id?include=route,heartRateData` — **once per workout**:

- The route is packed into typed arrays (about 13 bytes a point) and held in server memory, keyed
  by workout id and end time, so a re-exported session is read again and an unchanged one never
  is. A workout without a route (a strength session) is remembered as having none. Nothing is
  written to the database or to disk, and no coordinate is logged.
- At most four reads run at once across the process. The first visit to the Maps page after a
  restart reads every workout in the 400-day window (a few seconds for a few hundred workouts);
  after that, changing a map's filters is answered from memory.
- `ROUTE_CACHE_MAX_POINTS` (default `3000000`, about 40 MB) caps the points held; beyond it the
  least recently used routes are dropped and read again when next needed.
- Heart rate is interpolated linearly in time onto each route point (HR arrives about once a
  minute against a point a second) and held, not extrapolated, past the last sample. A point with
  no reading is drawn as "no reading", never as resting.
- A workout whose route could not be read is left off the map and counted in a note under it, and
  retried on the next load. If every read fails, the map says the routes are unavailable rather
  than drawing an empty map.

The coverage itself is computed per request: route points are snapped to a grid sized to the map
(about 1/1000 of its diagonal, 5–50 m), so both sides of a street and both directions of travel
merge into one path with a traversal count, and the paths are dissolved into polylines. Demo mode
draws deterministic synthetic routes around Golden Gate Park for the demo walks, runs and rides,
and reads nothing.

### Map tiles

Each map is drawn on the provider, tile style and light/dark rendering chosen in its edit dialog.
Tiles load from the provider straight into the browser.

| Provider | Styles | Light / dark | Key |
|----------|--------|--------------|-----|
| CARTO | Positron / Dark Matter (with or without labels), Voyager | Light, Dark or Auto (follows your theme); Voyager is light only | `MAP_TILES_CARTO_KEY` ([free for non-commercial use](https://carto.com/basemaps/apikey)) |
| OpenStreetMap | Standard | Light | None |
| OpenTopoMap | Terrain | Light | None |

Every provider can be chosen whether or not its key is set. A map on a provider whose key is
missing still requests its tiles, without the key (the provider may refuse them), and says the key
is missing. Keys are read from the
server environment only; Settings → Connections → Maps shows which providers are ready, never the
key.

---

# Data modes

| Mode | Dataset | How it is read |
|------|---------|----------------|
| `demo` (default) | `src/data/health-fixtures.json` — deterministic, committed, 180 days | Imported in-process; the browser bundle already contains it |
| `live` | The real Health Auto Export history | Fetched and normalized **on the server**, cached in-process with a TTL + single-flight + stale-while-revalidate and warmed once at process start, then injected into the same internal dataset shape |

Switch modes with `VITAL_DATA_MODE` and restart the process: `live` reads the real history,
anything else (including unset, or `VITAL_DATA_MODE=demo`) serves the committed fixtures. In
`live` mode `HAE_API_URL` and `HAE_API_KEY` must both be set, or the app reports the live
source as unavailable instead of falling back. `HAE_CACHE_TTL_SECONDS` (default 300) is the
cache TTL in seconds; it does not control how often a page waits — see below.

Both modes produce the *same* internal dataset, so no page or component has to know which one
it is reading. In live mode:

- **The browser never talks to the health API.** All reads happen in server code, and
  `HAE_API_KEY` is read from the process environment only. The served client bundle contains
  neither the token nor any live health value (verified by grepping `.next/static/chunks`).
- **Every upstream request is windowed** (`from`/`to`, a rolling 400-day lookback) and reduced
  to **one value per day server-side**, so the heavy series (`heart_rate` 32k records,
  `basal_energy_burned` 66k, `active_energy` 39k) never reach a page in raw form.
- **One upstream pass per cache period, and no page waits on it.** `loadLiveDataset()` is
  wrapped in a TTL cache (`HAE_CACHE_TTL_SECONDS`, default 300) with single-flight, so
  concurrent page loads share a single fetch of ~194k upstream records → 1040 daily
  observations across 27 metrics. The cache is also warmed by one **read-only cache fill at
  process start** (`src/instrumentation.ts`), so the first request after a deploy or restart
  normally finds it already filled. Once the TTL lapses the held dataset is served **stale
  immediately** — stale-while-revalidate, single-flight, so N concurrent requests start
  exactly one background refresh — and only a genuinely cold process (no dataset cached at
  all) waits for upstream. Both are read-only cache fills: no ingestion job, no timer and no
  schedule exists, and nothing is persisted to disk.
- **Metric-specific aggregation, not one strategy for everything.** Steps, distance flights,
  exercise minutes, stand hours, active/basal energy, daylight and dietary totals are **summed
  per day**; resting HR, HRV, respiratory rate, SpO₂, wrist temperature and physical effort are
  **averaged per day**; weight, BMI, body fat and lean mass are **latest per day** (individual
  weigh-ins, never presented as daily observations); `heart_rate` is a daily **average** with
  daily max/min computed; `blood_pressure` keeps every reading as a systolic/diastolic pair;
  `sleep_analysis` composes one episode per night.
- **Source de-duplication.** The API returns overlapping device sources and composite values
  (`"Apple Watch|iPhone"`). Vital splits them, keeps **one device per metric per
  interval** using a stated priority (watch → phone, scale for body metrics, cuff for blood
  pressure), and sets the other device's records aside instead of adding them. On the current
  data this sets aside 111 records across 25 intervals; a blind sum would over-count steps by
  ~250/day.
- **A sleep record with no stage split is an in-bed-only record, not a night of zero sleep.**
  Some `sleep_analysis` records carry a valid in-bed window (`inBedStart`/`inBedEnd`) and
  `deep + core + rem == 0`. They are counted as nights, they count towards **time in bed** and
  towards coverage, and they are excluded from **every time-asleep figure** — mean, median, min,
  max, timeline, variability and comparison alike, on the Sleep page, the Overview card, the
  weekly "what changed" row, Insights, Trends and the analyst's context. A genuinely short night
  is still a night; only a record with no stage split drops out, and no split is ever invented
  for one (the stage chart draws it as a single neutral in-bed bar). The counts are stated on
  `/sleep`: *"N nights with a stage split of M records; K records carry only an in-bed window"*.
- **A repeated sleep export is one night.** An episode is identified by its in-bed window plus
  its recorded totals, not by the export `date` (the API has exported the same episode twice
  under two `date` values with an identical window and identical totals). Repeats collapse under
  the same source priority as every other metric; a record that shares a start instant but
  differs in window or totals is kept as a separate episode.
- **Unit conversion once, on the way in**: `lb → kg`, `mi → km`, `degF → degC`,
  `count/min → bpm|breaths/min`, `hr → min`. Round-trips are asserted in `units.test.ts`. The
  unit preference in `/settings` still converts for display only.
- **No silent fallback.** If the source cannot be read, the app renders an explicit connection
  error with retry and never substitutes demo data. The freshness badge shows the real
  data-as-of day derived from the newest observation.

---

# Integrations

**Hevy — implemented (server-side), as a workout source** (see *Workout sources*): `GET
/v1/workouts`, `/v1/workouts/events`, `/v1/exercise_templates` and `/v1/user/info` (probe) with an
`api-key` header, in `src/lib/workout-sources/hevy/`.

**Health Auto Export — implemented (server-side), and the only health-data source.** Apple Health records are
exported by the iOS app and received by a
[`health-auto-export-server`](https://github.com/HealthyApps/health-auto-export-server) instance —
the metrics API server this app requires — and Vital reads them from that server over these
verified contracts:

- `GET /api/metrics/:metric` with an `api-key` header and `from`/`to` ISO query parameters →
  an array of observations. Plain metrics carry `{ date, qty, units, source }`; `heart_rate`
  carries `{ Avg, Max, Min }`; `blood_pressure` carries `{ systolic, diastolic }`;
  `sleep_analysis` carries stage hours plus `inBedStart`/`inBedEnd`.
- `GET /api/workouts?startDate&endDate` → `[{ id, workout_type, start_time, end_time,
  duration_minutes, calories_burned }]`. No distance and no heart rate are provided, so none is
  invented; `duration_minutes` arrives as a long float and is rounded to one decimal.

The implementation lives in `src/lib/adapters/`:

| File | Role |
|------|------|
| `hae.ts` | The only module that knows the wire protocol; sends the token as `api-key`, validates that responses are arrays, and exposes the bounded probe |
| `normalize.ts` | Pure upstream → internal-shape conversion: the metric mapping table, per-strategy daily aggregation, sleep composition, blood-pressure pairing, coverage/provenance |
| `sources.ts` | The source de-duplication rule (composite splitting, device families, priorities) |
| `units.ts` | Canonical unit conversions, round-trip safe |
| `cache.ts` | TTL cache with single-flight and stale-while-revalidate |
| `live.ts` | `LiveHealthDataAdapter` + `loadLiveDataset()` (bounded windows, fetch-once aggregate-server-side) and the boot-time `warmLiveDataset()` cache fill |
| `runtime.ts` | The mode switch used by the layout and the server routes; raises `LiveDataUnavailableError` instead of falling back to demo |

The `ANALYST_*` variables are live configuration: with `ANALYST_PROVIDER=openai` or
`anthropic` a request *is* sent to the endpoint you configure (see *AI Analyst
configuration*); with `demo` nothing leaves the machine. The profile is not configuration at
all: it is the `profile` row in Postgres (`id = 1`, see *The profile*) rather than an
environment variable, and it holds no secret.
