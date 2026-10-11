Implemented in 0.3.2; the user documentation is `docs/analyst.md`.

# AI Analyst: data access for any capability, any time (design)

Status: design for the 0.3.2 line. Gates AN-D1 … AN-D7 implement it, AN-W1 documents it.
Scope: the analyst's read access to everything the app serves. The training-plan write tools,
the answer schema, the medical boundaries and the briefing are unchanged.

Everything below was read from the code at `f4049fe` unless it is marked **(unverified)**.
The baseline suite at that commit: 195 files, 2,624 tests, green in a clean environment.

---

## 1. Root cause: "this selection contains no workout records at all"

### 1.1 The real path, reproduced

The failing turn is stored in `analyst_messages` (assistant role, `status = ok`). Its stored
provenance says exactly what reached the model:

- `handler_id = 'sleep-vs-recovery'`
- retrieval note: *"Selected 2 metric summaries and 1 paired comparison; … The rest of the dataset
  was not sent anywhere. Lab results: … Medication records: … NOT SENT, to fit the size limit: the
  daily series of every metric; half of the lab series. …"*
- retrieval metrics: `sleep_analysis` and `heart_rate_variability`, 90 days.

The question was the built-in suggested prompt **"Are my workouts associated with better sleep?"**.
Step by step:

1. **Mode.** The deployment runs `ANALYST_CONTEXT=full`, `ANALYST_TOOLS=auto` (`full` is also the
   default: `DEFAULT_CONTEXT_MODE` in `src/lib/analyst/config.ts`).
2. **Routing.** `prepareAnalyst` (`service.ts`) calls `selectHandlerStrict(query)` for a configured
   provider. The question *is* the canonical prompt of handler `sleep-vs-recovery`
   (`handlers.ts`), so it routes there instead of to the general selection.
3. **Selection.** `RETRIEVAL_SPECS['sleep-vs-recovery']` (`retrieval.ts`) is sleep 90 d, HRV 90 d
   and a sleep↔HRV pair. **It declares no `workouts`.** The handler is named and prompted as a
   workouts question but computes sleep against HRV. `buildBundle` therefore sets
   `workouts: null`.
4. **Budget.** `fitToBudget` (`budget.ts`) then drops the daily series and half the lab series and
   says so. It never touches workouts: there were none to drop.
5. **Tools.** `answerWithTools` builds `ToolContext` without `data` because `prep.onDemand` is unset
   in `full` mode, so `availableTools(ctx)` (`tools/index.ts`) returns only the twelve plan tools. The
   seven data tools (`DATA_TOOLS`, `tools/data.ts`) are **offered only in `ondemand` mode**.
6. **The model's inputs.** `buildAnalystUserMessage` (`systemPrompt.ts`) sends `context.workouts:
   null`, a `selectionNote` ending "The rest of the dataset was not sent anywhere", and plan tools
   whose only workout reader, `get_training_sessions`, is described as "Logged training sessions
   from the workout sources (e.g. Hevy)", i.e. strength sessions, not the health source's workouts.
   Nothing in the message says workouts exist. The model called no tool (the stored payload records
   `toolsUsed` whenever it is non-empty, `conversation-rules.ts`; this turn has none) and answered
   from what it held.

**Which tool could have saved it.** None that was offered. In `ondemand` mode `get_workouts` would
have returned a roll-up (counts, minutes, types) but still no session, no date and no window. No
tool anywhere returns an individual workout.

### 1.2 The class of failure

The failure is not about workouts. It has four parts, and each one recurs elsewhere:

| # | Defect | Where |
|---|---|---|
| F1 | A data capability exists with no tool, or a tool exists only in the mode that is not deployed | `availableTools`; `DATA_TOOLS` gated on `ctx.data` |
| F2 | A pre-attached selection does not say what it leaves out, so absence-in-selection reads as absence-in-data | `buildBundle` note; `buildContextPayload` has no "not included" list (labs alone have `notIncludedSeries`) |
| F3 | Tools are roll-ups with a trailing `days` window: no record, no date, no arbitrary window | `get_workouts`, `get_medications`, `get_metrics` |
| F4 | Nothing mechanical ties "the app serves X" to "the analyst can reach X" | no registry, no parity test; the handler name/prompt vs. spec mismatch went unnoticed |

### 1.3 Inventory: what the app serves and whether the analyst can reach it today

"Full" is the deployed mode, "ondemand" the other. Routes are `GET` unless stated.

| Capability | Source of truth | API route | Analyst today | Gap |
|---|---|---|---|---|
| Daily series, 40 registered metrics | `seriesFor` (`adapters/dataset.ts`) | none (pages compute) | full: 14 metrics, 30 d (general selection only); ondemand: `get_metrics` (last N days), `compare_periods` | full: 26 metrics unreachable; no arbitrary window except `compare_periods`; no weekly/monthly view |
| Sleep nights: asleep vs in bed, stages, bed/wake | `sleepSeries`, `sleepCoverageSummary` | none (Sleep page) | `sleep_analysis` summary only (minutes asleep) | no night, no stage, no bedtime, no "deepest nights" |
| Blood pressure readings (pairs) | `bloodPressureSeries`, `bloodPressureStats` | none (Health page) | refused (`PAIRED_REASON`) | entirely unreachable |
| Health-source workouts (each session) | `workoutList` / `workoutViews` / `filterWorkouts` | none (Workouts pages) | full: 30 d roll-up in the general selection only; ondemand: `get_workouts` roll-up | **no session, no date, no type filter, no HR/distance**: the reported failure |
| Strength sessions (exercises, sets) | `loadTrainingData` (`workout-sources/store.ts`) | `workout-sources/sessions`, `workout-sources/match` | `get_training_sessions` (≤365 d back, cap 40, silent) | no explicit window; truncation unmarked; not joined to the matching health workout |
| Exercise catalogue | `loadExerciseTemplates` | none | `search_exercise_templates` | none |
| Training plan, progress, path and workout-template detail | `routine/service.ts` | `routine`, `routine/[pathId]`, `routine/workouts/[templateId]` | `get_routine_progress`, `get_training_plan` | template detail (`workoutDetailFrom`) unreachable |
| Lab results (series, history, intervals, status) | lab store via `loadLabSource` | `lab/summary` | full: capped lab block; ondemand: `get_lab_results`, `compare_lab_panels` | no date-window filter |
| Lab documents (dates, lab name, row counts) | `listReports` (`db/lab-store.ts`) | `lab/reports`, `lab/reports/[id]` | none | "when was my last panel / which lab" unanswerable outside the index |
| Medication dose events | `loadMedications` (`adapters/medications.ts`), upstream | `medications` | full: 30 d snapshot; ondemand: `get_medications` (≤90 d, per-medication counts) | no individual dose, no window older than 90 d |
| Nutrition intake | `dietary_*` metrics | none | as metrics (6 in the general selection) | see metrics |
| Body goal, targets, nutrition adherence | `readGoalSummary` (`body-goal/server.ts`) | `body-goal` | goal summary JSON attached to every question | per-day adherence not reachable |
| Insights (generated changes and associations) | `generateInsights` (`analytics/insights.ts`) | none (Insights page) | none | unreachable |
| Weekly and monthly reports | `buildWeeklyReports`, `buildMonthlyReports` (`analytics/reports.ts`) | none | none | unreachable |
| Metric coverage and availability | `coverageFor`, `availabilityTable` | none (Settings) | ondemand: index; full: none | full mode cannot tell "not recorded" from "not selected" |
| Data-quality findings | `dataQualityReport` (`adapters/quality.ts`) | `pipeline/quality` | none | unreachable |
| Pipeline and source status | `resolvePipelineStatus` (`pipeline/status.ts`) | `pipeline/status`, `sources/*` | none | "is my data up to date?" unanswerable |
| Activity coverage (where workouts went) | `readCoverage` (`activity-maps/service.ts`) | `activity-coverage` | none | unreachable |
| Saved map areas | `listMaps` (`db/activity-maps-store.ts`) | `activity-maps` | none | configuration; low value |
| Profile (age, sex, timezone, notes) | `readProfile` | `profile` | none (the briefing gets it; the analyst does not) | the owner's own "read my numbers with this in mind" notes never reach the analyst |
| Preferences (units) | `readPreferences` | `preferences` | units arrive with the request | none that matters |
| Today's briefing | `readBriefing` (`briefing/index.ts`) | `briefing` | none | "what did this morning's briefing mean?" unanswerable |
| Dashboard cards | `pgListCards` (`db/dashboard-store.ts`) | `dashboard/cards` | none | configuration; low value |
| Map providers, geocoder, readiness, delete impact, credentials | various | `map-providers`, `geocode`, `health`, `lab/delete-impact`, `sources/*` writes | none | exempt by design (§10.3) |
| Analyst conversations | analyst tables | `analyst/conversations` | the current conversation's bounded memory | exempt: cross-conversation recall is out of scope (§15) |

---

## 2. Decisions

1. **One capability registry is the single source of truth** (§3). Tools, the system-prompt
   capability map, the coverage index, the Settings disclosure list, source tagging, the client's
   tool labels and the generated docs table are all derived from it.
2. **Tools wrap server functions directly, never the HTTP routes** (§3.3).
3. **Ten read tools** replace the seven data tools (§4). Two of the seven are retired
   (`get_metrics`, `compare_periods`), five are kept by name with extended parameters.
4. **Data tools are offered in both context modes.** `ANALYST_CONTEXT` keeps meaning "is a starting
   selection pre-attached", not "may the model look things up".
5. **A selection never implies completeness.** Every pre-attached block is labelled as a selection,
   and the coverage index (counts and date ranges per capability) is always in the message (§5).
6. **Absence must be earned.** A reply that claims absence for a capability that has records, with
   no lookup of that capability in the question, gets one corrective turn (§5.5).
7. **Strict handler routing is retired for configured providers.** Handlers stay for the demo
   analyst only; a model always gets the general selection plus tools (§5.4).
8. **A parity test fails the build** when a route, dataset accessor, page, registered metric or data
   source has no capability and no reasoned exemption (§10).

Rejected:

- *One tool per capability (~25 tools).* Each tool spec costs prompt on every turn, small models
  pick badly among many similar names, and the specs would drift from each other.
- *One generic `get(capability, args)` tool for everything.* Its schema cannot describe per-
  capability parameters, so models send wrong arguments and burn rounds. Kept only for the small,
  non-time-series app state (`get_app_data`), where arguments are few.
- *Calling our own API routes from the tool layer.* See §3.3.
- *Removing the pre-attached selection (forcing `ondemand`).* The general selection answers common
  questions in one turn for weak models; with labelling and tools it is no longer a trap. Switching
  the default is an owner decision (§15, Q1).

---

## 3. Capability model

### 3.1 Where it lives

```
src/lib/analyst/capabilities/
  manifest.ts      client-safe: ids, areas, tool names, status labels, source tags. No server import.
  types.ts         the types below
  window.ts        window parsing and resolution (§7)
  envelope.ts      result envelope, paging, failure statuses (§6)
  registry.ts      SERVER ONLY: CAPABILITIES (each entry: manifest entry + read function)
  areas/*.ts       one file per area (metrics, sleep, heart, workouts, training, labs,
                   medications, body, activity, insights, app) holding its capabilities
  exemptions.ts    reasoned exemptions for the parity test (§10.2)
  parity.test.ts   the guard
```

### 3.2 Types (sketch)

```ts
type CapabilityArea = 'metrics' | 'sleep' | 'heart' | 'workouts' | 'training' | 'labs'
  | 'medications' | 'body' | 'activity' | 'insights' | 'app';

type DataOwner = 'dataset' | 'lab-store' | 'workout-sources' | 'medications-upstream'
  | 'config-store' | 'computed';

/** Feeds src/lib/sources/tagging.ts: which sources a turn that used this capability came from. */
type SourceTag = 'metric-provenance' | 'all-health' | 'lab' | 'hae' | 'workout-detail' | 'configuration';

/** Closed list; the Settings disclosure is generated from the categories in use. */
type SendingCategory = 'metric-summaries' | 'daily-values' | 'sleep-nights' | 'blood-pressure'
  | 'workouts' | 'strength-sessions' | 'lab-results' | 'medication-records' | 'body-goal'
  | 'profile-context' | 'app-status' | 'locations-coarse';

type SizeClass = 'small' | 'per-day' | 'per-record' | 'per-series';

interface CapabilityManifestEntry {        // manifest.ts — safe for the client
  id: string;                              // 'workouts.sessions'
  area: CapabilityArea;
  title: string;                           // 'Workout sessions'
  tool: string;                            // 'get_workouts'
  statusLabel: string;                     // 'Looking up your workouts…'
  sources: SourceTag;
  category: SendingCategory;
}

interface Capability<A, R> extends CapabilityManifestEntry {
  /** One or two sentences for the model: what it holds, and what it does not. */
  description: string;
  owner: DataOwner;
  /** What it mirrors, read by the parity test (§10). */
  mirrors: { routes?: string[]; pages?: string[]; accessors?: string[]; metrics?: string[] };
  time: 'window' | 'none';
  sizeClass: SizeClass;
  /** Default and maximum rows per call for 'per-record'/'per-day' classes. */
  page?: { defaultLimit: number; maxLimit: number };
  /** Words a reply uses when it claims absence (the absence audit, §5.5). */
  absenceTerms: string[];
  /** Metric ids an evidence card may cite after a successful read. */
  citesAs?: string[];
  /** Cheap: first/last day and count, or 'unknown' when only the upstream can tell. */
  coverage(ctx: CapabilityContext): Promise<Coverage>;
  read(args: A, ctx: CapabilityContext): Promise<Envelope<R>>;
}

type Coverage =
  | { kind: 'known'; first: string | null; last: string | null; count: number; unit: string }
  | { kind: 'unknown'; reason: string }          // e.g. upstream medications before a read
  | { kind: 'unavailable'; reason: string };     // source not configured or unreadable

interface CapabilityContext {
  system: UnitSystem;
  refKey: string;            // REFERENCE_KEY at the start of the question
  tz: string;                // REFERENCE_TZ
  env: NodeJS.ProcessEnv;
  access: DataAccess;        // per-question readers and the fetch record (dataAccess.ts)
  routine: RoutineDeps;
  policy: PrivacyPolicy;     // §9.2
}
```

The model never sees `Capability` objects. It sees tool specs (§4), the static capability map
(§5.1) and the coverage index (§5.2), all rendered from these entries.

### 3.3 Wrap server functions, not routes

Each `read` calls the same server function the route or page calls (`seriesFor`, `sleepSeries`,
`bloodPressureSeries`, `workoutViews`/`filterWorkouts`, `loadTrainingData`, `matchSession`,
`loadLabSource`, `listReports`, `loadMedications`, `readGoalSummary`, `dataQualityReport` inputs,
`resolvePipelineStatus`, `readCoverage`, `readProfile`, `readPreferences`, `readBriefing`,
`pgListCards`, `generateInsights`, `buildWeeklyReports`/`buildMonthlyReports`,
`workoutDetailFrom`). Why:

- **Same numbers.** The page and the tool share one function and one registry formatter; an HTTP
  hop would add a second serialisation where they can drift.
- **No self-calls.** An HTTP self-call needs the server's own base URL (not known inside the
  container in every deployment), serialises and parses every result twice, and adds a failure mode
  (the server calling itself under load) that nothing else in the app has to handle.
- **Live state for free.** The analyst routes already call `installDataset()` per request, which
  purges a removed source before building (`adapters/runtime.ts`). A tool reading the installed
  dataset cannot see a removed source's data.
- **Testable.** Readers are injected through `DataAccess` and `RoutineDeps` like today, so tests
  never touch Postgres, the health source or the network.

Where a route holds logic that is not in a library function (for example a projection done inside
`route.ts`), the gate that wraps it first moves that logic into `src/lib/**` and points the route at
it, so route and tool keep one implementation.

---

## 4. Tool surface

### 4.1 The set

| Tool | Status | Capabilities served |
|---|---|---|
| `list_capabilities` | new | discovery: every capability, its parameters, its coverage |
| `get_metric_series` | new, replaces `get_metrics` and `compare_periods` | `metrics.series` (every single-number registered metric) |
| `get_metric_relationship` | kept, gains `window` | `metrics.relationship` |
| `get_workouts` | kept name, rebuilt | `workouts.sessions`, `workouts.summary` (+ matched strength detail) |
| `get_sleep` | new | `sleep.nights`, `sleep.summary` |
| `get_blood_pressure` | new | `heart.blood_pressure` |
| `get_lab_results` | kept, gains `window` | `labs.series` |
| `compare_lab_panels` | kept | `labs.compare` |
| `get_medications` | kept name, rebuilt | `medications.doses`, `medications.summary` |
| `get_app_data` | new | small app state: `labs.documents`, `body.goal`, `body.nutrition_adherence`, `insights.current`, `insights.reports`, `activity.coverage`, `activity.maps`, `app.data_quality`, `app.pipeline`, `app.profile`, `app.preferences`, `app.briefing`, `app.dashboard`, `training.workout_template` |

The plan read tools keep their names: `get_routine_progress`, `get_training_plan`,
`get_training_sessions` (gains `start`/`end` and a truncation marker), `search_exercise_templates`,
`get_reference_plan`. They are registered as capabilities (`training.*`) so the parity test and the
map see them. The seven plan write tools are untouched.

### 4.2 Shared parameters

Every time-bounded tool takes the same window object (validated by `window.ts`, §7):

```jsonc
"window": {
  "type": "object",
  "description": "Pick ONE: day, month, start+end, or lastDays. Omit for the default of the tool.",
  "properties": {
    "day":      { "type": "string", "description": "YYYY-MM-DD" },
    "month":    { "type": "string", "description": "YYYY-MM" },
    "start":    { "type": "string", "description": "YYYY-MM-DD, inclusive" },
    "end":      { "type": "string", "description": "YYYY-MM-DD, inclusive" },
    "lastDays": { "type": "integer", "minimum": 1, "maximum": 730 }
  },
  "additionalProperties": false
}
```

Record tools take `limit` and `offset` (integers). Every result is an envelope (§6.1) that echoes
the resolved window and carries `page` when rows were limited.

### 4.3 Each tool

**`list_capabilities`** `{ area?: CapabilityArea, id?: string }` → `{ capabilities: [{ id, title,
tool, description, parameters (short), coverage }] }`. Without arguments: one line per capability
(≈ the map in §5.1 plus live coverage). With `id`: that capability's full parameter description and
two example calls. Never returns data values.

**`get_metric_series`**
```jsonc
{ "metrics": ["string"] /* 1..3 ids, names or aliases */,
  "window": { /* §4.2; default lastDays 30 */ },
  "granularity": "auto | summary | day | week | month",   // default auto
  "compareTo": "previous | none | { start, end }",          // default previous (the equal-length window before)
  "offset": 0 }
```
Result per metric: `{ metricId, metricName, unit, aggregation, window, compareWindow?, observations,
summary: { mean, median, min, max, latest, latestOn } (each a display string), change?, points:
[{ key, value, display }], granularity, page? }`. `auto` returns days up to 92 points, then weeks
up to 104, then months. Accumulating metrics exclude the in-progress day (as `compare_periods` does
today). `blood_pressure` is refused with `invalid_args` naming `get_blood_pressure`.
`sleep_analysis` is served (minutes asleep per night) and its description points at `get_sleep` for
stages. Unknown id → `invalid_args` with `didYouMean` (the existing `suggest`).

**`get_metric_relationship`** — today's parameters plus `window` (default `lastDays 90`); `days`
stays accepted as `lastDays`.

**`get_workouts`**
```jsonc
{ "window": { /* default lastDays 30 */ },
  "view": "sessions | summary",          // default sessions
  "type": "string",                      // activity type as recorded, case-insensitive; 'all' default
  "sort": "date | duration | calories | distance",   // default date
  "order": "desc | asc",                  // default desc
  "detail": false,                        // true: attach the matched strength session's exercises
  "limit": 20, "offset": 0,               // limit max 25
  "days": 30 }                            // legacy alias of window.lastDays
```
`sessions` rows: `{ id, day, start, end, type, duration, distance?, calories?, avgHeartRate?,
maxHeartRate?, display: {…}, strength?: { title, exercises: [{ name, sets: [string] }] } }`.
`strength` is joined with `matchSession` exactly as the Workouts page does; with `detail: false` it
is reduced to `{ title, exerciseCount }`. `summary`: totals, sessions per week, minutes as `h:mm`,
count and minutes by type, by month when the window is over 62 days, and the latest three sessions.
Types present in the window are always listed (`typesInWindow`) so a wrong `type` can be corrected.

**`get_sleep`**
```jsonc
{ "window": { /* default lastDays 14 */ },
  "view": "nights | summary",                      // default nights for ≤31 nights, else summary
  "sort": "date | asleep | inBed | deep | rem | core | awake | bedtime | wake",
  "order": "desc | asc", "limit": 14, "offset": 0 } // limit max 31
```
Night rows: `{ day (waking day), bedtime, wakeTime, asleep, inBed, stages: { deep, core, rem, awake },
hasStages, display }`. In-bed-only nights are returned with `hasStages: false` and no asleep value
(never 0; same rule as `seriesFor`). Summary: nights, nights with stages, mean asleep/in bed/each
stage, by week or month, plus the three longest and three shortest nights.

**`get_blood_pressure`**
```jsonc
{ "window": { /* default lastDays 30 */ }, "view": "readings | summary",
  "aboveReferenceOnly": false, "limit": 50, "offset": 0 }
```
Rows `{ day, time, systolic, diastolic, display: "118/76 mmHg", aboveReference }`; summary from
`bloodPressureStats` / `bloodPressureBaseline` with `formatBloodPressure*`. The reference threshold is
`BP_REFERENCE_THRESHOLD` and is labelled a reference threshold, never a diagnosis.

**`get_lab_results`** — today's parameters plus `window` (observation dates). Unchanged behaviour
otherwise, including the specimen rules and `notReturned`.

**`compare_lab_panels`** — unchanged.

**`get_medications`**
```jsonc
{ "window": { /* default lastDays 30; earliest = the source lookback */ },
  "view": "summary | doses", "name": "string", "limit": 60, "offset": 0 }
```
`doses` rows: `{ day, time, medication, status: taken|skipped|unknown, dose? (as logged) }`. The
record-not-plan wording of today's description stays verbatim.

**`get_app_data`**
```jsonc
{ "capability": "labs.documents | body.goal | … (enum generated from the registry)",
  "params": { /* validated against that capability's own schema */ } }
```
Unknown capability → `invalid_args` listing the enum. Per-capability parameters are short (for
example `insights.reports { kind: weekly|monthly, count ≤ 12 }`, `body.nutrition_adherence
{ window }`, `activity.coverage { window }`, `training.workout_template { templateId }`).

### 4.4 Worked examples

The coverage index (§5.2) says, for example, `workouts.sessions · 2026-01-02..2026-10-08 · 412`.
All dates below are synthetic.

1. **"How was my last workout?"** → `get_workouts { "window": { "lastDays": 30 }, "limit": 1,
   "detail": true }` → one session with its display strings and matched exercises. If the 30 days
   are empty the tool answers `no_data_in_window` with coverage `last: 2026-08-14`, and the model
   re-asks with `{ "day": "2026-08-14" }`.
2. **"Workouts in March"** → `get_workouts { "window": { "month": "2026-03" }, "view": "summary" }`,
   then, if the question wants detail, `view: sessions` with `limit 25` and `offset` pages.
3. **"My deepest sleep nights this year"** → `get_sleep { "window": { "start": "2026-01-01", "end":
   "2026-10-08" }, "view": "nights", "sort": "deep", "order": "desc", "limit": 10 }`. The result
   echoes the resolved window clipped to coverage and states how many nights carried stages.
4. **"Blood pressure trend against my labs"** → `get_blood_pressure { "window": { "lastDays": 180 },
   "view": "summary" }` and `get_lab_results { "category": "Lipids", "history": true }` in the same
   round. The prompt's existing rules keep the two apart (association, never cause; reference
   threshold, never diagnosis).
5. **The failing question** ("Are my workouts associated with better sleep?") → `get_workouts
   { "window": { "lastDays": 90 }, "view": "sessions", "limit": 25 }` (paged) plus `get_sleep
   { "window": { "lastDays": 90 }, "view": "nights", "limit": 31 }` (paged), or the summaries when
   pages run out; the model compares workout days with non-workout days and says it is an
   association. (A dedicated "workout day vs rest day" relationship is a candidate capability, not
   part of this design: §15.)

---

## 5. Awareness: how the model learns the app

### 5.1 Static capability map (system prompt)

`DATA_TOOLS_PROMPT` is replaced by `renderCapabilityMap(CAPABILITIES)`: one line per capability,
`id — title: what it holds · tool`, grouped by area. No values, no dates, no counts (those change
per request and belong in the message). Bound: ≤ 4,000 characters, enforced by a test. It is
appended to the system prompt whenever tools are offered.

### 5.2 Dynamic coverage index (user message)

`renderDataIndex` is replaced by `renderCoverageIndex(coverages, refKey)`: today's date, then one
line per capability with `first..last · count unit` or `unknown — fetch to see` or `unavailable —
<reason>`, then the per-metric lines the index has today (metrics with data, their first/last day
and days recorded) and the lab panel dates and categories. Coverage functions read only in-memory
state or what the question already loads (the lab source); an upstream-only capability reports
`unknown` rather than making an extra call (the medication count is not worth an upstream request
per question). Bound: ≤ 6,000 characters; when over, metric lines collapse to one line per category
with a stated count.

The coverage index is sent in **both** modes. In `full` mode it sits before the selection JSON, so
"workouts: 412 records, 2026-01-02..2026-10-08" is in front of the model even when the selection has
none.

### 5.3 The selection is labelled, and the wording changes

`RetrievalBundle.note` today serves two readers: the user (stored retrieval note) and the model
(`selectionNote`). Split it:

- `note` (user-facing, stored): unchanged meaning, e.g. "Selected 14 metric summaries and the workout
  log; 412 records read. Only what is listed was sent."
- `selectionNote` (model-facing), replacing "The rest of the dataset was not sent anywhere.":

> This is a STARTING SELECTION, not the record. It holds: {list, each with its window}. Everything
> else the app holds is listed in the coverage index above and was not included here. If the question
> needs anything that is not in this selection, fetch it with the tools. Never say that something is
> not recorded, missing or absent because it is not in this selection; say that only after a tool
> returned no_data_in_window for it.

and, when tools are not available (server refused them, or `ANALYST_TOOLS=off`):

> … Everything else the app holds is listed in the coverage index above. You cannot fetch more in
> this answer. For anything the question needs that is not here, say that it was not included in what
> you were given and how much of it the app holds (from the index); never say it is not recorded.

`buildContextPayload` gains `selection: { complete: false, includes: string[] }`. The system-prompt
grounding rules change in three places: "Answer only from the context supplied in the user message"
→ "… and what the tools return"; the `observations: 0` rule → "has no records **in that window**
(the tool states what the app holds and for which dates)"; and a new rule: "A capability that is in
the coverage index with records exists. Absence is a tool result (`no_data_in_window`), never an
inference from a selection."

The deployment sets `ANALYST_SYSTEM_PROMPT_FILE`, so the live system prompt is the tracked
`config/analyst-prompt.md`, not `DEFAULT_ANALYST_SYSTEM_PROMPT`. It carries the same three sentences
(lines on "Answer only from the context supplied" and "was not recorded in the selected window"), so
both files change together, and a test asserts the file no longer contains the old sentences.

### 5.4 What is still pre-attached

`full` mode keeps the general selection (`GENERAL_RETRIEVAL_METRICS`, 30 days, the workout roll-up)
plus the lab block (overview, or analyte mode when `isLabQuestion`) and the medication snapshot, all
labelled as in §5.3. For a configured provider **`selectHandlerStrict` is no longer called**: a
narrower handler bundle is how the failure happened, and with tools nothing needs it. The demo
analyst keeps its handlers. Separately, the `sleep-vs-recovery` canonical prompt is renamed to what
the handler computes ("Is more sleep associated with higher HRV?"), because the demo answers a
workouts question with sleep and HRV today.

### 5.5 The absence audit

After the loop produces an answer (and before the repair turn logic returns), the service runs
`auditAbsence(answer, coverages, toolsUsedThisQuestion)`:

- It looks for absence claims (`no|not any|none|not recorded|does not contain|contains no|isn't any`
  within the same sentence as one of a capability's `absenceTerms`) in `analysis`, `summary` and
  `uncertainty`.
- A claim is a **violation** when that capability's coverage is `known` with `count > 0` (or
  `unknown`) and **no tool of that capability was called in this question**.
- With tools available: one corrective turn (shares the existing single repair budget; a question
  gets at most one of the two):

> Your answer says there are no {title} records. The app holds {count} {unit} from {first} to
> {last}. Fetch them with {tool} before answering, then answer again in the same JSON shape.

- With no tools: no extra turn; the app appends an app-rendered line to `uncertainty`: "The app holds
  {count} {title} from {first} to {last} that were not part of this answer." (computed, not model
  text, so it needs no grounding).
- A claim made after the matching tool returned `no_data_in_window` is not a violation.

This is the mechanical half of requirement 3; the prompt in §5.3 is the persuasive half.

---

## 6. Failure semantics

### 6.1 Envelope

```ts
type Status = 'ok' | 'no_data_in_window' | 'source_unavailable' | 'privacy_blocked' | 'invalid_args';

interface Envelope<R> {
  status: Status;
  capability: string;
  window?: { start: string; end: string; asked: string; clipped?: string };
  coverage?: Coverage;
  data?: R;
  page?: { returned: number; total: number; offset: number; nextOffset?: number; how?: string };
  /** One sentence, written for the model: what to do next. */
  next?: string;
  problems?: string[];      // invalid_args only
}
```

`not_in_selection` is not a tool status: a tool always reads live state. It is the label every
pre-attached block carries (§5.3) and the term the prompt uses for it.

### 6.2 Each status, as the model reads it

| Status | When | `next` wording (template) | Expected model behaviour |
|---|---|---|---|
| `ok` | data returned | absent, or the paging sentence | answer; page if needed |
| `no_data_in_window` | the window is valid, nothing recorded in it | "No {title} between {start} and {end}. The app holds {count} from {first} to {last}." (or "… holds none at all.") | widen or move the window when the question allows; otherwise tell the user exactly this |
| `source_unavailable` | not configured, unreadable, timed out | "{title} could not be read: {scrubbed reason}. This says nothing about whether records exist." | say it could not be read; never say "none" |
| `privacy_blocked` | the privacy policy (§9.2) withholds this category | "{title} is withheld from the model by the AI privacy setting." | tell the user the setting withholds it; no workaround |
| `invalid_args` | schema, unknown id, impossible date, ambiguous window | the problems plus `didYouMean`, `typesInWindow`, `panelDates` as today | fix the call and retry |

`isError` is true for every status except `ok` and `no_data_in_window` (an empty window is an
answer, not an error). The `page.how` sentence is fixed: "{returned} of {total} shown. Call again
with offset {nextOffset} for more, or use view: summary."

---

## 7. Dates and windows

- **One "today".** `refKey = REFERENCE_KEY` captured once at the start of the question (as
  `DataAccess.refKey` is today). Day keys are calendar days in `REFERENCE_TZ`; records are bucketed
  with `canonicalDayKey`/`workoutDayKey`, the same functions the pages use.
- **Parsing** (`window.ts`, pure): exactly one of `day`, `month`, `start`+`end`, `lastDays`;
  `YYYY-MM-DD` must survive `addDays(key, 0) === key` (rejects `2026-02-30`); `start ≤ end`; span ≤
  730 days; `month` expands to its first and last day. `lastDays N` = `trailingWindow(refKey, N)`.
- **Future.** A window entirely after `refKey` → `invalid_args` ("{start} is after today,
  {refKey}"). A window that ends after `refKey` is clipped to `refKey` and says so in
  `window.clipped`.
- **Before the data.** A window entirely before coverage → `no_data_in_window` with coverage. The
  live source holds a rolling window (`LIVE_LOOKBACK_DAYS = 400`, and the upstream may hold less),
  so "the app holds data from {first}" is the honest boundary and the tool states it.
- **Echo.** Every envelope carries `window.asked` (the arguments as given, e.g. `month 2026-03`) and
  the resolved `start`/`end`.

---

## 8. Budget and performance

| Bound | Value | Where |
|---|---|---|
| One tool result | ≤ 12,000 chars (`MAX_DATA_RESULT_CHARS`, unchanged); never cut mid-JSON | each tool |
| Loop cut-off per result | 14,000 chars (`MAX_TOOL_RESULT_CHARS`, unchanged, a backstop only) | `runTool` |
| Tool output per question | **new** ≤ 48,000 chars total; beyond it a call returns "Tool budget for this question is used up; answer from what you have and say what you could not fetch." | `tool-loop.ts` |
| Rounds / calls | 6 / 12 (unchanged) | `tool-loop.ts` |
| Static map | ≤ 4,000 chars | system prompt |
| Coverage index | ≤ 6,000 chars | user message |
| Data tool specs | ≤ 12,000 chars for the ten data tools together | test |

Row sizes are measured in a test against synthetic data and the defaults chosen so a default call
fits with margin: workouts 20 × ~260 chars, sleep 14 × ~220, blood pressure 50 × ~90, doses 60 ×
~110, metric points 92 × ~45. If a page still exceeds the limit, rows are dropped from the end and
`page.total`/`nextOffset` say so; nothing is truncated inside a row.

**Large windows** are summarised before they are paged: a year of sleep (≈365 nights) defaults to
`view: summary` (monthly means and the extremes) and the model pages nights only when it asks for
them with a sort (`deep desc limit 10` returns ten nights, not 365). Four hundred workouts in a window
return a by-month-by-type summary plus the latest three sessions, and sessions page in 25s.

**Cost.** Reads are in-memory except the lab store (one read per question, memoised in `DataAccess`,
as today), the medications upstream (through the adapter's existing cache) and the config stores
(single-row reads). Coverage for the index is O(records) once per question. No extra model calls:
the absence audit adds at most one turn, inside the existing repair budget, and only for a violating
reply. The AI-connection contract (one connection per explicit chat request plus the briefing) is
unchanged.

---

## 9. Privacy and compliance

### 9.1 Checklist (each item has a test in the gate named)

- [ ] **No secrets.** Every `read` returns an allow-listed projection, never a stored row or a
  config object. A canary test sets fake values for every credential variable the app reads
  (`HAE_API_KEY`, `HAE_TOKEN`, `HEVY_API_KEY`, `OURA_CLIENT_SECRET`, `OURA_SECRET`,
  `VITAL_SECRET_KEY`, `ANALYST_API_KEY`, `VITAL_LLM_API_KEY`, `VITAL_LLM_FALLBACK_API_KEY`,
  `VITAL_PG_PASSWORD`, `MAP_TILES_CARTO_KEY`) and fake stored source credentials, runs every
  capability, and asserts no canary
  appears in any result, `next` or error string. (AN-D3, AN-D4)
- [ ] **Errors are scrubbed.** `source_unavailable` reasons go through `scrubText`/`safeExcerpt`
  (`scrub.ts`) before they enter a result. No host, URL or path in model-facing text. (AN-D2)
- [ ] **Nothing logged.** Tools write no value to a log (existing service guarantee); the fetch log
  (`fetched.log`) holds capability ids and windows only. (AN-D2)
- [ ] **Read-only.** No capability writes. The plan write tools are the only writers and are
  unchanged. (AN-D1 parity: a capability's `read` may not import a store's write function; checked
  by an import scan of `areas/*.ts`.)
- [ ] **Live state.** No module-level cache in `capabilities/`; per-question memo only (the lab
  source). A test removes a source between two questions and asserts the second sees none of its
  data and the coverage index no longer lists it. (AN-D3)
- [ ] **Source tagging.** `src/lib/sources/tagging.ts` derives its tool sets from the manifest's
  `sources` tags, so a removed source still deletes every conversation a new capability fed. A test
  fails when a manifest tool is not classified. (AN-D3)
- [ ] **Disclosure is generated.** `REMOTE_SENDING_CATEGORIES` (`config.ts`), shown on Settings →
  AI privacy, is built from the categories of the capabilities offered. Today's list omits workouts,
  sleep nights, blood pressure, medication records, the body goal and profile context although some
  of them are already sent; after this change the list cannot fall behind the registry. (AN-D5)
- [ ] **Profile minimisation.** `app.profile` returns age, sex, timezone and the notes field (the
  context the owner writes so numbers are read correctly). It never returns the name. `app.pipeline`
  returns per source: kind, connected, last successful read and record counts; never hosts, URLs,
  credential state beyond "connected", or error bodies unscrubbed. (AN-D4)
- [ ] **Coarse locations only.** `activity.coverage` returns area-level summaries (distance and
  counts per saved area, new-ground share) and never route coordinates. (AN-D4)
- [ ] **Medications.** The existing record-not-plan description and prompt rules stay verbatim on the
  rebuilt `get_medications`; dose rows carry the medication as logged and its status, nothing else.
  (AN-D3)
- [ ] **Source names.** UI rule: no data-source names on any page except Settings. The analyst's
  answer is rendered on the Analyst page, so model-facing results carry provenance as a neutral kind
  (`health`, `workout detail`, `lab documents`), not a product name. The one exception is
  `app.pipeline`, which mirrors Settings and may name sources; the prompt tells the model to name a
  source only when the question is about sources or connections. (The existing plan tool
  descriptions that say "e.g. Hevy" are reworded to "a connected workout source".) (AN-D4)
- [ ] **Number rule.** Every numeric field a capability returns has a sibling display string from the
  registry formatters (`formatMetricWithUnit`, `formatDurationHm`, `formatBloodPressure`, …); no zero
  is returned for a missing value; a parity test walks every result and fails on a bare measurement
  without a display string (counts, offsets and coefficients are exempt by key name). (AN-D2)
- [ ] **Grounding.** Tool outputs keep flowing into `checkGrounding` as today; `citesAs` adds metric
  ids to `fetched.citable` so evidence cards validate. (AN-D2)

### 9.2 The privacy policy hook

There are **no per-category toggles today**: Settings → AI privacy is a read-only disclosure of
`REMOTE_SENDING_CATEGORIES`, and the only controls are the provider choice, `ANALYST_TOOLS=off` and
`ANALYST_CONTEXT`. This design adds the hook, not the toggles:

```ts
interface PrivacyPolicy { allows(category: SendingCategory): boolean }
const ALLOW_ALL: PrivacyPolicy = { allows: () => true };
```

Every tool calls `policy.allows(cap.category)` before `read` and returns `privacy_blocked`
otherwise; the coverage index marks blocked capabilities "withheld by the AI privacy setting" with no
count. `ALLOW_ALL` is the only policy until the owner decides on toggles (§15, Q2). The pre-attached
selection uses the same policy, so a future toggle cannot be bypassed by the fixed context.

---

## 10. Guard: the parity test

### 10.1 What it enumerates

`capabilities/parity.test.ts` (pure, no network, no database):

1. **Routes.** Walk `src/app/api/**/route.ts` with `fs`; read each file's exported methods with
   `/export (async )?function (GET|POST|PUT|PATCH|DELETE)/`; key = `GET /api/lab/summary` (dynamic
   segments as written: `/api/routine/[pathId]`). Every `GET` key must appear in some capability's
   `mirrors.routes` or in `EXEMPTIONS`. Non-`GET` methods are exempt by rule (`write`: the analyst is
   read-only) and the test prints them, so a new write route is still visible in review.
2. **Dataset accessors.** `import * as dataset from '../../adapters/dataset'`; every exported function
   must be in some `mirrors.accessors` or exempt (`setActiveDataset`, `resetToDemoDataset` mutate;
   `canonicalDayKey`, `isAccumulating` … are helpers).
3. **Metrics.** Every `getAllMetrics()` id must be served by a capability (`metrics.series` serves
   all single-number metrics; `blood_pressure` → `heart.blood_pressure`; `sleep_analysis` and
   `sleep_in_bed` also → `sleep.nights`). Plus: on the demo fixtures every `availableMetricIds()` id is
   registered.
4. **Pages.** Walk `src/app/**/page.tsx`; each route path must be in some `mirrors.pages` or exempt
   (`/settings`, `/themes`, `/analyst`).
5. **Sources.** Every `DATA_SOURCES` id (`sources/registry.ts`) must be covered by some capability's
   `sources` tag.
6. **Registry hygiene.** Ids unique; every `tool` exists in `availableTools`; every capability has a
   description ≤ 400 chars, at least one `absenceTerms` entry when it returns records, a `category`,
   and a `coverage` function; manifest and registry agree (same ids, same tools).
7. **Docs.** The generated table `docs/analyst-capabilities.md` equals
   `renderCapabilityDoc(CAPABILITIES)` (regenerate with `npm run analyst:capabilities`).

### 10.2 Exemptions

```ts
interface Exemption {
  kind: 'route' | 'accessor' | 'page' | 'metric' | 'source';
  key: string;                        // 'GET /api/map-providers'
  reason: string;                     // ≥ 30 characters, says WHY the analyst does not need it
  tracked?: true;                     // a known gap to close, not a decision
}
```

AN-D1 lists every current gap with `tracked: true`. Each later gate removes the entries it closes
(the test fails on an exemption that is no longer needed, so the list cannot rot). AN-D7 flips
`ALLOW_TRACKED = false`: from then on only reasoned, permanent exemptions pass. Exemptions are code,
so they are reviewed in the diff like any other change.

### 10.3 Permanent exemptions (proposed)

`GET /api/health` (readiness probe, no data) · `GET /api/map-providers` (tile configuration) ·
`GET /api/geocode` (forwards a query to a third-party geocoder; would leak model text to it) ·
`GET /api/lab/delete-impact` (administrative) · `GET /api/sources/*` (credential and connection
state; the analyst gets `app.pipeline` instead) · `GET /api/analyst`, `GET /api/analyst/conversations*`
(the analyst itself) · pages `/settings`, `/themes`, `/analyst`.

---

## 11. Test strategy

| Layer | Tests |
|---|---|
| `window.ts` | every form, impossible dates, span cap, future, clipping, month ends, leap day, echo |
| `envelope.ts` | each status shape; `isError` mapping; paging sentence; row-drop under the size limit |
| registry and parity | §10.1 items 1–7; exemption staleness; manifest/registry agreement |
| each capability | synthetic datasets (seeded generator, no wall clock): empty, one record, hundreds, a window before coverage, in-bed-only nights, BP pairs with missing halves, partial current day for sums, unknown type; display string on every number; `no_data_in_window` carries coverage; `privacy_blocked` with a deny policy |
| each tool | schema rejects bad args with the right `problems`; legacy `days` alias; result under 12,000 chars at the default limit and at max limit with 1,000 records |
| tool loop with a fake model | scripted `ToolCallingProvider` (pattern of `tool-loop.test.ts`): ask → tool → answer; paging over two calls; per-question budget; absence audit fires once and not after a `no_data_in_window`; tools offered in `full` mode |
| the owner's scenario | `full` mode, synthetic dataset with 420 workouts over 400 days, question "Are my workouts associated with better sleep?": the pre-selection holds no workouts; the coverage index line for workouts shows 420; a fake model that first answers "no workout records" receives the audit turn, calls `get_workouts`, and the final answer passes validation with no absence claim |
| privacy | secret canary across all capabilities; source removal between questions; tagging covers every tool |
| prompt | map ≤ 4,000 chars and contains every capability id; index ≤ 6,000 chars at 40 metrics; selection wording present in both tool and no-tool variants |

All tests run in the clean environment (credential variables unset); none touch Postgres, the
health source or a model.

---

## 12. Evaluation set

`src/lib/analyst/eval/questions.ts` holds the questions; each lists the expected first tool calls as
predicates (tool name plus argument checks), with `refKey = 2026-10-08` and a synthetic dataset.

**Offline** (`eval.test.ts`, in the suite): an *oracle* fake model issues each question's expected
calls; the test proves every call validates, returns `ok` or the stated status on the synthetic data,
and that the answer it then gives passes `parseAnalystReply` and the absence audit. This tests the
plumbing for every question, not a model's judgement.

**Live** (`npm run analyst:eval`, never in the suite or CI, run by the owner): sends each question to
the configured provider against the running dataset, records the tool calls, and scores (a) the
expected capability was called, (b) the window resolved to the expected month/day, (c) no absence
violation. It prints counts and tool names only, never values. Each question is one explicit
request, so it sits inside the AI-connection contract, but it is ~30 model calls: run on demand only.

| # | Question | Expected calls |
|---|---|---|
| 1 | How was my last workout? | `get_workouts` limit 1, sessions |
| 2 | How many workouts did I do in March? | `get_workouts` month 2026-03, summary |
| 3 | Show my runs longer than 45 minutes this summer | `get_workouts` type Running, start 2026-06-01..2026-08-31, sort duration |
| 4 | Are my workouts associated with better sleep? | `get_workouts` + `get_sleep`, same window |
| 5 | What did I lift on my last strength day? | `get_workouts` detail true (or `get_training_sessions`) |
| 6 | How has my bench press progressed? | `get_training_sessions` exercise "bench" |
| 7 | What were my deepest sleep nights this year? | `get_sleep` sort deep desc, year window |
| 8 | How much REM did I get last week? | `get_sleep` lastDays 7 |
| 9 | When do I usually go to bed on weekends? | `get_sleep` nights, sort bedtime |
| 10 | How did my sleep in August compare with September? | `get_sleep` summary ×2 or `get_metric_series` sleep_analysis with compareTo |
| 11 | What's my resting heart rate trend over 6 months? | `get_metric_series` resting_heart_rate lastDays 180, week |
| 12 | Compare my HRV the week of Sept 22 with the week of Sept 29 | `get_metric_series` with window + compareTo window |
| 13 | What was my step count on 2026-09-14? | `get_metric_series` day 2026-09-14 |
| 14 | Has my blood pressure gone down since July? | `get_blood_pressure` start 2026-07-01, summary |
| 15 | Which readings were above 130/80 last month? | `get_blood_pressure` aboveReferenceOnly |
| 16 | Show my blood pressure next to my cholesterol | `get_blood_pressure` + `get_lab_results` |
| 17 | What was my last LDL? | `get_lab_results` LDL |
| 18 | How has my A1c changed across panels? | `get_lab_results` history |
| 19 | What changed between my last two lab panels? | `compare_lab_panels` |
| 20 | When was my last blood test and from which lab? | `get_app_data` labs.documents |
| 21 | Did I log every dose last month? | `get_medications` doses, month |
| 22 | How much protein did I eat on average in September? | `get_metric_series` dietary_protein month |
| 23 | Am I hitting my calorie target? | `get_app_data` body.nutrition_adherence |
| 24 | How am I doing on my weight goal? | `get_app_data` body.goal |
| 25 | Is my data up to date? | `get_app_data` app.pipeline |
| 26 | Are there any data problems I should know about? | `get_app_data` app.data_quality |
| 27 | What did this morning's briefing mean by recovery? | `get_app_data` app.briefing |
| 28 | What were my weekly highlights for the last month? | `get_app_data` insights.reports weekly |
| 29 | Where did I run most this year? | `get_app_data` activity.coverage |
| 30 | What can you look up for me? | `list_capabilities` |
| 31 | How does my VO2 max relate to my weekly workout minutes? | `get_metric_relationship` vo2max × apple_exercise_time, or `get_metric_series` ×2 |
| 32 | Any workouts in 2024? (before the data) | `get_workouts` → `no_data_in_window`; answer states the coverage |

---

## 13. Migration and compatibility

- **Tool names.** `get_metrics` and `compare_periods` are removed in AN-D6, after
  `get_metric_series` (AN-D2) has carried both behaviours for four gates. No alias is kept: tool specs are sent fresh with every request, and the model's memory
  of earlier turns is their rendered text (`renderHistory`, `memory.ts`), not their tool calls.
  Stored turns do keep `toolsUsed` (up to 24 names, `conversation-rules.ts`) and the answer view
  prints them as words ("Tools used: get metrics"); an old name keeps rendering that way, so stored
  conversations need no migration. `get_workouts`, `get_medications`,
  `get_lab_results`, `compare_lab_panels`, `get_metric_relationship` keep their names; their old
  parameters (`days`) keep working.
- **`names.ts`** becomes a re-export of the manifest's tool list (`DATA_TOOL_NAMES`,
  `isDataTool`). **`AnswerView.tsx`** `DATA_LOOKUPS` is generated from `statusLabel`.
  **`sources/tagging.ts`** sets are generated from `sources`.
- **Existing tests.** `data-tools.test.ts`, `ondemand.test.ts`, `tool-loop.test.ts`,
  `systemPrompt.test.ts` and `stream-tools.test.ts` are migrated in the gate that changes the
  behaviour they pin; a test is never deleted without its behaviour being re-asserted elsewhere.
- **`ANALYST_CONTEXT`.** `full`: starting selection + coverage index + tools. `ondemand`: coverage
  index + tools, no selection. When tools are off or refused, both send the selection + index with
  the no-tools wording. The default stays `full` pending Q1.
- **`dataIndex.ts`** is replaced by the coverage index (AN-D5); `buildDataIndex` callers move.
- **Docs.** `docs/configuration.md` ("How the analyst gets your health data"), `README.md` (the
  analyst feature section), `docs/reference.md` and a new `docs/analyst.md` are written in AN-W1 from
  the shipped code. `docs/analyst-capabilities.md` is generated (AN-D5) and only regenerated, never
  hand-edited.

---

## 14. Gates

| Gate | Parent | Delivers |
|---|---|---|
| AN-D1 | AN-A1 | registry types, manifest, `window.ts`, `envelope.ts`, the seven existing data tools and five plan reads registered (behaviour unchanged), exemptions with every gap `tracked`, parity test |
| AN-D2 | AN-D1 | `get_metric_series`, rebuilt `get_workouts`, `get_sleep`, `get_blood_pressure`, `get_metric_relationship` window; number-rule walker; data tools offered in **both** modes (the owner's failure is fixable from here) |
| AN-D3 | AN-D2 | rebuilt `get_medications`, `get_lab_results` window, `get_training_sessions` window and marker; secret canary; source-removal test; tagging from the manifest |
| AN-D4 | AN-D3 | `get_app_data` with its fourteen capabilities; profile/pipeline/coverage projections; source-name rule |
| AN-D5 | AN-D4 | `list_capabilities`, static map, coverage index, selection labelling and wording, no strict routing for providers, renamed demo prompt, absence audit, per-question tool budget, generated disclosure and `docs/analyst-capabilities.md` |
| AN-D6 | AN-D5 | fake-model integration tests incl. the owner's scenario, the evaluation set (offline + live script), retire `get_metrics`/`compare_periods`, client labels from the manifest |
| AN-D7 | AN-D6 | close every `tracked` exemption, `ALLOW_TRACKED = false`, measured budgets recorded in the test |
| AN-W1 | AN-D7 | user and developer documentation |

---

## 15. Risks and open questions

**Q1. Should `ondemand` become the default?** It sends less per question and the model fetches what
it needs, but weaker models answer worse when they must plan calls. *Recommendation:* keep `full` as
the default (the deployed mode), which after this change also offers every tool; revisit with the
live evaluation (§12) numbers per mode.

**Q2. Per-category AI-privacy toggles.** The brief assumes lab/medication toggles exist; they do not.
*Recommendation:* ship the policy hook with `ALLOW_ALL` (no behaviour change), and add toggles only if
the owner asks, stored in the existing preferences row and shown on Settings → AI privacy.

**Q3. Profile notes reach the analyst for the first time.** Today only the briefing receives them. It
is the owner's own context ("read my heart rate with this medication in mind") and the reason the
field exists, but it is a new category leaving the machine on the hosted path. *Recommendation:*
include it (via `app.profile`, on demand, never pre-attached), list it in the generated disclosure,
and say so in the release notes.

**Q4. Cross-conversation recall** ("what did you tell me about my sleep last week?") is not a data
capability and stays out of scope. *Recommendation:* exempt with that reason; propose separately if
wanted.

**Q5. Workout-day vs rest-day relationship.** The failing question is best answered by a dedicated
comparison (sleep or HRV on nights after a workout vs other nights). *Recommendation:* not in this
design; with `get_workouts` + `get_sleep` the model can answer it, and the evaluation will show
whether a dedicated capability is worth adding.

Risks:

- **Prompt growth.** Map + index + ten tool specs add ~20 K characters to every tool-enabled turn.
  Bounded by tests (§8); a small local model with a short window may still struggle. Mitigation: the
  bounds, and `ANALYST_TOOLS=off` remains.
- **The audit's regex** can miss phrasing or flag a correct sentence. Mitigation: it only acts when a
  capability has records and was not looked up, gives one turn, and never rewrites model text.
- **Upstream latency.** A question that pages medications over a long window makes several upstream
  reads. Mitigation: the adapter cache and the per-question tool budget.
