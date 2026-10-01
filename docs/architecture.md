# Architecture

How Vital is put together: one Next.js process serving the UI and the API, with PostgreSQL for configuration only.

[← Back to the README](../README.md)

---

# Architecture

Vital is a **layered monolith**: one Next.js application serves both the UI and the HTTP API from a
single Node process. There is no separate backend service and no separate frontend build — one repo,
one build, one deployable.

```text
browser ──── HTTP ────┐
                      │   one container, one process (`next-server`)
  ┌───────────────────▼──────────────────────────────────────────┐
  │ src/app          21 page routes      22 API route handlers    │
  ├───────────────────────────────────────────────────────────────┤
  │ src/components   58 components (charts, chat, forms, routine)  │
  ├───────────────────────────────────────────────────────────────┤
  │ src/lib          adapters · analytics · metrics · briefing    │
  │                  analyst · db · prefs · profile · pipeline    │
  └───────────────────────────────────────────────────────────────┘
        │                    │                      │
   metrics API          PostgreSQL 16         model endpoints
   (pulled, cached      (config, profile,     (briefing: local-first;
    in the process)      preferences,          analyst: configured
                         conversations)        provider)
```

## The three surfaces

| Surface | Lives in | What it is |
|---|---|---|
| UI | `src/app/*/page.tsx` | 21 routes. Each page is a thin server file (metadata + a mounted component); interactivity lives in client components. |
| API | `src/app/api/**/route.ts` | 22 route handlers / 32 methods: analyst chat (including a streaming endpoint) and its saved conversations, the daily briefing, lab reports, medications, the training routine and workout sources, pipeline status, preferences, profile, and a trivial `/api/health` liveness probe (no briefing, model, dataset or database). |
| Domain | `src/lib/**` | Every rule: source normalization, source de-duplication, day aggregation, the metric registry and its formatters, briefing generation, the analyst, persistence. |

Both surfaces call `src/lib` directly, in-process. Server-rendered pages do not make HTTP requests to
their own API, and the API is a thin surface over the same modules the pages use — so there is one
implementation of each rule rather than one per consumer. The API exists for the browser's
interactive work (sending a question, saving preferences, refreshing the briefing) and for anything
else that wants a machine-readable view of what the app shows.

## What runs inside the process

- **The health-data pipeline.** Health records are pulled from the metrics API server, normalized and
  de-duplicated, then aggregated per day and cached in the running process. The health API token never
  reaches the browser; the browser never calls the health API.
- **The daily briefing scheduler and its cache.** The briefing for a day is written once, at the
  configured hour, by the scheduler, and cached in the process. The request path only reads: it may
  fill a day the scheduler has not yet attempted (after a restart past the hour, say), but at most
  one automatic attempt is made per day — a failed attempt makes the day terminal too, and only the
  explicit `Regenerate` control writes again.
- **All model calls.** The briefing and the analyst both run server-side, which is why their keys are
  configuration the client never sees.

PostgreSQL holds configuration, profile, preferences and AI conversations. It deliberately holds **no
health data**.

## What this shape costs

- The API cannot be scaled, versioned or released independently of the UI: they ship as one image.
- Heavy work runs in the same process that serves pages. A briefing write can occupy a model call for
  a minute or more, and simultaneously occupies the web process.
- State that lives in the process — the health cache, the briefing cache, the scheduler timer — is
  per-process and per-container. Running two replicas without a shared store would give each replica its
  own copy and its own schedule.
- A crash or an out-of-memory event takes down the UI and the API together, because they are one
  process.

## If it ever needs to split

The seams are already the right shape for it: the API surface is separated from the domain modules, and
the domain modules are free of transport concerns. A split would mean a web/BFF process for the
rendered UI and the API, a worker process for asynchronous work (briefing writes, ingestion,
long-running model calls) driven by a durable queue, and a dedicated ingest endpoint — noting that
today the app only *pulls* from a metrics API and exposes no inbound write endpoint at all. That work
is only worth doing for multi-tenancy or for scaling ingest and model work independently of page
traffic; it is not a prerequisite for having an API, which this app already has.
