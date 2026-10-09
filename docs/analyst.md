# The AI Analyst

What the AI Analyst can see, how it gets your data, what it says when something is missing, and
how a developer adds to what it can see ([Adding a capability](#adding-a-capability)).

[← Back to the README](../README.md)

---

# The AI Analyst

The AI Analyst is a careful health analyst and personal coach that reads the data your app has
recorded. It explains patterns, compares periods and suggests what to track or ask a clinician. It
is not a clinician: it does not diagnose, prescribe, or comment on whether a medication or dose is
right.

You ask in ordinary language on the **Analyst** page. How to connect a model, and the settings that
shape it, are in [Configuration](configuration.md#ai-analyst-configuration). This page covers what
the analyst can see and how to read what it tells you.

## What the AI Analyst can see

It can read the capabilities below, for any day or period. Each one is a read-only lookup. For
dates, every row means the same thing: whatever the app holds, from your first recorded day. A
single lookup spans at most 730 days, so a longer period is read in more than one lookup.

| Area | What it can read | What it does not hold |
|---|---|---|
| Metrics | One to three daily metrics (heart, activity, body, nutrition, sleep minutes) over any window: a summary, the daily, weekly or monthly points, and the change against the window before or one you name | Blood pressure and sleep stages (see Heart and Sleep) |
| Metrics | How two metrics move together over a period, as an association with its strength and sample size | A cause. It never says one metric caused another |
| Sleep | Each night: bedtime and wake time, time asleep and in bed, and the deep, core, REM and awake split. You can sort to find the deepest or latest nights | Stages for a night recorded only as time in bed |
| Sleep | Sleep over a window in a few lines: nights, mean time asleep, in bed and each stage, by week or month, and the longest and shortest nights | Individual nights beyond the three longest and shortest (ask for the nights view) |
| Heart | Blood pressure readings, each as a systolic/diastolic pair flagged against the 120/80 reference threshold, or summarised with the change against the window before | A diagnosis. The threshold is a reference |
| Workouts | Each recorded workout: date, start and end time, type, duration, and distance, calories and heart rate when recorded. It can filter by type, sort and page, and show the exercises of a strength session | Distance, calories or heart rate for a session that did not record them |
| Workouts | The workout log rolled up: sessions, per week, time, calories, distance, a count by type and by month, and the latest three sessions | Individual sessions beyond the latest three (ask for the sessions view) |
| Training | The active plan judged against your logged sessions: current phase, each path's stage and light, readiness, next session, adherence, deload and recovery | Anything you have not logged |
| Training | Logged strength sessions, newest first: date, title, exercises, working sets and notes. It can filter by exercise name | More than 40 sessions in one lookup |
| Training | The active plan document with its id and revision | |
| Training | One session template of the active plan as a day of training: when it comes up, the focus areas, and for each slot its path, stage, dose, light, readiness and what is next | |
| Training | A search of the exercise catalogue by name, for exact names and template ids | |
| Training | A complete example plan, to show the expected shape | Defaults. They are examples only |
| Labs | Stored lab results by analyte or category, optionally within a date window: latest value, unit, date, reference interval, status and change, with history on request | Results that were never uploaded |
| Labs | Two lab panel dates compared series by series | |
| Labs | The stored lab documents, newest first: report date, collection dates, lab name and how many results each holds | The results themselves (the lab results lookup has those) |
| Medications | The medication log per medication: dose records, days, last day, taken, skipped or unknown | A treatment plan. It is a record of what was logged |
| Medications | Each logged dose: day, local time, medication and dose as logged, and whether it was taken, skipped or unknown | A treatment plan |
| Body and nutrition | Your body goal and where you stand against it: target, phase, progress, weight trend and pace, arrival projection, maintenance estimate, food-log status and nutrition targets | A deadline. An arrival date is a projection |
| Body and nutrition | Each logged day of food against the goal's calorie and protein targets, as the Nutrition page judges it | Days with no food logged. They are not rows |
| Activity | Where your workouts went, by saved map area: workouts, distance and time in each area, how much of the ground was new, and the same by activity type | Any route or coordinate |
| Activity | The map areas you saved, by name and rough size | Any place, route or workout |
| Insights | The insights the app can support today: changes against the week before and associations between metrics, each with its evidence and a caveat | An insight without enough observations |
| Insights | The weekly or monthly reports the Insights page shows, most recent first | Incomplete periods |
| App status | Problems found in the data that arrived, which metrics and days, how to fix them, and which findings you silenced | |
| App status | Which data sources are connected, when each last delivered and how much, and whether each stage of the pipeline is ok | Credentials or connection details |
| App status | Your age, sex, time zone and the notes you wrote about your data | Your name and date of birth, never |
| App status | The unit system you chose, metric or imperial | Any other setting |
| App status | Today's briefing as already written: headline, text and recommendations | It never writes one. If none exists yet, it says so |
| App status | The cards on your dashboard: which metric each shows and for which dates | Values. It reads the metric for those |

Those are the 30 capabilities the code registers. The generated technical table, with the tool and
parameters behind each, is in [Analyst capabilities](analyst-capabilities.md).

## How it gets your data

Before it answers, the analyst is given three things: your question and the earlier turns, a short
**starting selection** of data (in the default mode), and a **coverage index**. The index says how
much of each kind of data the app holds and for which dates, which metrics have data, and the dates
your lab panels were measured. It carries no values.

For anything else, the analyst looks it up with read-only tools while it writes the answer. The
Analyst page shows "Looking up your sleep…" or a similar line while it does, and the answer lists
the tools it used. Everything it quotes is checked against what it fetched.

It cannot change your health data. The only thing it can change is your training plan, and only
when you ask for a change or clearly agree to one: at most three plan changes per question, each
shown with an **Undo** button. See
[The training routine](configuration.md#the-training-routine-on-workouts).

Which mode sends which starting selection is in
[How the analyst gets your health data](configuration.md#how-the-analyst-gets-your-health-data).

## When it says something is missing

There are three honest cases, and the analyst is told to say which one applies.

1. **It looked and there is nothing in that period.** The lookup came back empty for the dates
   asked. The analyst says so, names the window it checked, and tells you which dates the app does
   hold, so you can ask about a period that has data.
2. **The data could not be read right now.** A source did not answer, or a stored file could not be
   read. This is not the same as "none": the analyst says it could not read the data and that you
   can try again.
3. **The AI privacy setting withholds it.** The analyst says the setting keeps that data from it,
   not that the data does not exist. There are no per-category switches today, so in a normal
   install this case does not arise.

The analyst is designed never to say "no records" because something was not in its starting
selection. The selection is a sample, not the record. The coverage index shows what exists, and an
absence is only reported after a lookup for that data returned nothing. If a reply claims something
is missing without having looked, and the app holds records of that kind, the app adds a line to
the answer's uncertainty section stating what it does hold and for which dates.

If you ask about a period with no data, for example workouts in a year before you started
recording, the answer is case 1: nothing in that period, with the dates the app does hold.

## Limits and truncation

Everything the analyst reads is bounded, and it says when it is showing part of a list.

- **Per lookup.** A window spans at most 730 days, and a window that ends after today is
  clipped to today, with a note. Each result stays under about 12,000 characters. A result that
  would be bigger is narrowed in a stated way: rows are paged, or series are left out and named. It
  is never cut in the middle of a value.
- **Long periods are summarised first.** A metric over a long window comes back as a summary, then
  as daily points up to 92 days, weekly points up to 104 weeks, then monthly. Sleep, workouts, blood
  pressure and medications each have a summary view for a year, and a list view for the details.
- **Lists come in pages.** When a list is longer than a page, the result says how many rows it shows
  out of how many exist and gives the offset for the next page.

| Lookup | Rows per page (default / most) |
|---|---|
| Sleep nights | 14 / 31 |
| Workout sessions | 20 / 25 |
| Blood pressure readings | 50 / 100 |
| Medication doses | 60 / 100 |
| Nutrition days | 31 / 60 |
| Weekly or monthly reports | 4 / 12 |
| Logged strength sessions | 40 |
| Metric series | 3 metrics per lookup; 92 daily points |

- **Per answer.** One question may take up to 6 rounds with the model and up to 12 lookups in
  total, and the results together are capped at 48,000 characters. When the budget is used up, the
  analyst answers from what it has and says what it could not fetch.
- **The starting material is bounded too.** The coverage index is at most 6,000 characters, and the
  fixed starting selection is held to `ANALYST_CONTEXT_MAX_CHARS` (see
  [Configuration](configuration.md#how-the-analyst-gets-your-health-data)). Whatever is left out
  is named in the context, so the analyst says "I was not given X" rather than "X is not recorded".

## Privacy controls

With a remote model configured, Vital sends the model the following. Each line is sent only when
the analyst can read that kind of data, and the same list is shown on Settings → AI privacy.

- Metric summaries and the values behind them: averages, medians, totals, comparison changes, observation counts, and the points of a date window.
- Sleep nights: bedtime, wake time, time asleep and in bed, and the sleep stages of each night.
- Blood pressure readings: each systolic and diastolic pair with its date.
- Workouts: date, type, duration, distance, calories and heart rate of each session, rolled up or one by one.
- Strength training sessions: exercises, sets, repetitions and loads, and your training plan weighed against them.
- Lab results from your uploaded documents (per analyte: the latest value with its unit and observation date, the reference interval the report printed and where it came from, the previous observation, and earlier observations).
- Medication records: each logged dose with the medication and dose as you logged them, and whether it was taken.
- Your body goal: target, progress, weight trend, nutrition targets and how your logged food compares.
- Profile context: age, sex, time zone and the notes you wrote about your data, never your name or date of birth.
- App state: your training plan and preferences, data-quality findings, which sources are connected and when each last delivered, and the cards on your dashboard.
- Coarse locations: distance and workout counts per saved map area, never a route or a coordinate.
- Date windows, coverage statements (what the app holds, and for which dates) and the text of your question.

The list is built from the capabilities the analyst has, so it cannot fall behind them. Nothing
else is sent. Vital has no per-category switches today: the AI privacy setting
shows what is sent, and the way to send none of it is to use the demo analyst.

- **Your profile name is never sent**, and neither is your date of birth. The profile context holds
  your age, sex, time zone and the notes you wrote.
- **Locations are coarse.** The analyst sees distance and workout counts per map area you saved,
  never a route or a coordinate.
- **The demo analyst sends nothing.** With `ANALYST_PROVIDER` unset or `demo`, answers come from
  fixed local handlers and nothing leaves the machine.
- **`ANALYST_TOOLS=off`** stops the model from calling any tool, so it cannot look anything up and
  cannot change the training plan. The fixed starting selection is sent instead, and the coverage
  index still tells the model what else exists, so it says "not included" rather than "not
  recorded". Use it for a model server without tool calling. A server that rejects the tool
  definitions is handled the same way, and the answer says tools were unavailable.
- **`ANALYST_CONTEXT=full|ondemand`** chooses the starting selection: the whole selection for the
  question (`full`, the default) or only the question and the coverage index (`ondemand`). In both
  modes the model can look up the rest. See
  [Configuration](configuration.md#how-the-analyst-gets-your-health-data).
- **Removing a source removes its data and the conversations it fed.** Disconnecting a source, or
  deleting the last lab report, erases the conversations that used that source's data, messages
  included. See [Removing a source](data-sources.md#removing-a-source).

Nothing the analyst fetches is stored by the app: health data is read when a question is asked and
held for the length of that question. The wider privacy and security picture is in
[Privacy and security](privacy-and-security.md).

## Example questions

Each of these is in the evaluation set, so each is answerable by a tool that exists.

| Area | Ask |
|---|---|
| Workouts | "How was my last workout?" |
| Workouts | "How many workouts did I do in March?" |
| Workouts | "Show my runs longer than 45 minutes this summer" |
| Training | "What did I lift on my last strength day?" |
| Sleep | "What were my deepest sleep nights this year?" |
| Sleep | "How did my sleep in August compare with September?" |
| Metrics | "What's my resting heart rate trend over 6 months?" |
| Heart | "Has my blood pressure gone down since July?" |
| Labs | "What changed between my last two lab panels?" |
| Labs | "When was my last blood test and from which lab?" |
| Medications | "Did I log every dose last month?" |
| Body and nutrition | "Am I hitting my calorie target?" |
| Insights | "What were my weekly highlights for the last month?" |
| Activity | "Where did I run most this year?" |
| App status | "Is my data up to date?" |

You can also ask "What can you look up for me?" and it lists what it holds, with the dates.

## Adding a capability

A capability is one thing the analyst can read, with a stable id such as `sleep.nights`. This
section is for a developer adding one. Paths are under `src/lib/analyst/`.

### Two files, one entry each

| File | Holds | Why it is separate |
|---|---|---|
| `capabilities/manifest.ts` | `id`, `area`, `title`, `tool`, `statusLabel`, `sources`, `category` | **Client-safe.** It imports nothing but `./types`, so the Analyst page can label a lookup ("Looking up your sleep…") without pulling server code into the browser bundle. |
| `capabilities/areas/<area>.ts` | The rest: description, owner, mirrors, coverage, read | **Server reads.** It reaches the data, which the browser must never import. |

`capabilities/registry.ts` joins them in manifest order and throws when it loads if one side has an
entry the other lacks. Add the manifest entry, write the area implementation, and list it in
`IMPLEMENTED` in the registry.

### The fields every capability declares

| Field | What it is for |
|---|---|
| `id`, `area`, `title`, `tool` | Identity. `tool` is the tool the model calls to reach it; several capabilities may share one tool. |
| `statusLabel` | The line the page shows while the lookup runs. |
| `description` | One or two sentences for the model and for the generated table: what it holds, and what it does not. |
| `owner` | Who owns the data: `dataset`, `lab-store`, `workout-sources`, `medications-upstream`, `config-store` or `computed`. |
| `mirrors` | The routes, pages, accessors and metrics this capability covers. The parity test reads it. |
| `time` | `window` when the read takes a window, `none` otherwise. |
| `sizeClass` | `small`, `per-day`, `per-record` or `per-series`: how a result grows. |
| `page` | Default and maximum rows per call, for the row-per-record and row-per-day classes. |
| `absenceTerms` | The words a reply uses to claim absence. The absence audit looks for them. |
| `citesAs` | The metric ids an evidence card may cite after a successful read. |
| `params` | The arguments, for a capability served through `get_app_data`. |
| `coverage(ctx)` | Cheap: first day, last day and count, or `unknown`/`unavailable` with a reason. It feeds the coverage index and the "nothing in that period" message. |
| `read(args, ctx)` | The read. It returns an envelope. |
| `sources` | The source tag (see Source tagging). |
| `category` | The privacy category (see Privacy). |

The words the model reads about a capability live in `capabilities/guide.holds.ts` (a short phrase
for the capability map: no values, dates, counts or digits) and `capabilities/guide.examples.ts`
(two example calls, or one when it takes none). A test checks each example against the tool's own
schema.

### A dedicated tool, or `get_app_data`

Use `get_app_data` for small state that has no time axis: one capability per call, chosen by its
id, with its own `params`. The tool enum is built from the manifest, so a new entry appears in it.
Use a dedicated tool when the read takes a window, returns rows that need paging, or has its own
vocabulary (a view, a sort, a filter). A dedicated tool is an `AnalystTool` in `tools/`, added to
`DATA_TOOLS` in `tools/data.ts`, and it runs the capability with `runCapability` from
`tools/capability-tool.ts`. A tool may serve several capabilities, as `get_workouts` serves
`workouts.sessions` and `workouts.summary`. A tool that serves several must give them all one
`sources` tag.

### Windows and envelopes

Take a window with `windowOf` (`capabilities/reads/common.ts`), which calls `resolveWindow`. It
accepts one of `day`, `month` (`YYYY-MM`), `start` with `end`, or `lastDays`, allows at most 730
days, and clips an end date after today to today with a note. Do not do your own date arithmetic.

Answer with an envelope (`capabilities/envelope.ts`), one of five statuses:

| Status | When | Helper |
|---|---|---|
| `ok` | There is data | `ok` |
| `no_data_in_window` | The read worked and the window is empty. Not an error | `noDataInWindow`, `emptyWindow` |
| `source_unavailable` | The data could not be read | `sourceUnavailable` |
| `privacy_blocked` | The AI privacy setting withholds the category | `privacyBlocked` |
| `invalid_args` | The arguments are wrong; `problems` says how to fix them | `invalidArgs` |

Wrap the read in `guarded`: it checks the privacy policy first, then turns a thrown error into
`source_unavailable` with the text scrubbed. Page rows with `pagingOf` and `pageRows`; a row is kept
whole or left out, and the page says how many of how many it shows and the next offset.
`no_data_in_window` must carry the coverage, so the analyst can say what the app does hold.

### The number rule

Every number a result returns has a display string beside it, made by the metric formatters, so the
model quotes a formatted figure and never works one out. `capabilities/number-rule.ts` checks a
result for it. A count, an offset and a coefficient are exempt by key name (`COUNT_KEYS`); a
non-finite number never passes, and a missing value is left out rather than sent as zero.

### Privacy category and the canary test

Give the capability a `category` from the closed list in `capabilities/types.ts`
(`SendingCategory`) and, if none fits, add one with its sentence in `capabilities/categories.ts`.
The sentence is what [Privacy controls](#privacy-controls) and Settings → AI privacy show, built
from the categories in use, so a category with no capability is never listed.

`capabilities/privacy.test.ts` is the canary test. It sets every credential variable and stored
credential the app reads to a distinct canary value, runs every capability, directly and through the
tool the model calls, against sources that work, throw and report themselves unavailable, and fails
if a canary appears anywhere in a result, a `next` sentence, a problem or a thrown message. A new
capability is covered by iterating the registry; a read that builds its own error text must scrub it
(`scrubForModel`).

### Source tagging

Each answer is stored with the ids of the sources whose data it used, so removing a source deletes
exactly the conversations that came from it. A capability's `sources` tag
(`metric-provenance`, `all-health`, `lab`, `hae`, `workout-detail` or `configuration`) is how
`src/lib/sources/tagging.ts` classifies its tool. The tag is per tool, not per capability, because a
turn records the tool it called. When unsure, over-tag: an extra source only deletes more on
removal, and an under-tag would leak. `src/lib/sources/tagging-manifest.test.ts` fails when a tool
is not classified or a tool has two tags.

### The parity test and exemptions

`capabilities/parity.test.ts` enumerates what the app serves (API routes, dataset accessors,
metrics, pages and data sources) and fails when one is neither mirrored by a capability nor
exempted. The failure message names the fix. Either add the key to the `mirrors` of the capability
that serves it, or add an exemption to `capabilities/exemptions.permanent.ts`:

```
{ kind: 'route' | 'accessor' | 'page' | 'metric' | 'source', key: '...', reason: '...' }
```

The `reason` is at least 30 characters and says why the analyst does not need it. Exemptions are
code, so they are reviewed in the diff. A tracked exemption (a known gap to close later,
`exemptions.tracked.ts`) is no longer allowed: `ALLOW_TRACKED` is `false`, and a tracked entry
fails the test. The test also fails on an exemption that is no longer needed, so delete the entry
when a capability starts to cover the key.

### Regenerating the table

`docs/analyst-capabilities.md` is generated from the registry. Do not edit it by hand.

```
npm run analyst:capabilities
node scripts/analyst-capabilities.mjs --check
```

The first writes the file; the second exits 1 when the committed file is out of date. The parity
test fails in the same case.

### The evaluation set

`eval/questions.ts` holds 32 questions, each with the first calls a good model makes, as checks on
the tool and the window. The suite runs them offline: an oracle model issues the expected calls
against a synthetic world and the test proves that the calls validate, the statuses are the stated
ones and the answer reads, grounds and passes the absence audit. That says nothing about a real
model's judgement. To measure one, the owner runs the set live:

```
ANALYST_PROVIDER=... ANALYST_MODEL=... ANALYST_API_URL=... ANALYST_API_KEY=... \
  npm run analyst:eval -- --yes [--only 1,4,32]
```

It sends each question, and every tool round, to the configured model, so run it on demand. It
refuses to run with the demo analyst or without `--yes`, reads configuration from the process
environment only, and prints tool names and yes/no results: no value, no answer text and no key. If the new
capability adds a tool or changes how a question is best asked, add or adjust a question.
