# Changelog

## [0.3.0] - 2026-10-04

_Release in progress: the date is set when the version is tagged._

### Changed

- Keep Settings reachable when no live source is connected, so a ring-only setup can connect; other pages still show the "Live source unreachable" screen, now with an **Open Settings** link and no source named ([`12c634e`](https://github.com/echupkin/vital/commit/12c634e))
- List only the measures a connected source can provide in Settings → Data coverage and the Trends pickers, so Apple-only measures are no longer shown as "No data" when only a ring is connected ([`458d0d2`](https://github.com/echupkin/vital/commit/458d0d2))
- Show unknown workout calories as "not recorded" instead of 0 ([`dc34bcb`](https://github.com/echupkin/vital/commit/dc34bcb))
- Make VO2 max from Oura opt-in: add `heart_health` to `OURA_SCOPES` and reconnect to include it ([`eab74a4`](https://github.com/echupkin/vital/commit/eab74a4))

### Added

- Add Oura Ring as a live data source, alone or next to Health Auto Export: set `OURA_CLIENT_ID`, `OURA_CLIENT_SECRET`, `OURA_REDIRECT_URI` and `VITAL_SECRET_KEY`, then press **Connect** in Settings → Connections. It supplies sleep, breathing rate, steps, active calories, blood oxygen, heart rate and workouts; Oura's own scores are not shown ([`c004ce5`](https://github.com/echupkin/vital/commit/c004ce5), [`7c26456`](https://github.com/echupkin/vital/commit/7c26456))
- Add overnight HRV (RMSSD), lowest overnight heart rate and temperature deviation as separate ring measurements ([`7590c69`](https://github.com/echupkin/vital/commit/7590c69))
- Merge both sources under one stated rule: one source per measure per day, never added together, ring first for sleep and recovery (`OURA_PREFERRED_FOR` changes it) ([`30a59ce`](https://github.com/echupkin/vital/commit/30a59ce), [`efd6658`](https://github.com/echupkin/vital/commit/efd6658))
- Store the Oura login encrypted in Postgres, the only thing kept; no Oura reading is stored ([`41ceaa4`](https://github.com/echupkin/vital/commit/41ceaa4), [`c7b5489`](https://github.com/echupkin/vital/commit/c7b5489))
- Erase a removed source as if it had never existed: cached data, routes and briefings go at once, analyst conversations that used it are hidden at once and deleted after a grace period (`VITAL_SOURCE_PURGE_GRACE_DAYS`, default 7), and Settings lists removed sources ([`2657000`](https://github.com/echupkin/vital/commit/2657000), [`6f576c6`](https://github.com/echupkin/vital/commit/6f576c6), [`60fc9b7`](https://github.com/echupkin/vital/commit/60fc9b7))
- Record which sources fed each analyst answer ([`70aea49`](https://github.com/echupkin/vital/commit/70aea49))
- Add a per-source summary at the top of Settings → Data coverage ([`699f34e`](https://github.com/echupkin/vital/commit/699f34e))
- Document connecting Oura through an SSH tunnel when the browser is not on the Vital machine, and show Health Auto Export and Oura setup side by side in the README ([`45e6219`](https://github.com/echupkin/vital/commit/45e6219))

### Fixed

- Fix Oura scopes reported with a namespace (`extapi:daily`) being read as "not allowed", and one refused measure failing all the others and reporting a bad token ([`bbd6de3`](https://github.com/echupkin/vital/commit/bbd6de3), [`1f20d92`](https://github.com/echupkin/vital/commit/1f20d92))
- Fix a sleep recorded twice by one device counting twice: each wake-up day keeps one episode ([`f66892c`](https://github.com/echupkin/vital/commit/f66892c))
- Fix overlapping workouts from two apps counting twice ([`dc34bcb`](https://github.com/echupkin/vital/commit/dc34bcb))
- Fix one blood-pressure reading synced by two apps counting twice; readings from the same cuff are always kept ([`7eb08e2`](https://github.com/echupkin/vital/commit/7eb08e2))
- Fix the local Docker build packaging your `data/` folder, including lab PDFs, into the image; published images were not affected ([`e1a1119`](https://github.com/echupkin/vital/commit/e1a1119))
- Remove report values from source comments and tests, replacing them with invented ones ([`f22db9d`](https://github.com/echupkin/vital/commit/f22db9d))

## [0.2.4] - 2026-10-03

### Changed

- Bring the workout pages onto the graphite-and-indigo redesign ([`28eeabe`](https://github.com/echupkin/vital/commit/28eeabe))
- Name the map and place-search services in the trademark notice ([`d94b5cb`](https://github.com/echupkin/vital/commit/d94b5cb))

### Added

- Add Activity → Maps, maps of where outdoor workouts went, with a framing step, finer zoom and a preview of routes past the frame ([`0821dea`](https://github.com/echupkin/vital/commit/0821dea), [`7e9be67`](https://github.com/echupkin/vital/commit/7e9be67), [`abb1cbf`](https://github.com/echupkin/vital/commit/abb1cbf))
- Choose each map's tile provider, style and light or dark, label each map with its dates ending on "Today", and show a loading overlay while it reads its routes ([`5be1cce`](https://github.com/echupkin/vital/commit/5be1cce), [`c2f44b5`](https://github.com/echupkin/vital/commit/c2f44b5), [`7acccbf`](https://github.com/echupkin/vital/commit/7acccbf))
- Shade heart-rate maps cool to hot, and smooth frequency maps along the streets ([`b01f317`](https://github.com/echupkin/vital/commit/b01f317), [`dcb0766`](https://github.com/echupkin/vital/commit/dcb0766))
- Show the longest session on map cards ([`744d4fe`](https://github.com/echupkin/vital/commit/744d4fe))
- Add app icons and a web app manifest, so Vital can be added to a phone's Home Screen ([`cd4c30e`](https://github.com/echupkin/vital/commit/cd4c30e))
- Publish multi-architecture container images from CI, after testing and smoke-testing them ([`6cb4bc0`](https://github.com/echupkin/vital/commit/6cb4bc0))

### Fixed

- Fix walking heart rate, VO2 max, waist circumference, cycling distance and sodium not being read, by using Health Auto Export's names for them ([`417bf06`](https://github.com/echupkin/vital/commit/417bf06))
- Fix tapping a map highlight again not turning it off, map routes drawn at whole pixels, and uneven map borders in Safari ([`10b6f1f`](https://github.com/echupkin/vital/commit/10b6f1f), [`2cf9495`](https://github.com/echupkin/vital/commit/2cf9495), [`1b0fa04`](https://github.com/echupkin/vital/commit/1b0fa04))

## [0.2.3] - 2026-10-02

### Added

- Fetch health data on demand for the analyst and budget its fixed context, so long histories and lab results fit; `ANALYST_CONTEXT=ondemand` turns it on and full context stays the default ([`012140c`](https://github.com/echupkin/vital/commit/012140c))
- Add a Stop button and a guard that stops a model that cannot stop, so a runaway answer no longer spins indefinitely ([`eaadeba`](https://github.com/echupkin/vital/commit/eaadeba))
- License Vital under AGPL-3.0 and add screenshots and a trademark notice ([`1188b7d`](https://github.com/echupkin/vital/commit/1188b7d))

### Fixed

- Fix a reply that was valid JSON but held no answer being shown empty ([`58f4b0b`](https://github.com/echupkin/vital/commit/58f4b0b))

## [0.2.2] - 2026-10-01

_Documentation only; this version was merged but never tagged._

### Changed

- Lead the README with what Vital is for and what it does ([`a95544b`](https://github.com/echupkin/vital/commit/a95544b))

## [0.2.1] - 2026-10-01

### Changed

- Show days and times in your timezone instead of UTC ([`a231c72`](https://github.com/echupkin/vital/commit/a231c72))
- Make Workouts the routine dashboard, with history on `/workouts/all` ([`0849fa0`](https://github.com/echupkin/vital/commit/0849fa0))
- Use one date-range control everywhere: 7, 30 or 90 days, plus a custom range ([`6b57a98`](https://github.com/echupkin/vital/commit/6b57a98), [`1868845`](https://github.com/echupkin/vital/commit/1868845))
- Name a data source only in Settings, dropping the coverage and source footers from pages ([`d991fcc`](https://github.com/echupkin/vital/commit/d991fcc))
- Show the analyst's answer as it forms and animate the wait for the first bytes ([`3c05d93`](https://github.com/echupkin/vital/commit/3c05d93), [`952ae77`](https://github.com/echupkin/vital/commit/952ae77))
- Focus the daily briefing on the goals set in Settings ([`0dcc6f4`](https://github.com/echupkin/vital/commit/0dcc6f4))

### Added

- Add a training routine: a plan with cadence, phases and calendar blocks, a page per progression path with readiness bars, a Recovery page, and a page per workout ([`0eeb78b`](https://github.com/echupkin/vital/commit/0eeb78b), [`e7b9abd`](https://github.com/echupkin/vital/commit/e7b9abd), [`7af23c1`](https://github.com/echupkin/vital/commit/7af23c1), [`c30d250`](https://github.com/echupkin/vital/commit/c30d250))
- Evaluate progress with pluggable progression models, pause progress on deloads, and fall back gracefully when no workout source is connected ([`637e3c5`](https://github.com/echupkin/vital/commit/637e3c5), [`f6604d7`](https://github.com/echupkin/vital/commit/f6604d7), [`7a1d967`](https://github.com/echupkin/vital/commit/7a1d967))
- Let the analyst read and change the training plan with tools, and discuss a routine page in a dialog ([`10672e5`](https://github.com/echupkin/vital/commit/10672e5), [`cad2fe2`](https://github.com/echupkin/vital/commit/cad2fe2))
- Add workout sources as plugins, starting with Hevy, and name the source that also logged a session ([`8886db3`](https://github.com/echupkin/vital/commit/8886db3), [`7287f5a`](https://github.com/echupkin/vital/commit/7287f5a))
- Add a Themes page with popular light and dark themes ([`6112991`](https://github.com/echupkin/vital/commit/6112991))
- Add breadcrumbs and a nested sidebar ([`c497b1d`](https://github.com/echupkin/vital/commit/c497b1d))

### Fixed

- Fix the analyst's prose analysis, next steps and summary not being saved with each turn ([`845ada0`](https://github.com/echupkin/vital/commit/845ada0))
- Fix the analyst failing when a model answers in prose after using tools, returns an empty reply, or refuses parameters newer models no longer accept ([`eeeac58`](https://github.com/echupkin/vital/commit/eeeac58), [`fab8736`](https://github.com/echupkin/vital/commit/fab8736), [`d433bca`](https://github.com/echupkin/vital/commit/d433bca))
- Fix the Hevy settings not reaching the app container ([`ce37443`](https://github.com/echupkin/vital/commit/ce37443))
- Fix metric charts missing the baseline band ([`3443ac6`](https://github.com/echupkin/vital/commit/3443ac6))

## [0.2.0] - 2026-09-30

### Changed

- Redesign the interface around a graphite-and-indigo identity, with page banners, a body figure and data-driven sparklines ([`aff3401`](https://github.com/echupkin/vital/commit/aff3401), [`769ff40`](https://github.com/echupkin/vital/commit/769ff40), [`a03b3ef`](https://github.com/echupkin/vital/commit/a03b3ef))
- Answer analyst questions in prose, honouring your own stated context over a recorded value and naming conditions only as possibilities ([`33ddabd`](https://github.com/echupkin/vital/commit/33ddabd))
- Link to a measurement in analyst answers instead of reciting it ([`5019418`](https://github.com/echupkin/vital/commit/5019418))

### Added

- Add medication dose strips, a settings banner and restyled form controls ([`6f12070`](https://github.com/echupkin/vital/commit/6f12070))
- Read lab results in the MyChart (Epic) layout ([`c168b35`](https://github.com/echupkin/vital/commit/c168b35))

### Removed

- Remove the analyst's "measured" list ([`d8dc069`](https://github.com/echupkin/vital/commit/d8dc069))

### Fixed

- Fix analyst conversations being ordered by when they were last touched instead of when they were asked ([`2e9a981`](https://github.com/echupkin/vital/commit/2e9a981))

[0.3.0]: https://github.com/echupkin/vital/releases/tag/v0.3.0
[0.2.4]: https://github.com/echupkin/vital/releases/tag/v0.2.4
[0.2.3]: https://github.com/echupkin/vital/releases/tag/v0.2.3
[0.2.2]: https://github.com/echupkin/vital/commit/74d9494
[0.2.1]: https://github.com/echupkin/vital/releases/tag/v0.2.1
[0.2.0]: https://github.com/echupkin/vital/commit/be89f69
