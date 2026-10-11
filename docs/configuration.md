# Configuration

The AI analyst, the profile and goals, the training routine, the daily briefing, and the safety properties of the live path.

[← Back to the README](../README.md)

---

# AI providers and models

AI is set up in the app, per user, not in the environment:

- **Settings → Connections → AI providers** holds the model servers you use. Each has a name, a
  type, an address and an optional API key. The key is stored encrypted under
  `VITAL_SECRET_KEY` (created by `npm run db:init`) and never reaches the browser again after
  you save it. Vital asks the server for its model list before it saves anything, so a wrong
  address or a refused key is caught at once.
- **Settings → Preferences → AI models** chooses the provider and model for each feature:

  | Use | What it does |
  |---|---|
  | **Analyst** | answers questions on `/analyst` (and, if allowed, reads unfamiliar lab reports) |
  | **Summary** | writes today's briefing on the Overview and the training notes |
  | **Summary fallback** | writes the summary when the Summary model is unusable or its local server is not running, and rewrites it once when the Summary's reply fails the number check |

  Each use has an **Advanced** block with its tuning (below). A blank field means the default.

With nothing chosen, the Analyst is the deterministic *Demo analyst*, the Summary is computed
from your data, and nothing is sent anywhere. Providers and choices need the Postgres
database; without one the app behaves as if nothing were chosen.

## Provider types

| Type | What it talks to | Default path | Credential header |
|---|---|---|---|
| OpenAI-compatible | **any** OpenAI-compatible `POST /chat/completions`: OpenAI, OpenRouter, LM Studio, llama.cpp, vLLM, Ollama, Together, … | `/chat/completions` | `Authorization: Bearer` |
| Anthropic | the Anthropic Messages API | `/v1/messages` | `x-api-key` |

"OpenAI-compatible" is deliberately generic: it is not tied to OpenAI. Any server that speaks
the OpenAI chat-completions shape works, which is what makes a local model usable. The address
is a base URL (`https://openrouter.ai/api/v1`) or a full endpoint; the default path is
appended when missing. The model picker lists what `GET …/models` returns; a server with no
model list (HTTP 404) is accepted and the model id is typed instead.

Common addresses, all offered as one-click hints in the form:

| Server | Address | Key |
|---|---|---|
| OpenAI | `https://api.openai.com/v1` | required |
| OpenRouter | `https://openrouter.ai/api/v1` | required |
| LM Studio on the host | `http://host.docker.internal:1234/v1` | none |
| Ollama on the host | `http://host.docker.internal:11434/v1` | none |
| Anthropic | `https://api.anthropic.com` | required |

`docker-compose.yml` sets `extra_hosts: ["host.docker.internal:host-gateway"]` so the
container can reach a model server running on the host.

## Tuning (Advanced)

| Setting | Uses | Default | Meaning |
|---|---|---|---|
| Reasoning effort | all | not sent | `max`…`none`; set it for a reasoning model, whose reasoning can otherwise use the whole budget |
| Reply budget (tokens) | all | 1200 analyst · 4000 summary | `max_tokens`; a reasoning model spends it on reasoning *and* the reply |
| Temperature | all | 0.2 analyst · 0.3 summary | |
| How your data is sent | Analyst | everything in one message | see [How the analyst gets your health data](#how-the-analyst-gets-your-health-data) |
| Most data sent with one question | Analyst | 60,000 characters | bounds the one-message selection |
| Tools | Analyst | allowed | off for a server without tool calling |
| JSON replies | Analyst | ask for JSON | `auto` sends `response_format: {"type":"json_object"}` and retries once without it on HTTP 400; Anthropic never receives it |
| Reasoning limit per turn | Analyst | 40,000 characters | stops a model that keeps reasoning |
| Reply limit per turn | Analyst | 30,000 characters | stops a model that keeps writing |

The Analyst block also has **Read unfamiliar lab reports with this model** (on by default).
When a lab PDF's layout is not recognised, its text, with identifying lines removed, is sent to
the Analyst's model and every value it proposes is checked against the document. Off: a lab
upload never contacts a model.

## What stays in the environment

Only the system prompt and the timeouts are deployment settings:

| Variable | Meaning | Default |
|---|---|---|
| `ANALYST_SYSTEM_PROMPT` | inline system prompt, replacing the built-in one | the built-in analyst prompt |
| `ANALYST_SYSTEM_PROMPT_FILE` | path to a mounted `.md`/`.txt` prompt, re-read at request time when its mtime changes | none — **wins** over the inline value |
| `ANALYST_TIMEOUT_MS` | one request to the analyst's model | `60000` |
| `ANALYST_QUESTION_TIMEOUT_MS` | one whole analyst question, tool rounds included; also catches a stream that goes silent | `300000` (5 minutes) |
| `BRIEFING_TIMEOUT_MS` | one briefing (or training-note) request | `60000` |

**No longer read** (since the AI providers moved to Settings): `ANALYST_PROVIDER`,
`ANALYST_MODEL`, `ANALYST_API_URL`, `ANALYST_API_KEY`, `ANALYST_MAX_TOKENS`,
`ANALYST_TEMPERATURE`, `ANALYST_JSON_MODE`, `ANALYST_TOOLS`, `ANALYST_CONTEXT`,
`ANALYST_CONTEXT_MAX_CHARS`, `ANALYST_MAX_REASONING_CHARS`, `ANALYST_MAX_ANSWER_CHARS`,
`ANALYST_REASONING_EFFORT`, `VITAL_LLM_BASE_URL`, `VITAL_LLM_MODEL`, `VITAL_LLM_API_KEY`,
`VITAL_LLM_FALLBACK_BASE_URL`, `VITAL_LLM_FALLBACK_MODEL`, `VITAL_LLM_FALLBACK_API_KEY`,
`BRIEFING_MAX_TOKENS`, `BRIEFING_TEMPERATURE` and `VITAL_LAB_MODEL_ASSIST`. Enter the provider
once in Settings after upgrading.

**Stopping a model that cannot stop.** A reasoning model can fail to end: it keeps thinking, or
keeps writing, with no answer. The reply budget is far too high to catch that in time, so a
streamed question also has three guards: the reasoning and reply limits above, and
`ANALYST_QUESTION_TIMEOUT_MS`. Hitting one stops the question, closes the connection to the
model, produces no answer, and shows a message that names the limit and where to change it. The
two character limits count each model turn separately, so a question that fetches data in
several rounds is not penalised for it. The analyst page also has a **Stop** button while a
question is running: it closes the model connection at once and nothing is stored for that question.

Rules worth knowing:

- **Loopback addresses need no key.** `127.0.0.1`, `localhost`, `[::1]` and
  `host.docker.internal` are treated as local, so a local LM Studio just works. Every other host
  requires a key.
- **A chosen provider is used directly.** There is no per-request prompt in front of the
  analyst in this private deployment. `GET /api/analyst`, the Settings → AI privacy tab and the
  Analyst page state which provider, model and destination host handle a question.
- **An unusable choice never crashes.** A bad address, a missing model, a missing key for a
  non-loopback host, or a key written under another `VITAL_SECRET_KEY` is reported as
  *misconfigured* with the reason and where in Settings to fix it. The analyst does not fall back
  to demo answers.

## Custom system prompt

```bash
# the file wins over the inline value, and is re-read when it changes
ANALYST_SYSTEM_PROMPT_FILE=/app/config/analyst-prompt.md
```

`./config/analyst-prompt.md` is committed as a starting point and mounted read-only at
`/app/config`. Editing it customizes the analyst's instructions — no rebuild, no restart.
Keep its medical-boundary and grounding rules: the service validates the *shape* of a reply
and audits its numbers, but only the prompt can tell a model not to diagnose.

## What changes in the UI when a provider is configured

- The badge on `/analyst` stops saying *Demo analyst* and shows the provider's name and the
  model (e.g. `OpenRouter · gpt-4o-mini`). The key is never shown — only whether one is
  present.
- The context panel lists the destination host and the categories of data that are sent, and
  names the provider and model that handle the request.
- A question that is a genuine match for a supported question still uses that handler's
  bounded bundle (e.g. *How has my sleep changed over the last month?* retrieves only the
  sleep summary). Anything else — including a question that spans two topics, which the demo
  path's `/sleep/` catch-all used to capture — gets the bounded general bundle, so every part
  of the question is answerable from what was retrieved.
- Answers are still split into observed / interpretation / uncertainty, every evidence card
  still links to a real metric route, and the educational notice is unchanged. A new
  **grounding note** appears in amber when the model cited a figure that is not in the
  selected context — those figures are shown, never silently dropped.
- Settings → AI privacy reports provider, model, endpoint host, credential present/absent,
  prompt source and the reason when the configuration is invalid.

## The profile (Settings → Account)

Vital keeps one small record about the person, owned by the **server** and stored in the
`profile` row of the Postgres database (`id = 1`), in the same database as the rest of the
configuration:

| | |
|---|---|
| Storage | The `profile` row (`id = 1`) in Postgres |
| Route | `GET` / `PUT /api/profile` |

- **Fields, and only fields that are used.** `name` (the greeting and the briefing prose),
  `dateOfBirth` (the briefing receives the derived age), `notes` (shown as **Goals** in Settings:
  free text for what you are working toward, which decides what the daily briefing is about),
  `timezone` and
  `briefingHour`. There is no dead field and no secret field.
- **Validated and bounded server-side.** Unknown fields are rejected rather than dropped; every
  type is checked; `name` is capped at 80 characters and `notes` at 500; `timezone` must be a real
  IANA zone and `briefingHour` a whole hour 0–23. A rejected body changes nothing. The
  response body *is* the profile and nothing else.
- **First-run behaviour is explicit.** No row yet means the documented defaults and nothing
  crashes. A corrupt or hand-edited row also falls back to the defaults and reports why, rather
  than 500-ing the app.
- **One timezone.** `timezone` used to be a `localStorage` preference as well, which meant the
  browser and the server could disagree about what day it was. That duplicate has been removed:
  the profile's timezone is now the only one. It cuts the live dataset's calendar days (sleep
  waking dates, workout days, daily totals, "today"), the clock times every page shows, the
  medication days, the client's window labelling (`useUnits().timezone`) and the briefing day.
- **The browser's timezone is the default, not an override.** While no profile is stored, the
  first browser visit stores that browser's timezone. From then on the timezone is whatever
  Settings → Account says; a browser in another zone never changes it (Settings offers a one-click
  "use this browser's timezone"). `VITAL_TIMEZONE` is only the server's fallback before a profile
  exists.
- **Goals are data, never instructions.** The briefing prompt states it where every other rule
  lives, and the user message repeats it: a goal that reads like a command is not followed.
- **Nothing else is stored locally.** Theme choices, units and the notification flags stay in
  `localStorage` as a cache; no API key, token or health record does — and the timezone no longer
  does either.

## The body goal (Body → Overview)

A **body goal** is a target body weight or a target body-fat percentage, and optionally your own
pace. It is set from the Body page and stored in the `body_goals` table (migration `0012`):

| | |
|---|---|
| Storage | `body_goals` in Postgres; at most one is `active`, earlier ones are kept as history |
| Route | `GET` / `PUT` / `DELETE /api/body-goal` (a stale `revision` is refused with `409`) |

- **Configuration only.** A goal holds a kind, a target, a pace and the day it was set. Where you
  started is read from the health data on that day every time it is shown; no reading is stored.
- **Cut, gain or maintain comes from the data.** A target below your seven-day average weight (or
  body-fat reading) is a cut, above it a gain, and within ±1 % of body weight (±0.5 points of body
  fat) the goal is reached and the guidance turns to maintenance. Crossing the target never needs
  the goal to be re-entered.
- **One weight trend.** Every rate of weight change in the app — the Body pace, the energy balance
  and the Routine body-weight recovery indicator — is the same weight trend: a least-squares line
  through the last 28 days of weigh-ins, with recent weeks counting more (a 14-day half-life, so a
  weigh-in from two weeks ago counts half as much as today's and one from four weeks ago a quarter).
  It shows a change of pace sooner than an equal-weight slope while one high or low day still moves
  it little.
- **Recommended pace, or your own.** The recommended band is a share of body weight per week:
  0.5–1 % when cutting, 0.25–0.5 % when gaining. With the profile's sex set, the cutting band is
  fitted to how lean the current body fat is for that sex (narrower when lean); unset, no sex is
  assumed and the general band is used. A pace you set replaces the middle of the band; its direction
  always follows the phase.
- **A caution on very low targets.** A body-fat target near or below essential fat (about 2–5 %
  for men, 10–13 % for women), or below the athletic range (8 % / 15 %), gets a note in the goal
  dialog; so does a weight target whose projected body fat lands there. It is advice, never a
  block. With sex unset the note names both.
- **Maintenance two ways.** From the weight trend (mean logged calories on complete days, weighted
  the same way as the trend, minus the weight trend × 7,700 kcal/kg, which the page shows as about
  3,500 kcal/lb in imperial units; needs 10 complete logged days and 4 weigh-ins) and from the device (basal + active
  energy). The weight-trend estimate is used when there is one.
  Logged days under 60 % of the window's median are treated as partial logs and left out.
- **No food log needed.** Most people do not count calories. Without one, the goal is tracked from
  weigh-ins alone: the weight trend gives the daily deficit or surplus, the watch gives maintenance
  (so there is still a calorie target), and protein comes from body weight. The logged-intake
  sections, the month table and the macro check appear only once food is logged. With neither a
  food log nor basal energy there is no calorie number, and the pages say so.
- **Eating to the targets.** With a goal and a food log, the Nutrition page opens with calories
  and protein over the last four weeks, each with a target range and a wider OK range. The calorie
  target is only ±75 kcal wide, so a day within about 10 % of its middle counts as OK, and protein
  down to 85 % of the floor is OK. The cards count the logged days within the OK range, say how many
  were on target, and draw each day as a dot against both ranges. Days without a log are gaps, and
  partial logs are drawn hollow and not counted.
- **Useful before a goal.** Without a goal the Body page still reads the data: the energy balance,
  which way weight is going (losing or gaining more than 0.25 % of body weight a week, otherwise
  holding steady) against the recommended range for that direction, activity against the four
  weeks before, and recovery signals. A goal adds the target, progress, arrival dates and calorie
  targets.
- **Projections, not deadlines.** Arrival dates are worked out from a pace. Nothing is ever shown
  as behind or overdue.
- **Everywhere the goal matters.** The Overview shows a goal tile, the daily briefing leads with
  the goal (its numbers are in the briefing context as `bodyGoal`), and the analyst receives the
  same summary with every question (and as the page context from the Body page).

## The training routine on `/workouts`

The Workouts page opens with the active **training plan**: the current phase, the next
session, recovery and deload status, and a card per progression path with its light (green,
yellow-green, yellow, red), progress toward the next stage and the next action. Each card opens
`/workouts/routine/[pathId]` with the session table and what each session signals, the
assessment, the stage map, cues and checks, and recovery indicators.

- **Any discipline, any schedule.** A plan is focus areas → paths → stages, each path judged by a
  progression model (`variation`, `load`, `percentage`, `volume`, `maintain`), with a schedule that
  can be a cycle of any length (A/B/rest, on/off, every day), fixed weekdays, or N sessions a week.
- **Created and changed through the analyst.** Ask "Create a 6-month calisthenics plan", "build me
  a 12-week 10k plan, 4 runs a week" or "my low back is sore after reverse crunches". With a
  configured provider the model uses tools to read your sessions and write the plan; the demo
  analyst handles these requests by pattern from example plans. Every change is shown in the answer
  with an **Undo** button. With no plan, the Workouts page also offers the examples directly.
- **Phases follow progress, not the calendar.** A plan's milestones are phases with checkable
  targets (a stage started or mastered, a dose reached). The current phase is the first one whose
  required targets are not met, worked out from your sessions — so nobody is ever shown as behind.
  Durations are guides ("typically 4–6 weeks"). Calendar blocks are kept only for true calendar
  periods such as deload weeks, peaks and tapers.
- **Computed, then explained.** Lights, readiness and next actions are computed from your sessions.
  A configured model may rewrite the path note in plain language; it is shown only when every
  number in it traces to the computed figures.
- **Stored as configuration.** Plans (never sessions) are saved in Postgres (migration 0007) or
  `./data/training-plans.json`, with a revision per change.
- **Tools: off** (Preferences → AI models → Analyst → Advanced) keeps a configured model from
  calling tools (for servers without tool calling); a server that rejects tool definitions is
  answered without them automatically.

### How the analyst gets your health data

A question is answered from three things: a **coverage index**, a **starting selection**, and
read-only **tools** the model calls during the answer. **How your data is sent** (Analyst →
Advanced) chooses the starting selection. The tools are offered in both modes.

| How your data is sent | What is sent with a question | Use it when |
|---|---|---|
| Everything the question needs, in one message (`full`, default) | The question, the earlier turns, the coverage index and the selection for that question: metric summaries, the lab block and the medication log, in one message. The model can still look up anything the selection leaves out. | You want the likely data in front of the model from the start, or the model is weak at calling tools. |
| A list of what exists (`ondemand`) | The question, the earlier turns and the coverage index only. The model fetches what it needs. | The model calls tools well. It sends less with each question and scales better as the lab history grows. |

The **coverage index** is sent in both modes. It holds one line per kind of data the app has, with
the first and last day and how much; the metrics with data; and the dates lab panels were
measured. It carries no values and is at most 6,000 characters. A name that is in it exists. One
that is not is never taken as proof that something is missing: the model is told to report an
absence only after a lookup for it returned nothing in the window.

The model has ten read-only data tools: `list_capabilities`, `get_metric_series`,
`get_metric_relationship`, `get_workouts`, `get_sleep`, `get_blood_pressure`, `get_lab_results`,
`compare_lab_panels`, `get_medications` and `get_app_data`. It also has the training-plan tools
described above, which are the only tools that can change anything. What each tool reads, with its
parameters, is in [Analyst capabilities](analyst-capabilities.md); what the analyst can see, in
plain words, is in [The AI Analyst](analyst.md).

Each result is capped (about 12,000 characters); a result that would be bigger is paged or
narrowed in a stated way — rows left out are counted, series left out are named — never cut in the
middle. One question may take up to 6 rounds with the model, 12 lookups and 48,000 characters of
results in all. Every figure the answer quotes is checked against what was fetched, and the answer
can link only to a metric or lab series that was fetched. The Analyst page shows "Looking up your
sleep…" while it works, and the answer lists which tools it used.

Both modes only read health data. Nothing fetched is stored: it is read at request time and held
for the life of the question.

**When tools are off or refused.** With tools off, or when the model server rejects the
tool definitions, the model cannot look anything up. In `ondemand` mode the selection is then built
and sent after all, so `ondemand` behaves as `full`. The coverage index is still sent, and the
selection is labelled as a starting selection, so the model says that something was "not included
in what I was given", with how much the app holds, rather than "not recorded". When the server
refuses the tools, the answer also carries a note saying the plan tools were unavailable and that
the answer cannot see or change the training plan. With tools off, the analyst cannot change the
plan either.

**Most data sent with one question** (default 60,000 characters, about 15,000 tokens) bounds the `full` selection. Over
the limit, whole parts are removed — the daily series, then the less relevant blocks — and the
message states what was left out, so the model says "I was not given X" instead of "X is not
recorded". Nothing is cut mid-value. A model server that has a smaller window than the message
may drop the middle of it silently, which is where the data sits; set this below what yours holds.

## The daily briefing on `/`

The Overview hero (*"Today's briefing"*) is written by the **Summary** model chosen in Preferences →
AI models, through the same provider code the analyst uses. It receives only computed summaries (latest value, 7-day mean vs
the preceding 7 days, previous 30-day baseline, coverage, and explicit missing-data notes), never raw
records, and the request is bounded.

- **Attribution is always shown.** `Written by <model>` means a model wrote that text;
  `Computed from your data — analyst model offline` means the deterministic rule-written summary is
  being shown because no model answered. The two are never mixed.
- **Numbers are audited before display.** Every numeral in the generated prose must be traceable to
  the supplied context; if one is not, the model text is discarded and the computed summary is shown
  instead (*fail closed*). Fabricated figures are never published.
- **One briefing per local calendar day.** The cache key is
  `briefing:v<contextVersion>:<local day>:<profile fingerprint>:<unit system>` — no dataset identity.
  New observations arriving during the day do **not** regenerate a briefing already written for that
  day: it describes the last seven days against the seven before them and the previous month, none
  of which changes within a day. There is no cache TTL to tune any more, because the day key is the
  authority (the TTL knob was removed rather than left doing nothing).
- **The briefing hour is configurable.** The briefing is written by a scheduler that arms a timer for
  the profile's `briefingHour` (Settings → Account, default 06:00), so it is written at the hour with
  nobody visiting. If the process was down at the hour, the first request afterwards fills that day
  once (a catch-up attempt) and the hero labels the late write.
- **At most one automatic model connection per day.** A day is attempted at most once: after an
  attempt — successful *or* failed — the day is terminal, and a page view, a refresh, the container
  healthcheck and the browser's follow-up reads all serve the cached (or computed) briefing without
  opening another model connection. There is no failure cooldown to tune; the day-terminal record is
  the brake. The one thing that writes again is the explicit `Regenerate` control.
- **Before the hour, the previous day stays on screen.** The hero is labelled with the day it covers
  (`Briefing for Sep 17`) and the generation time, so it is never blank and never claims to be a day
  it is not.
- **`Regenerate` is the one explicit control.** It replaces the current day's briefing once, from the
  hero, so a failed or unwanted day is not stuck until tomorrow. It says what it does and never
  loops. If the model cannot be reached the computed briefing stays, with the reason.
- **The page never waits on the model.** The hero renders the computed briefing in the SSR HTML and
  swaps in the written one when the background read returns it.
- **The profile feeds the prompt.** Name, an age derived from the date of birth, and the goals text are sent as a `profile` block —
  explicitly labelled in the prompt as the person's own data, never as instructions. The goals also
  choose what the briefing is *about*: a small keyword map (`src/lib/briefing/goals.ts`) turns them
  into the measurements that bear on them (weight and body composition, running and fitness, steps
  and activity, strength, heart and blood pressure, stress, eating, hydration, daylight, breathing).
  Those metrics lead the context, and the sleep block is left out unless sleep is itself a goal. A
  goal the map does not recognise falls back to the usual all-round briefing.
- **A local model for the summary, with a hosted fallback.** The Summary can run on a different
  provider from the Analyst, such as a model server on this machine or your network. A Summary
  provider on this machine, or any Summary provider when a fallback is chosen, is first checked
  with a bounded `GET …/models` (about 2 s), once per day (the answer is
  memoized in the process for the day), so a server that is not running does not hold a generation
  open; the explicit `Regenerate` checks again. When it does not answer, the **Summary fallback**
  writes the briefing instead. The fallback is also asked exactly once when the Summary's reply
  fails the number check, and never twice for the same briefing.

## Where each setting lives

Vital has two levels of settings.

- **User level** is what you connect: your accounts and their keys. You enter them in
  **Settings**: Health Auto Export, Oura and Hevy under **Sources** (Hevy in
  **Workout sources**), AI providers under **Connections**. Vital checks them with one read-only request and, only if that works,
  stores them in Postgres, **encrypted** with `VITAL_SECRET_KEY` (AES-256-GCM). A saved key is never
  shown again (Settings shows only its last 4 characters) and is never returned by the API.
- **Admin level** is how the server runs. It lives in the environment (`.env`, passed through
  `docker-compose.yml`) and changes with a restart.

| Level | Setting | Where |
|---|---|---|
| User | Health Auto Export address and read key | Settings → Sources, Health Auto Export card |
| User | Oura client ID, client secret and redirect URI | Settings → Sources, Oura card |
| User | Hevy API key and address (optional) | Settings → Sources → Workout sources, Hevy card |
| User | AI providers: name, type, address and API key | Settings → Connections → AI providers |
| User | The provider, model and tuning for the Analyst, Summary and Summary fallback | Settings → Preferences → AI models |
| Admin | `VITAL_SECRET_KEY`, the key that encrypts the stored connections | environment |
| Admin | Database credentials (`VITAL_PG_*`, `DATABASE_URL`) and `VITAL_PORT` | environment |
| Admin | `VITAL_DATA_MODE` (`demo` or `live`) | environment |
| Admin | Analyst system prompt and the AI timeouts (`ANALYST_SYSTEM_PROMPT(_FILE)`, `ANALYST_TIMEOUT_MS`, `ANALYST_QUESTION_TIMEOUT_MS`, `BRIEFING_TIMEOUT_MS`) | environment |
| Admin | Cache and tuning values (`HAE_*`, `OURA_*`, `HEVY_CACHE_TTL_SECONDS`, `WORKOUT_SOURCE_LOOKBACK_DAYS`, `ROUTE_CACHE_MAX_POINTS`) | environment |
| Admin | `OURA_SCOPES`, `OURA_API_URL`, `HEVY_CACHE_TTL_SECONDS` | environment |

These variables are **ignored** if they are set: `HAE_API_URL`, `HAE_API_KEY`, `OURA_CLIENT_ID`,
`OURA_CLIENT_SECRET`, `OURA_REDIRECT_URI`, `HEVY_API_KEY` and `HEVY_API_URL`, and the AI variables
listed under [What stays in the environment](#what-stays-in-the-environment). After upgrading, each
instance re-enters those credentials once: Health Auto Export and Oura in Settings → Sources, Hevy in
Settings → Sources → Workout sources, and AI providers in Settings → Connections. Remove the old lines from
`.env` when convenient; nothing reads them.

`npm run db:init` generates `VITAL_SECRET_KEY` into `.env` when it is missing. Without a usable key
Settings says a connection cannot be stored. If the key is lost or replaced, the stored
connections cannot be read and Settings asks for them again.

## Oura Ring and source removal

Oura is optional. Register an app, enter its client ID, secret and redirect URI in Settings, and
press **Connect**. The steps, the measure table and the merge rule are in
[Data sources](data-sources.md#oura-ring). These admin settings tune it:

| Variable | Default | Meaning |
|---|---|---|
| `OURA_SCOPES` | `daily heartrate workout spo2` | Scopes requested. Any scope not granted is skipped and reported in Settings |
| `OURA_PREFERRED_FOR` | `sleep,recovery` | Groups where the ring wins over the watch: `sleep`, `recovery`, `activity`, `heart`, `workouts` |
| `OURA_CACHE_TTL_SECONDS` | `300` | Same meaning as `HAE_CACHE_TTL_SECONDS` |
| `OURA_HEARTRATE_LOOKBACK_DAYS` | `30` | Heart rate is about 288 samples a day, so less history is read |
| `OURA_HEARTRATE_CHUNK_DAYS` | `7` | Heart-rate request window |
| `OURA_API_URL` | Oura's API | Override only for tests or the sandbox |

`VITAL_DATA_MODE=live` needs at least one connected source: Health Auto Export or Oura. If neither
is available the app says so; it never falls back to demo data.

### Health Auto Export

Its address and read key are entered in **Settings → Sources** (see above), not in the
environment.

| Variable | Default | Meaning |
|---|---|---|
| `HAE_PROBE_METRIC` | `resting_heart_rate` | Metric the pipeline panel and the save check read over a one-week window |
| `HAE_CACHE_TTL_SECONDS` | `300` | How long a fetched, normalized dataset is cached in the server process |

### Hevy

The key and optional address are entered in **Settings → Sources → Workout sources**. `HEVY_CACHE_TTL_SECONDS`
(default `300`) is the only Hevy variable and sets how long a synced workout set is reused.

## Safety properties of the live path

- The provider returns **text**; the server parses it (tolerantly, through fences and prose),
  validates every field, caps every string and array, drops empty sections, and drops evidence
  whose metric is not in the registry *and* in the retrieved bundle.
- Every metric in the retrieved context carries a `display` block: the same figures formatted
  by the metric's own registry formatter and unit (`7h 32m`, `+17.1%`, `120 mg`), with the unit
  label, the display name and the window range in plain language. The prompt tells the model to
  quote those strings verbatim and state the unit, and the raw numbers travel alongside them for
  the audit only.
- Numeric claims in `observed`/`interpretation` are matched against the numbers actually in
  the bundle (formatting differences such as `7h 42m` for 462 minutes are accepted), against
  the `display` strings the model was given, and against the numbers those strings state
  (`7h 32m` ⇒ 452). Any unmatched token is reported on the response and in the UI.
- Errors are scrubbed: no credential value, no credential-bearing URL, and upstream bodies are
  truncated to a short excerpt.
- A provider failure returns `status: "error"` with an honest message. Canned text is never
  presented as a model reply, and the analyst never silently falls back to demo output.
