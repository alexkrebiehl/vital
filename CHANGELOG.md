# Changelog

All notable changes to Vital, newest first. Each release lists what was **added**, **removed**,
**fixed**, and anything that **changes how Vital behaves** for the person using it.

**Keeping this file current.** Every commit that changes behaviour adds its bullets under
`Unreleased` in the same commit, in the category it belongs to (Added, Removed, Fixed, Changed).
Write what a user would notice, not what files moved. Documentation-only, test-only and CI-only
commits need no entry unless they change what people see or do. When a release branch is merged
and tagged, rename `Unreleased` to the version and date and start a new empty `Unreleased`.

## Unreleased

Release branch `release/v0.3.0`: Oura Ring as a second live data source, and de-duplication of
repeated records.

### Added
- **Oura Ring as a live data source.** Set `OURA_CLIENT_ID`, `OURA_CLIENT_SECRET`,
  `OURA_REDIRECT_URI` and `VITAL_SECRET_KEY`, then press **Connect** in Settings → Connections.
  Oura works on its own (no Health Auto Export needed) or next to it. It supplies sleep,
  breathing rate, overnight HRV, lowest overnight heart rate, temperature deviation, blood oxygen,
  steps, active calories, heart rate and workouts. Oura's own scores (readiness, sleep, activity,
  stress) are deliberately not shown.
- **Three ring measurements:** overnight HRV (RMSSD), lowest overnight heart rate and temperature
  deviation. They are separate from the Apple measures with similar names.
- **Both sources together.** One source per measure per day, never added together. By default the
  ring wins sleep and recovery measures; `OURA_PREFERRED_FOR` changes that.
- **Removing a source removes its data.** If a source is disconnected or its settings are removed,
  everything derived from it leaves Vital as if it had never existed, including cached data,
  workout routes and briefings. Analyst conversations that used it are hidden at once and deleted
  after a grace period (`VITAL_SOURCE_PURGE_GRACE_DAYS`, default 7). Settings lists removed sources.
- **Analyst conversations remember which sources fed each answer**, which is what makes the
  removal above possible.
- **Settings → Data coverage opens with a per-source summary** of which measures each source
  supplies.
- **Oura sign-in from another computer.** The docs describe connecting through an SSH tunnel when
  your browser is not on the machine running Vital, since Oura accepts plain `http` redirects only
  for `localhost`.
- **README** shows Health Auto Export and Oura setup side by side.

### Changed
- **Settings stays reachable when no live source is connected.** It used to be replaced by the
  "Live source unreachable" screen, which made a ring-only setup impossible to connect. Other pages
  still show that screen, now with an **Open Settings** link and no source named.
- **Coverage lists and the Trends pickers show only measures a connected source can provide.** With
  only a ring connected, Apple-only measures such as walking heart rate, exercise minutes and BMI
  are no longer listed as "No data".
- **Oura's VO2 max is opt-in.** It needs the `heart_health` scope: add it to `OURA_SCOPES` and
  reconnect.
- **Calories that were not recorded show as "not recorded"** instead of 0.

### Fixed
- **Duplicate sleep.** A device that recorded the same night twice counted twice; each wake-up day
  now has one episode.
- **Duplicate workouts.** Workouts from two apps that overlap by at least half are now one workout.
- **Duplicate blood pressure.** One reading synced by two apps counts once; two readings from the
  same cuff are always kept.
- **Oura connection:** scopes Oura reports with a namespace (`extapi:daily`) were read as "not
  allowed", and a single refused measure used to fail all the others and report a bad token.
- **Docker image no longer contains your `data/` folder.** Lab PDFs and local settings could be
  packaged into a locally built image; the build now excludes the whole folder, and a test keeps it
  that way. Images published from CI were not affected.
- **Report values were removed from source comments and tests**, replaced with invented ones.

## 0.2.4 - 2026-10-03

### Added
- **Activity → Maps:** maps of where outdoor workouts went, with a frame you set, finer zoom, and a
  preview of routes past the frame. Heart-rate maps shade cool to hot; frequency maps are smoothed
  along the streets. Each map has its own tile provider, style and light/dark choice, is labelled
  with its dates ending on "Today", and shows a loading overlay while it reads its routes. Map
  cards show the longest session.
- **App icons and a web app manifest**, so Vital can be added to a phone's Home Screen.
- **Container images** are tested, smoke-tested and published for two CPU architectures by CI.

### Changed
- Workout pages follow the graphite-and-indigo redesign.
- The README trademark notice names the map and place-search services.

### Fixed
- Walking heart rate, VO2 max, waist circumference, cycling distance and sodium are read under the
  names Health Auto Export uses for them.
- Tapping a map highlight again turns it off; routes draw at sub-pixel positions; map borders are
  even in Safari.

## 0.2.3 - 2026-10-02

### Added
- **The analyst fetches health data on demand** and budgets its fixed context, so long histories
  and lab results fit. `ANALYST_CONTEXT=ondemand` turns it on; full context stays the default.
- **A Stop button**, and a guard that stops a model that cannot stop (per-turn and per-question
  limits), so a runaway answer no longer spins indefinitely.
- **License:** AGPL-3.0, with screenshots and a trademark notice in the README.

### Fixed
- A reply that was valid JSON but held no answer is repaired instead of shown empty.

## 0.2.2 - 2026-10-01 (untagged)

### Changed
- The README leads with what Vital is for and what it does.

## 0.2.1 - 2026-10-01

### Added
- **Training routine.** Workouts becomes a routine dashboard with a plan (cadence, phases, calendar
  blocks), a page per progression path, readiness bars, a Recovery page, and history on
  `/workouts/all`. Progress is evaluated by pluggable progression models; deloads pause progress.
  The analyst can read and change the plan with tools, and discuss a routine page in a dialog.
- **Workout sources.** A plugin system with a Hevy source; sessions that more than one source
  logged are named.
- **A briefing built around your goals,** focused on the goals set in Settings.
- **One date-range control everywhere:** 7, 30 or 90 days, plus a custom range.
- **Themes page** with popular light and dark themes; breadcrumbs and a nested sidebar.
- **The analyst shows its answer as it forms** and animates the wait for the first bytes.

### Changed
- Coverage and source footers were removed from pages, as was the dose chart; data sources are named
  only in Settings.
- Days and times display in your timezone, not UTC.

### Fixed
- The saved prose analysis, next steps and summary are stored with each turn.
- Metric charts draw the baseline band; the Hevy settings now reach the app container.
- The analyst recovers when a model answers in prose after using tools, retries without JSON mode
  when a reply is empty, and adapts to parameters newer OpenAI models refuse.

## 0.2.0 - 2026-09-30

### Added
- **A redesigned interface** around a graphite-and-indigo identity: page banners, a body figure,
  data-driven sparklines, hero banners on metric and analyst pages, and a workout time mix.
- **Medication dose strips,** a settings banner and restyled form controls.
- **Lab results from the MyChart (Epic) layout** can be read, next to the existing lab importer.
- **The analyst answers in prose,** honours your own stated context over a recorded value, names
  conditions only as possibilities, and links to a measurement instead of reciting it. Support
  sections are drawn as text and the measured list is gone.

### Removed
- The analyst's "measured" list.

### Fixed
- Analyst conversations are listed by when they were asked, not when they were last touched.
