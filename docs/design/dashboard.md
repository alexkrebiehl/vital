# Dashboard: custom cards (design)

Status: proposed design for 0.3.2 (gate A1), to be implemented in gates D1–D5. Design only: nothing here is
built yet. Every "verified" statement below was checked against the tree at `0119a25`
(`release/v0.3.2`); anything not checked is marked **unverified**.

[← Back to the README](../../README.md)

---

## 1. Goals, non-goals and extension points

**Goal.** A new **Dashboard** page where the reader adds cards for any registered health metric
for a chosen day or period, and arranges them. Overview stays exactly as it is.

**Phase 1 (this release)**

- One card type, `value`: one metric + one date spec, rendered 1×1 in a responsive grid.
- Date spec chosen when the card is added: **Today**, **Yesterday** (both rolling) or a **date
  range** (fixed start and end; 7/30/90-day quick picks fill the two dates).
- Add, **edit** (metric and date), remove, drag to reorder, and a full keyboard path to reorder.
- Width and height stored in grid units from day one; phase 1 renders 1×1 only.
- Separate card sets for demo and live mode.

**Non-goals (phase 1):** resizing, free placement, chart cards, multi-metric cards, comparison
cards, rolling "last N days" ranges, sharing or exporting a layout, more than one dashboard.

**Extension points (each one lands without a migration and without touching the page, the
store or the API):**

| Later feature | How it slots in |
|---|---|
| Larger value card (2×1, 2×2) | Add sizes to the `value` schema's `sizes`; its renderer reads `size`. `width`/`height` columns already exist. |
| Chart card | New card type `chart` (schema + UI, one registry line each), §4.3. |
| Large summary card | New card type, §4.3. |
| Rolling "last N days" | New `DateSpec` member `{ kind: 'trailing', days }`; existing rows stay valid. |
| A type's spec changes shape | Bump that type's `version`, add a `migrate` step; rows upgrade on read (§3.4). |
| Resize / free placement | Grid adapter swap (§9) plus additive nullable `grid_x`/`grid_y` columns. This one **is** an additive migration; it is not part of the phase-1 promise. |

## 2. Where things live

```text
src/lib/dashboard/               server-safe, no React
  types.ts                       DateSpec, CardSize, CardLayout, CardRecord, limits
  date-spec.ts                   validateDateSpec, resolveDateSpec, dateSpecLabel
  card-schemas.ts                CardTypeSchema registry (server + client)
  value-schema.ts                the `value` type's schema (validate, sizes, version)
  value-resolve.ts               spec + active dataset -> ValueCardData (pure)
  order.ts                       moveCard, move commands (pure)
  announce.ts                    every live-region sentence (pure)
  grid.ts                        gridSpanClasses (literal Tailwind classes)
  picker.ts                      pickerGroups for the metric picker (pure)
  client.ts                      fetch helpers for the browser
  http.ts                        shared route helpers (no-store, body, errors)
src/lib/db/dashboard-store.ts    Postgres access, injectable client
db/migrations/0015-dashboard-cards.sql
src/app/api/dashboard/cards/route.ts        GET, POST, PUT (order)
src/app/api/dashboard/cards/[id]/route.ts   PUT (replace), DELETE
src/app/dashboard/page.tsx                  thin server page
src/components/dashboard/
  DashboardPage.tsx              container: data hook, dialogs, announcer
  DashboardView.tsx              pure view: loading / error / empty / grid
  DashboardGrid.tsx              the ONLY file importing @dnd-kit
  CardShell.tsx                  frame, title, drag handle, options menu
  CardDialog.tsx                 add + edit (type chooser, editor, preview)
  MetricPicker.tsx, DateSpecPicker.tsx
  card-types/index.ts            CardTypeUi registry
  card-types/value.tsx           value card: resolve wiring, renderer, editor
  dashboard-state.ts             pure reducer behind useDashboard
  useDashboard.ts, Announcer.tsx
```

The split between `src/lib/dashboard/card-schemas.ts` (no React) and
`src/components/dashboard/card-types/` (React) is deliberate: the API routes validate specs with
the schema half and must never bundle Recharts or components.

## 3. Data model

### 3.1 Types

```ts
// src/lib/dashboard/types.ts
export type DashboardMode = 'demo' | 'live';          // = DataMode from adapters/dataset

/** Inclusive calendar day keys, YYYY-MM-DD, in the dataset's own day convention. */
export type DateSpec =
  | { kind: 'today' }
  | { kind: 'yesterday' }
  | { kind: 'range'; start: string; end: string };

export interface CardSize { w: number; h: number }     // grid units, 1..4 each
export interface CardLayout extends CardSize { order: number }

export interface ValueCardSpec { metricId: string; date: DateSpec }

export interface CardRecord<S = unknown> {
  id: string;                 // 'card-<uuid>'
  type: string;               // 'value' in phase 1
  spec: S | null;             // null only when status is 'unreadable'
  schemaVersion: number;      // version of `spec` for its type
  layout: CardLayout;
  revision: number;           // per card, for edit/delete concurrency
  createdAt: string;
  updatedAt: string;
  status: 'ok' | 'unreadable';
  problem?: string;           // plain-words reason when unreadable
}

export const MAX_CARDS_PER_MODE = 48;
export const MAX_SPEC_BYTES = 2048;
```

### 3.2 Table (migration `0015-dashboard-cards.sql`)

```sql
CREATE TABLE IF NOT EXISTS dashboard_cards (
  id             TEXT        PRIMARY KEY,
  mode           TEXT        NOT NULL CHECK (mode IN ('demo', 'live')),
  card_type      TEXT        NOT NULL CHECK (card_type ~ '^[a-z][a-z0-9-]{0,31}$'),
  spec           JSONB       NOT NULL CHECK (jsonb_typeof(spec) = 'object'
                                             AND octet_length(spec::text) <= 2048),
  schema_version INTEGER     NOT NULL CHECK (schema_version >= 1),
  position       INTEGER     NOT NULL CHECK (position >= 0),
  width          SMALLINT    NOT NULL DEFAULT 1 CHECK (width BETWEEN 1 AND 4),
  height         SMALLINT    NOT NULL DEFAULT 1 CHECK (height BETWEEN 1 AND 4),
  revision       INTEGER     NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT dashboard_cards_mode_position UNIQUE (mode, position)
    DEFERRABLE INITIALLY IMMEDIATE
);
```

Decisions:

- **No health data.** The row holds an id, a mode, a type, a spec (a metric id and day keys), a
  layout and timestamps. Values are computed in the browser from the active dataset every render.
  The migration header restates the 0001 rule, as 0014 does.
- **`card_type` is not an enum.** A new type needs no migration; the application's schema
  registry is what decides which types are valid (400 on unknown at write time).
- **`spec` is JSONB, validated by the type's schema** on every write and every read. The DB
  CHECKs only bound its shape and size.
- **`width`/`height` 1..4**: the widest grid is 4 columns (§8.3). A future 6-column grid would
  need to widen the CHECK; that is the one size change this design does not pre-pay.
- **`UNIQUE (mode, position) DEFERRABLE`**: positions never collide, and the single-statement
  reorder (§7.3) can permute them because a deferrable unique constraint is checked at the end of
  the statement, not per row. Deletes leave gaps; order is `ORDER BY position, id`.
- Probed in PGlite 0.5.8 (PostgreSQL 18.3 compiled to WASM, in a scratch directory; the
  deployment runs `postgres:16-alpine`, not probed): the table above is created as written; each
  CHECK refuses its bad row (width 5, an unknown mode, an array spec, `Value`, a duplicate
  position); and a swap of two positions under a NON-deferrable unique constraint fails with a
  duplicate-key error, which is why the constraint is deferrable.
- Rejected: layout as JSONB (loses the CHECKs and the column the reorder statement writes);
  one row per dashboard with a JSON array of cards (every edit rewrites everything and two tabs
  clobber each other); a separate `date_spec` column (some future types need two windows or none).

### 3.3 Per-mode keying

- The **server** decides the mode, from `readDataMode()` (`VITAL_DATA_MODE`, verified in
  `src/lib/adapters/runtime.ts`). The browser never sends a mode; every query is `WHERE mode = $1`.
- Demo and live therefore never share cards. Switching the environment from demo to live shows an
  empty live dashboard; the demo cards stay in the table and reappear if demo mode returns.
- A card whose metric has no data in the current mode **stays** and shows its unavailable state
  (§6.4). Nothing is ever deleted because of data availability.
- A card id from the other mode answers 404 on edit and delete.

### 3.4 Versioning

- Each type has a current `version`. Every write stores `schema_version = version`.
- On read, the store hands the row to the schema registry:
  - unknown `card_type` → `status: 'unreadable'`, "This card was made by a newer version of
    Vital, or its type was removed.";
  - `schema_version` greater than the type's `version` (a downgrade) → unreadable, "This card was
    saved by a newer version of Vital.";
  - older version → `migrate(spec, from)` in memory, then validate; the upgraded spec is written
    back only on the card's next edit (no bulk rewrite, no migration);
  - spec fails validation → unreadable, with the validator's reason.
- Unreadable cards are **served, never dropped or rewritten**; the page shows them with Remove
  only. (Contrast `quality_silenced`, which drops unknown rows: a silenced finding is invisible by
  nature, a card is something the reader placed.)

## 4. Card type registry

### 4.1 Interfaces

```ts
// src/lib/dashboard/card-schemas.ts — server and client
export interface CardTypeSchema<S> {
  type: string;                                 // 'value'
  version: number;                              // 1
  label: string;                                // 'Value' (type chooser)
  sizes: readonly CardSize[];                   // value: [{ w: 1, h: 1 }]
  defaultSize: CardSize;                        // must be in sizes
  validate(input: unknown): { ok: true; spec: S } | { ok: false; errors: string[] };
  migrate(spec: unknown, from: number): unknown;  // identity at `version`
}

// src/components/dashboard/card-types/types.ts — client
export interface ResolveContext { referenceKey: string; system: UnitSystem }
export interface CardTypeUi<S, D> {
  type: string;
  resolve(spec: S, ctx: ResolveContext): D;     // pure: spec + active dataset -> view data
  Card: ComponentType<{ spec: S; data: D; size: CardSize }>;               // renderer
  Editor: ComponentType<{ value: S | null; onChange(spec: S | null): void }>; // dialog body
  describe(spec: S): string;                    // accessible name: 'Steps, today'
}

export type CardTypeDefinition<S, D> = CardTypeSchema<S> & CardTypeUi<S, D>;
```

`getCardSchema(type)`, `listCardSchemas()`, `getCardUi(type)` are the only lookups. The page,
the dialog, the store and the routes never name a type.

### 4.2 Phase 1: `value`

- Schema: `version 1`, sizes `[1×1]`, spec `{ metricId, date }`, unknown fields refused.
  `metricId` must be registered (`getMetric`) and its `aggregationStrategy` must be one the value
  resolver supports (`avg | sum | latest | min | max`; no registered metric uses `count`, verified,
  and a guard test fails the day one does). `date` goes through `validateDateSpec` (§5.1).
- UI: `resolve` = `resolveValueCard` (§6); `Card` = `ValueCard`; `Editor` = `MetricPicker` +
  `DateSpecPicker`; `describe` = `"<displayName>, <date label>"`.

### 4.3 How later types register (sketches, not built)

**`chart`** (2×2 and 4×2): spec `{ metricId, date: DateSpec, version 1 }`. `resolve` returns the
points for the window; `Card` picks the existing chart by metric shape: `MetricChart` for scalar,
`BloodPressureChart` for the pair, `SleepStageChart` for sleep (the owner's rule: a chart carries
the real structure of the data). Files: `src/lib/dashboard/chart-schema.ts`,
`src/components/dashboard/card-types/chart.tsx`, plus one line in each registry.

**`large`** (a 2×2 summary): spec `{ metricId, date }`, renderer shows value, coverage, the
change against the previous window using the existing `compareWindows` (complete days only).

Both arrive with no edit to `DashboardPage`, `DashboardGrid`, the store, the routes or the
migration: the dialog shows a type chooser as soon as the registry holds more than one type, and
the grid spans a card by its stored `w`/`h`. A test registers a fake type and round-trips it
through POST and GET to prove that (§11).

## 5. Date resolution

### 5.1 Validation (`validateDateSpec`, pure, server and client)

- `kind` is one of the three; no other field allowed.
- `start`/`end` match `^\d{4}-\d{2}-\d{2}$` and are real calendar dates
  (`addDays(key, 0) === key`; verified that `2026-02-30` comes back as `2026-03-02`, so it is
  refused), `start <= end`, and the span is at most `MAX_CUSTOM_DAYS` (3650, reused from
  `src/lib/ranges.ts`).
- The server does not know the reference day, so it does not refuse a future `end`; the dialog
  caps the date inputs at the reference day and the resolver handles a future range (§6.4).

### 5.2 Resolution (`resolveDateSpec(spec, referenceKey)`, pure)

There is no second notion of "today". `referenceKey` is always `REFERENCE_KEY` from
`src/lib/adapters/dataset.ts`: the dataset's `referenceDate` as a day key in `REFERENCE_TZ`
(verified). In live mode that is the current day in the dataset timezone (the live adapter sets
`referenceDate` to now, verified in `live.ts`); in demo mode it is the fixtures' reference day.

| Spec | Window (`DayWindow`, inclusive) |
|---|---|
| `today` | `[ref, ref]` |
| `yesterday` | `[addDays(ref, -1), addDays(ref, -1)]` |
| `range` | `[start, end]`, exactly as stored |

Returns `{ window, kind, includesReferenceDay, afterReference, label }` (`afterReference`:
`start > ref`). Day keys are timezone-free strings,
so a stored range never shifts when the timezone changes; observations are already keyed by
`canonicalDayKey` in `REFERENCE_TZ`. Selection uses `selectByWindow` / `containsDay` (string
comparison, no `Date` maths).

Labels always carry a year (the app's own rule against a bare "Sep 16"): `Today · Oct 8, 2026`,
`Yesterday · Oct 7, 2026`, `Sep 1 – Sep 7, 2026` (same year: `formatDayKeyShort` – `formatDayKeyLong`),
`Dec 28, 2025 – Jan 3, 2026` (years differ). `windowRangeLabel` alone omits the year, so
`dateSpecLabel` wraps the same `formatDayKey*` helpers instead of using it directly.

A page left open across midnight re-resolves Today on the next render or navigation, like every
other page (the reference day moves when the dataset is re-read).

## 6. Value resolution (`resolveValueCard`, pure)

### 6.1 Inputs and output

Input: `ValueCardSpec`, `ResolveContext`; reads the active dataset through `seriesFor`,
`bloodPressureSeries`, `metricHasData`, `unavailableReasonFor`, `excludePartialForSum`.
Output: every string is already formatted, so the renderer holds no numbers.

```ts
type ValueCardData =
  | { state: 'value'; dateLabel: string; headline: string; qualifier: string;
      detail?: string; note?: string; spark?: { kind: 'line'; values: number[] }
                                           | { kind: 'pair'; readings: BloodPressureObservation[] } }
  | { state: 'no-reading'; dateLabel: string; reason: string }
  | { state: 'unavailable'; dateLabel: string; reason: string }
  | { state: 'unknown-metric'; reason: string };
```

### 6.2 Aggregation by `aggregationStrategy`

Daily points are grouped by day key first (if a series ever holds two points for a day, the day's
value is `aggregate(sameDay, strategy)`; D3 adds a fixture test that no listed metric
currently has duplicates). Then, over the window:

| Strategy | Single day (today / yesterday) | Range |
|---|---|---|
| `sum` | the day's total. Today: qualifier **"So far today"**, never compared. | **Total** of complete days; detail "Avg <x> per day with a reading". The reference day and any `partial` day are excluded (`excludePartialForSum`), note "Today excluded (still in progress)." and/or "n incomplete days excluded." |
| `avg` | the day's value | mean of daily values; qualifier "Average · n days with readings" |
| `latest` | the day's value | last daily value in the window; qualifier "Latest · <date>" |
| `min` / `max` | the day's value | lowest / highest daily value with its date (no registered metric uses these today; supported so a new one needs no resolver change) |

Formatting: `formatMetricWithUnit`, except duration aggregates (`DURATION_AGGREGATE_METRIC_IDS`,
range only) through `formatDurationAggregate`, which is the app's h:mm rule. Days without a
reading are absent, never zero: averages divide by days **with** readings and say how many.

### 6.3 Paired and non-scalar metrics (both supported in phase 1)

- **Blood pressure** (`isPairedMetric`): read only through `bloodPressureSeries()` and
  `bloodPressureInWindow`; a reading missing a number is already dropped. Strategy is `latest`:
  single day → the day's last reading, `formatBloodPressure` (`111/71 mmHg`), qualifier "Latest of
  n readings" when n > 1; range → the last reading in the window plus detail "Average 112/72 mmHg ·
  n readings" from `bloodPressureStats` (each series separately). Never one number.
- **Sleep** (`sleep_analysis`, time asleep): `seriesFor` already keeps only nights with a stage
  split and keys a night by its waking day, so Today means last night. Range → "Average · n
  nights". **No sparkline** for sleep: the owner's rule is that sleep is drawn with its stages, and
  a single line would not be. The stage view is the future `chart` card's job.
- `sleep_in_bed` and every other metric are scalar.

Sparkline: only for a **range** with at least 2 daily values (`Spark`), or 2 complete readings
for blood pressure (`BloodPressureSpark`); never for a single day, never for sleep. Decorative
(`aria-hidden`), because the text already states the value and its coverage. It is cheap: both
components exist and take plain arrays.

### 6.4 States (exact copy)

Checked in this order:

1. Metric id not registered → `unknown-metric`: "This metric is not part of this version of Vital."
2. `metricHasData(id)` is false in the active dataset → `unavailable`, reason =
   `unavailableReasonFor(id)` (demo: the registry's reason or the generic demo sentence; live: "No
   readings of this metric are recorded."). This is also what a card shows after its source is
   removed: the data is gone, the card is not.
3. Range wholly after the reference day → `no-reading`: "These dates are after the latest day in
   the data (<ref long>)."
4. No point in the window → `no-reading`: single day "No <metric> reading on <date>."; Today and a
   `sum` metric "Nothing recorded yet today."; range "No <metric> readings between <start> and
   <end>."
5. Range of a `sum` metric whose only readings are excluded partial days → `no-reading`: "The
   only reading in this range is today's, which is still in progress."
6. Otherwise `value`.

No state ever renders `0`, `—` as a value, or a value of another day presented as this one.

## 7. API

All routes: `dynamic = 'force-dynamic'`, `Cache-Control: no-store, private`, JSON bodies,
unknown fields refused, **503** with `NO_DATABASE_CONFIGURED_REASON` when `getPool()` is null
(the silence route's behaviour), **500** with the message for other store failures, never a
secret. The mode is `readDataMode()` on the server.

### 7.1 Routes

| Method and path | Body | Success | Errors |
|---|---|---|---|
| `GET /api/dashboard/cards` | — | 200 `{ mode, cards: CardRecord[], limits: { maxCards } }`, in order | 503, 500 |
| `POST /api/dashboard/cards` | `{ type, spec, size? }` | 201 `{ card }`, appended at the end | 400 invalid, 409 at `MAX_CARDS_PER_MODE`, 503 |
| `PUT /api/dashboard/cards` | `{ order: string[] }` | 200 `{ cards }` | 400 shape, 409 set mismatch, 503 |
| `PUT /api/dashboard/cards/:id` | `{ spec, size?, revision }` | 200 `{ card }` (revision + 1) | 400, 404 (unknown or other mode), 409 `{ error, card }` stale, 503 |
| `DELETE /api/dashboard/cards/:id?revision=N` | — | 200 `{ id }` | 400, 404, 409 stale, 503 |

Shapes follow `/api/activity-maps` (PUT on the collection reorders, `?revision=` on DELETE,
verified). The type cannot change on PUT (`spec` is validated against the stored `card_type`);
`size` must be in the type's `sizes`. `revision` is a whole number ≥ 1 (`revisionOf`, reused).

### 7.2 Validation (400 with a sentence naming the problem)

Body not JSON; unknown field; unknown `type`; spec refused by the type's `validate` (unknown
metric, unsupported strategy, bad date spec, unknown spec field); `size` not offered by the type;
spec larger than `MAX_SPEC_BYTES`; `order` not an array of strings.

### 7.3 Concurrency

- **Create**: one `INSERT … SELECT` that appends at `coalesce(max(position) + 1, 0)` and inserts
  only while the mode holds fewer than `MAX_CARDS_PER_MODE` rows (no row returned → 409). Two
  creates racing on the same position hit the unique constraint (`23505`); the store retries once.
- **Edit / delete**: `WHERE id = $1 AND mode = $2 AND revision = $3`; no row → re-read to answer
  404 or 409 (the activity-maps pattern). A 409 on PUT returns the current card so the dialog can
  say what changed.
- **Reorder**: one statement, so it is atomic without a transaction client:

```sql
WITH wanted AS (
  SELECT o.id, (o.ord - 1)::int AS position
    FROM unnest($2::text[]) WITH ORDINALITY AS o(id, ord)
), cur AS (
  SELECT id FROM dashboard_cards WHERE mode = $1
), ok AS (
  SELECT (SELECT count(*) FROM cur) = cardinality($2::text[])
     AND (SELECT count(DISTINCT id) FROM wanted) = cardinality($2::text[])
     AND NOT EXISTS (SELECT 1 FROM wanted w LEFT JOIN cur c USING (id) WHERE c.id IS NULL) AS valid
)
UPDATE dashboard_cards d
   SET position = w.position, updated_at = now()
  FROM wanted w, ok
 WHERE d.mode = $1 AND d.id = w.id AND ok.valid
RETURNING d.id
```

  The list must name every card of the mode exactly once; otherwise nothing changes and the route
  answers 409 "The order must name every card exactly once; reload and try again." Reorder is
  idempotent and does **not** bump card revisions (a reorder in one tab must not make an open edit
  in another tab stale). A create racing a reorder cannot collide: a new card's position is above
  every existing one, and a reorder assigns `0..n-1 ≤ max`. The existing `reorderMaps` reads then
  writes in two statements; the dashboard does not copy that.
- Probed in the same PGlite instance: the append statement numbered three cards 0, 1, 2 per mode
  and returned no row at the cap; the reorder statement applied a full permutation (every row
  moved) and changed nothing, returning zero rows, for a missing id, a duplicate id, an id from the
  other mode and an unknown id.

## 8. UI architecture

### 8.1 Route and navigation

- Route `/dashboard`: `src/app/dashboard/page.tsx` (metadata `Dashboard — Vital`) mounts
  `<DashboardPage />`, like every other page.
- `nav.ts`: a new top-level section **second**, right after Overview:
  `{ id: 'dashboard', label: 'Dashboard', href: '/dashboard', icon: LayoutGrid, description:
  'Your own cards for any metric', placement: 'main' }`. Not `primary`: the mobile bottom bar
  keeps its four entries and Dashboard is under More (open question Q1). The sidebar, mobile nav,
  command palette and breadcrumbs all read this table (stated in its header; checked for the
  mobile nav), so one entry covers them.
  `LayoutGrid` exists in the installed lucide-react (verified).

### 8.2 Page states (`DashboardView`, a pure view tested by static markup)

| State | Shown |
|---|---|
| Loading (config fetch) | Header + three `Skeleton` cards in the grid. Card values never load: they resolve synchronously from the dataset already installed by `DatasetProvider`. |
| 503 | `ErrorState`: "The dashboard is stored in the database, and no database is configured." + the server's reason. |
| Other error | `ErrorState` with the message and **Retry**. |
| Empty | `EmptyState` "No cards yet", "Add a card for any metric, for today, yesterday or a date range.", **Add card**. No seeded or sample cards. |
| Cards | Header (`DomainHeader`, category `overview`) with **Add card**, then the grid. A failed write shows a `DataStateNote` notice and reloads (the activity-maps pattern). |

### 8.3 Grid

CSS grid: 1 column under 640 px, 2 from `sm`, 3 from `lg`, 4 from `xl`; `auto-rows` with a fixed
minimum card height so 1×1 cards line up. A card spans `min(w, columns)` × `h` through a pure
`gridSpanClasses(size)` that returns literal Tailwind class strings (JIT needs literals). No
`grid-auto-flow: dense`: visual order must equal DOM order, which is the keyboard and
screen-reader order.

### 8.4 Card shell (`CardShell`)

`<article aria-labelledby>` on `Card`, category colour rule (`CATEGORY_VAR` via `artCategoryOf`).
Header: metric name, date label, then two always-visible controls (no hover-only controls, touch
must work): a **drag handle** (`GripVertical` button, `aria-label="Move <describe>"`, the
`touch-action: none` element, so the rest of the card still scrolls the page) and an **options
menu** (the `MapCard` menu pattern): Edit, Move earlier, Move later, Move to start, Move to end,
Remove. Body: the type's `Card` renderer. Footer: "Open detail" link to `/metric/<id>` for value
cards. An unreadable card gets the shell with its `problem` text and Remove only.

### 8.5 Value card renderer (`ValueCard`)

Date label, headline (large `tnum`), qualifier, optional detail and note, optional sparkline.
The no-reading and unavailable states keep the card's place and size, title "No reading" or
"Not available", and the reason sentence (§6.4). No source name anywhere.

### 8.6 Add / edit dialog (`CardDialog`, on the existing `Dialog` primitive)

One scrolling dialog (focus trap, Escape and focus restore come from `Dialog`, verified), not a
wizard:

1. **Type** chooser, rendered only when the registry holds more than one type (hidden in phase 1).
2. **Metric** (`MetricPicker`): search box (`searchMetrics`, names and aliases) above radio groups,
   one `fieldset`/`legend` per category in `getCategories()` order. Offered metrics are
   `listedMetrics(getAllMetrics(), activeSources, metricHasData)` (verified, as Trends uses it);
   a metric with no data is still offered, marked "no data", like Trends. No source names.
   Pure helper `pickerGroups(query, activeSources, hasData)`.
3. **Date** (`DateSpecPicker`): `SegmentedControl` Today | Yesterday | Date range. Range: two
   labelled `<input type="date">` with `max` = reference day; quick picks **7D / 30D / 90D**
   (`RANGE_PRESET_DAYS`) fill start/end as `[ref − (n − 1), ref]` via a pure `quickPickRange`, and
   the hint states the dates are fixed: "This card will keep showing Oct 2 – Oct 8, 2026." Inline
   errors from `validateDateSpec`, linked with `aria-describedby`.
4. **Preview**: the type's real `Card`, resolved with the real `resolve`, at the default size.
5. **Add card** / **Save changes** (disabled until valid), **Cancel**.

**Edit is in scope.** It reuses this dialog prefilled, and saves with PUT, so the card keeps its id
and position; without it, changing a date means remove + re-add + re-drag. The extra cost is one
route and one `mode` prop on a dialog that exists anyway.

### 8.7 Reordering

- **Pointer / touch drag** through `DashboardGrid` (dnd-kit, §9): handle-only activation (6 px
  distance), `DragOverlay` for the lifted card, drop → `moveCard(ids, from, to)` → optimistic order
  → `PUT order`; a failure restores the server order and shows the notice.
- **Keyboard drag**: dnd-kit's `KeyboardSensor` on the same handle (Space/Enter lifts, arrows move
  with `sortableKeyboardCoordinates`, Space/Enter drops, Escape cancels).
- **Keyboard and screen-reader commands**: the menu's Move earlier / later / to start / to end.
  These are the guaranteed path (deterministic, discoverable, no spatial reasoning) and the ones
  fully covered by node tests; the keyboard drag is the faster path for sighted keyboard users.
- After a move, focus returns to the moved card's menu button; after Remove, to the next card's
  menu button, else the previous one, else **Add card**; after Add, to the new card's menu button.
- **Announcements**, one polite live region (`Announcer`) for commands, and dnd-kit's own region
  for drags fed by the same pure strings from `announce.ts`: "Picked up Steps, today. Position 2 of
  6.", "Steps, today moved to position 4 of 6.", "Steps, today dropped at position 4 of 6.", "Move
  cancelled. Steps, today is back at position 2 of 6.", "Removed Steps, today.", "Added Steps,
  today at position 7 of 7."
- Remove has no confirmation, matching Activity maps: a card is configuration, re-adding it takes
  seconds, and it holds no data. (Open question Q4.)

### 8.8 Reused and new

Reused: `Card`, `Button`, `Badge`, `Dialog`, `SegmentedControl`, `EmptyState`, `ErrorState`,
`Skeleton`, `DataStateNote`, `DomainHeader`, `Spark`, `BloodPressureSpark`, `CATEGORY_VAR`,
`artCategoryOf`, `useUnits`, `useDatasetMeta`, `listedMetrics`, `searchMetrics`,
`getCategories`, every formatter in `metrics/format.ts`, the `analytics/windows` helpers,
`bloodPressureStats`, `excludePartialForSum`, `RANGE_PRESET_DAYS`, `MAX_CUSTOM_DAYS`, the
activity-maps request and menu patterns. New: everything listed in §2, plus two dependencies (§9).
Not reused: `SeriesCard`/`TotalCard`/`SummaryCard` (fixed to trailing windows and comparisons, or
too bare); the chart components wait for the `chart` type.

## 9. Drag-and-drop decision

**Choice: `@dnd-kit/core` 6.3.1 + `@dnd-kit/sortable` 10.0.0 + `@dnd-kit/utilities` 3.2.2,
pinned exactly, used only inside `DashboardGrid.tsx`.** All reorder logic, focus rules and
announcement text live in our own pure modules, so a later library swap touches one file.

Evidence, gathered 2026-10-08 from `registry.npmjs.org` (`/latest` and full documents),
`bundlephobia.com/api/size`, and a scratch install outside the repo. The app runs React 19.3.0
and Next 15.5.25 (read from `node_modules`).

| Candidate | Version (published) | Licence | React 19 | min+gzip | Keyboard / SR | Growth to resize / free placement |
|---|---|---|---|---|---|---|
| **@dnd-kit/core + sortable** | 6.3.1 (2024-12-05), 10.0.0 (2024-12-04) | MIT | peer `react >=16.8.0`; scratch install with react 19.3.0 resolved clean (`npm ls`); a `DndContext` + `SortableContext` + `useSortable` tree server-rendered without error under 19.3.0 | 14.2 KB + 3.7 KB | KeyboardSensor, custom announcements, live region; handle got `aria-roledescription="sortable"` and `aria-describedby` in the probe | Sortable grid with mixed sizes yes; resize and free placement not built in |
| @dnd-kit/react | 0.5.0 (2026-06-11), betas to 2026-09-12 | MIT | peer `^18 \|\| ^19` | 33.1 KB | same model | same; pre-1.0 API still moving |
| react-grid-layout | 2.3.0 (2026-10-05) | MIT | peer `react >= 16.3.0` | 24.8 KB | its 42 KB README never mentions keyboard or accessibility | best: resize, x/y placement, compaction |
| @atlaskit/pragmatic-drag-and-drop | 4.0.0 (2026-09-24) | Apache-2.0 | no React peer | not measured (bundlephobia rate-limited) | no keyboard drag by design; the a11y helper package depends on `@emotion/react` and Atlaskit design-system packages | lists/trees; no grid layout |
| @hello-pangea/dnd | 18.0.1 | Apache-2.0 | peer `^18 \|\| ^19` | not measured | keyboard dragging (**unverified** here) | lists only (**unverified** here) |
| Native HTML5 DnD | — | — | — | 0 | no keyboard, weak touch | everything hand-built |
| Hand-rolled keyboard-only | — | — | — | 0 | complete, testable | no pointer drag: fails the ask on its own |

Licences: MIT and Apache-2.0 are both compatible with AGPL-3.0-only (the project licence,
verified in `package.json`).

Why dnd-kit: it is the only option that gives pointer, touch and keyboard dragging with
screen-reader announcements for a **grid**, at about 18 KB, under licences we can ship. The
6.x line is mature and not deprecated. Its last release is from December 2024, which is age,
not breakage; the peer range admits React 19 and the probe rendered under it.

Rejected: `@dnd-kit/react` (pre-1.0; revisit at 1.0, the pure modules make that a one-file
change); react-grid-layout now (no keyboard path, which is required) but it is the planned route
to resize and free placement, behind the same `DashboardGrid` boundary with our own keyboard
commands kept; pragmatic-drag-and-drop (no keyboard drag, heavy a11y helper); `@hello-pangea/dnd`
(list-oriented); native DnD and hand-rolled-only (do not meet the ask).

Implementation notes for D5: pass a stable `id` to `DndContext` (the probe's `aria-describedby`
was a module counter, `DndDescribedBy-0`, a hydration-mismatch risk); `DashboardGrid` is a client
component; handle-only listeners; `DragOverlay`; announcements from `announce.ts`.

## 10. Rules compliance checklist

| Rule | How the design meets it | Test |
|---|---|---|
| Every number through the registry formatter | Resolver returns formatted strings only; renderer has no numbers | resolver outputs equal formatter output for each strategy |
| No zero for missing data | Explicit `no-reading` / `unavailable` states; averages over days with readings | every registered metric on an empty dataset renders no `>0<` and a reason |
| Never invent a value, score or conclusion | No colours for good/bad, no thresholds, no change badge in phase 1 | view markup has no score/assessment words |
| No data-source names outside Settings | Picker uses `listedMetrics`; reasons come from `unavailableReasonFor` | render picker and cards with `activeSources: ['hae','oura']`, assert no source display names |
| Demo and live never share cards | Server-side `mode` column from `readDataMode()` | route test with each `VITAL_DATA_MODE` |
| Unavailable metric keeps its card | State 2 in §6.4; nothing deletes on read | store + resolver tests |
| Source removal | Cards hold metric ids only, nothing to erase; they show the unavailable state | docs row + resolver test |
| No health data in Postgres | Columns in §3.2; migration header; statement guard | migration test + store statement test |
| Routes: validation, 400, 503, revision, atomic reorder | §7 | route tests |
| Partial day never compared | Today's sum labelled "so far"; ranges exclude it | resolver tests |
| Accessible arranging | Menu commands, keyboard drag, live announcements, focus rules | `order.ts` + `announce.ts` tests, markup tests |
| Public repo | No hostnames, paths or names in docs | the release grep |

## 11. Test strategy

Node environment, `renderToStaticMarkup`, no DOM (verified in `vitest.config.ts`): interaction is
designed as pure functions so it can be tested here, and components are split into container and
pure view, as the Settings connection views already are.

| Layer | Tests |
|---|---|
| `date-spec` | valid kinds; impossible dates; start > end; span cap; unknown kind/field; resolution for today/yesterday/range with explicit reference keys, across month and year ends; a reference key computed after 00:00 UTC in a negative-offset zone stays on the local day; labels always carry a year |
| `value-resolve` | each strategy, single day and range, with synthetic datasets via `setActiveDataset` (reset after); sum today "so far"; range excluding the reference day and `partial` days; duplicate-day grouping; blood pressure single day with several readings and range average (regression: `111/71` shows both numbers); sleep in-bed-only nights not counted, no spark; the six states in order; unknown metric |
| `card-schemas` | ids unique; default size in sizes; each schema validates its own example; migrate is identity at `version`; unknown type and future version give unreadable; every registered metric's strategy is supported |
| migration | exact column list, CHECKs, deferrable unique, header numbering (extend `migrations.test.ts`) |
| store | in-memory fake pool matching the statements (the `quality-silenced-store.test.ts` style); mode scoping; append position; cap; create retry on `23505`; stale revision → conflict; reorder is ONE statement and refuses a wrong set; unreadable rows served, not dropped; no statement carries a value-like column |
| routes | injected pool (`vi.mock('@/lib/db/pool')`, as the silence route test does): every 400 in §7.2, 503 with no pool, 404 for another mode's card, 409 with the current card, reorder 409, `Cache-Control`, mode from env; a fake card type registered in the test round-trips POST/GET with no route change |
| `order.ts`, `announce.ts`, `dashboard-state.ts` | `moveCard` bounds and no-ops; menu move targets; every announcement string; the page state reducer (load, add, edit, remove, reorder, revert on failure) |
| views | `DashboardView` each state; `CardShell` controls and labels; `ValueCard` each data state; unreadable card has Remove only; picker grouping, search, "no data" mark, no source names; date picker quick picks and fixed-dates hint; preview present |
| nav | `/dashboard` resolves to `['Dashboard']`; section index 1; not primary; `flattenNav` unique |
| guards | no zero for missing data across all registered metrics; no source names in dashboard markup |

## 12. Implementation gates

Briefs live outside the repo (`dash-D1.md` … `dash-D5.md`). Each gate ends green (`tsc`, lint,
full suite) and is reviewable alone. Baseline at `0119a25`: 172 files, 2329 tests, green in a
clean environment.

| Gate | Parent | Scope |
|---|---|---|
| D1 | A1 (this document) | types, `date-spec`, schema registry + `value` schema, migration 0015, store |
| D2 | D1 | `http.ts`, the two route files, `client.ts` |
| D3 | D2 | `value-resolve`, `/dashboard` page, view, grid without drag, card shell, value card, UI registry, data hook (read only) |
| D4 | D3 | add/edit dialog (type chooser, metric picker, date picker, preview), add/edit/remove wiring, announcer |
| D5 | D4 | dnd-kit, keyboard commands, announcer, focus rules, nav entry, docs, guard tests |

## 13. Risks and open questions

**Risks**

- *dnd-kit 6.x has had no release since December 2024.* Mitigation: one file
  imports it; pure logic is ours; `@dnd-kit/react` at 1.0 or react-grid-layout are drop-in
  replacements at that boundary.
- *Mixed card sizes with dnd-kit sortable can animate oddly.* Phase 1 is uniform 1×1; when sizes
  arrive, use `DragOverlay` with a drop indicator and no sibling transforms.
- *Client-side resolution cost.* Each card filters one series; 48 cards × ~2 years of daily
  points is small. Measure in D3 with the largest fixture; memoize per render if needed.
- *Removing without confirmation* can surprise; mitigated by focus and announcement, see Q4.

**Open questions for the owner (each with a recommendation)**

- **Q1. Mobile bottom bar.** Put Dashboard in the bottom bar (five entries + More) or under
  More? *Recommend under More for 0.3.2*, promote once he uses it daily.
- **Q2. Quick picks are fixed dates.** By decision a range is fixed, so "Last 7 days" added on
  Oct 8 keeps showing Oct 2 – Oct 8. *Recommend keeping that, with the hint text in §8.6*, and
  adding a rolling `trailing` date kind later if he wants cards that move (no migration needed).
- **Q3. Default content.** A new dashboard starts empty. *Recommend empty*: seeding cards would be
  a choice made for him.
- **Q4. Remove confirmation.** *Recommend no confirmation* (matches Activity maps; a card holds no
  data). If he wants a safety net, an Undo in the notice is cheaper than a dialog.

No other question blocks D1.
