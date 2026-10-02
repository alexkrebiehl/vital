# Configuration

The AI analyst, the profile and goals, the training routine, the daily briefing, and the safety properties of the live path.

[← Back to the README](../README.md)

---

# AI Analyst configuration

The analyst has **five configurable things**: provider, model, endpoint, credential and
system prompt. All five are read from the **server** environment, so none of them can reach
the browser bundle. With nothing configured it is the deterministic *Demo analyst* and the
feature works exactly as before.

## Providers

| `ANALYST_PROVIDER` | What it talks to | Default path | Credential header |
|---|---|---|---|
| `demo` (default) | nothing — deterministic handlers over the active dataset | — | — |
| `openai` | **any** OpenAI-compatible `POST /chat/completions`: OpenAI, OpenRouter, LM Studio, llama.cpp, vLLM, Ollama, Together, … | `/chat/completions` | `Authorization: Bearer` |
| `anthropic` | the Anthropic Messages API | `/v1/messages` | `x-api-key` |

`ANALYST_PROVIDER=openai` is deliberately generic: it is not tied to OpenAI. Any server that
speaks the OpenAI chat-completions shape works, which is what makes a local model usable.

## The five settings

| Variable | Meaning | Default |
|---|---|---|
| `ANALYST_PROVIDER` | `demo` \| `openai` \| `anthropic` | `demo` |
| `ANALYST_MODEL` | model id sent to the provider | none — **required** for a remote provider |
| `ANALYST_API_URL` | base URL *or* full endpoint; the provider's default path is appended when missing | none |
| `ANALYST_API_KEY` | credential — sent as `Authorization: Bearer` (openai) or `x-api-key` (anthropic) | none — **required** for non-loopback endpoints, optional for loopback |
| `ANALYST_SYSTEM_PROMPT` | inline system prompt, replacing the built-in one | the built-in analyst prompt |
| `ANALYST_SYSTEM_PROMPT_FILE` | path to a mounted `.md`/`.txt` prompt, re-read at request time when its mtime changes | none — **wins** over the inline value |

Plus request tuning: `ANALYST_MAX_TOKENS` (1200), `ANALYST_TEMPERATURE` (0.2),
`ANALYST_TIMEOUT_MS` (60000), `ANALYST_JSON_MODE` (`auto`).

Rules worth knowing:

- **Loopback endpoints need no key.** `127.0.0.1`, `localhost`, `[::1]` and
  `host.docker.internal` are treated as local: `ANALYST_API_KEY` becomes optional, so a local
  LM Studio just works. Every other host requires a key.
- **A configured provider is used directly.** There is no per-request prompt in front of the
  analyst in this single-user private deployment. `GET /api/analyst`, the Settings → AI
  privacy tab and the Analyst page state which provider, model and destination host handle a
  question.
- **`ANALYST_JSON_MODE=auto`** sends `response_format: {"type":"json_object"}` and retries
  once without it on HTTP 400, so servers that reject the field still work. Anthropic has no
  such field and never receives it.
- **Invalid configuration never crashes.** A bad URL, a missing model or a missing key for a
  non-loopback host is reported as *misconfigured* with the reason, in `/api/analyst` and on
  Settings → AI privacy. The analyst does not fall back to demo answers.

## Local model example (LM Studio on the host)

```bash
# .env — no key needed, because the endpoint is on this machine
ANALYST_PROVIDER=openai
ANALYST_MODEL=local-model
ANALYST_API_URL=http://host.docker.internal:1234/v1
```

`docker-compose.yml` sets `extra_hosts: ["host.docker.internal:host-gateway"]` so the
container can reach a model server running on the host. Ollama and llama.cpp expose the same
shape on their own ports (`.../v1`).

## Hosted provider example

```bash
ANALYST_PROVIDER=openai
ANALYST_MODEL=openai/gpt-4o-mini
ANALYST_API_URL=https://openrouter.ai/api/v1
ANALYST_API_KEY=…            # server-side only
```

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

- The badge on `/analyst` stops saying *Demo analyst* and shows the provider and model
  (e.g. `OpenAI-compatible · gpt-4o-mini`). The key is never shown — only whether one is
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
- `ANALYST_TOOLS=off` keeps a configured model from calling tools (for servers without tool calling);
  a server that rejects tool definitions is answered without them automatically.

### How the analyst gets your health data

`ANALYST_CONTEXT` chooses between two ways of giving the model what a question needs.

| `ANALYST_CONTEXT` | What is sent with a question | Use it when |
|---|---|---|
| `full` (default) | The selection for that question: metric summaries, the lab block and the medication log, in one message. | The model has no tool calling, or a small context window you have sized for. |
| `ondemand` | The question, the earlier turns and a short **index** of what exists — metric names with their date ranges, lab series by category with the dates panels were measured. No values. The model fetches what it needs. | The model supports tool calling. It is the better choice as the lab history grows. |

In `ondemand` mode the model has seven read-only tools: `get_metrics`, `compare_periods`,
`get_metric_relationship`, `get_workouts`, `get_lab_results`, `compare_lab_panels` and
`get_medications`. They read what the fixed context is built from, so a figure has the same
formatting, units and reference interval either way. Each result is capped (about 12,000
characters); a result that would be bigger is narrowed in a stated way — series left out are named
— never cut in the middle. Every figure the answer quotes is checked against what was fetched, and
the answer can link only to a metric or lab series that was fetched. The Analyst page shows
"Looking up your lab results…" while it works, and the answer lists which tools it used.

Both modes only read. Nothing fetched is stored: health data is read at request time and held for
the life of the question.

`ANALYST_CONTEXT_MAX_CHARS` (default 60,000, about 15,000 tokens) bounds the `full` message. Over
the limit, whole parts are removed — the daily series, then the less relevant blocks — and the
message states what was left out, so the model says "I was not given X" instead of "X is not
recorded". Nothing is cut mid-value. A model server that has a smaller window than the message
may drop the middle of it silently, which is where the data sits; set this below what yours holds.
When tools are off or refused, `ondemand` falls back to `full`.

## The daily briefing on `/`

The Overview hero (*"Today's briefing"*) is written by the same provider stack described above —
there is no second configuration. It receives only computed summaries (latest value, 7-day mean vs
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
- **Preferring a local model for the briefing only.** When `VITAL_LLM_BASE_URL` is set *and*
  reachable, the briefing uses it instead of the analyst provider; if it is unset or unreachable the
  briefing falls back to the `ANALYST_*` provider. `VITAL_LLM_MODEL=auto` resolves to the first model
  id the local server advertises. The local server is resolved once per day (the `GET /v1/models`
  response is memoized in the process for the day), so a retry does not re-probe it; the explicit
  `Regenerate` re-probes. A local server on the host is reachable as `host.docker.internal`
  (`extra_hosts` is already set in `docker-compose.yml`); `VITAL_LLM_API_KEY` is optional for a
  loopback/LAN server. This switch affects the briefing only — the analyst keeps using `ANALYST_*`.

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
