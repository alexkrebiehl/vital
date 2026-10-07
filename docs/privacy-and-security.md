# Privacy and security

What Vital does and does not do with your data, and what to put in front of it before exposing it.

[← Back to the README](../README.md)

---

# Privacy and security

- **No third-party analytics, trackers or telemetry.** `NEXT_TELEMETRY_DISABLED=1` is set in
  every image stage, so Next.js does not phone home either. There is no analytics dependency
  in `package.json`.
- **No health values in logs.** Server logs record pipeline outcomes (HTTP status, duration,
  outcome name), not metric values.
- **No secrets in the client bundle.** All integration variables are unprefixed
  (`HAE_*`, `MONGO*`, `ANALYST_*`) and read only in server modules, so they never reach the
  browser. `src/lib/adapters/index.ts` deliberately does not re-export the server-only entry
  points (`hae.ts`, `live.ts`, `runtime.ts`). Verified by grepping every served
  `.next/static/chunks/*.js` for the token, the configured host and recorded raw live values:
  none is present.
- **Personal health responses are never publicly cacheable.** Every route answers with
  `Cache-Control: private, no-store` (set in `next.config.js` and repeated on the API routes),
  plus `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` and
  `X-Frame-Options: DENY`.
- **No secrets in the image or in git.** `.env` is gitignored and excluded from the build
  context by `.dockerignore`; nothing sensitive is baked into a layer. Runtime configuration
  is passed via the environment, and the token is only ever sent as an upstream HTTP header —
  never written into a file, a URL, a log line or the report.
- **Maps talk to two outside services, and say so.** On Activity → Maps:
  - **Basemap tiles** load straight from the tile provider into the browser (each map chooses
    CARTO, OpenStreetMap or OpenTopoMap; CARTO's key comes from `MAP_TILES_CARTO_KEY` and is sent in
    its tile URLs). A tile request
    tells the provider which area is on screen. Vital pages send no `Referer`; tile requests opt
    back in to the **origin only** (`strict-origin-when-cross-origin`), because OpenStreetMap's
    tile policy requires one — the provider learns your Vital host name, never a page path. Your
    routes are drawn in the browser on top of the tiles and are never sent to the provider.
  - **Place search** in the add-map dialog is sent from Vital's server to the geocoder
    (`GEOCODER_URL`, OpenStreetMap Nominatim by default) — the text you type leaves your network,
    which is what a geocoder is. `GEOCODER_URL=off` turns it off; typing `lat, lon` or using your
    browser's location works either way and sends nothing.
- **Map areas are stored, routes are not.** Each map's bounding box and name live in Postgres
  with your other configuration (often a box around home, which is why it is never logged).
  Routes and heart rate are read live from Health Auto Export, held in server memory only, and
  never written to the database or to disk.
- **Oura calls are server-to-server only.** The browser never talks to Oura and never sees a token.
  The sign-in `state` and PKCE verifier travel in a short-lived, encrypted, `httpOnly` cookie
  scoped to the Oura routes. Vital stores only the app credentials (client ID, secret, redirect URI) and
  the OAuth tokens, encrypted at rest with `VITAL_SECRET_KEY` (AES-256-GCM); no Oura reading is written to the database, a file or a log.
  Back up and protect that key: without it a stored connection cannot be read, and anyone who
  has it and the database can.
- **Connection keys are stored encrypted, and are never shown.** Settings saves the Health Auto
  Export address and read key, the Oura client secret and the Hevy key to Postgres, encrypted with
  `VITAL_SECRET_KEY` (AES-256-GCM). The API returns only the last 4 characters of a key, never the
  key, and no log line carries it. No health value is stored. `HAE_API_URL`, `HAE_API_KEY`,
  `OURA_CLIENT_ID`, `OURA_CLIENT_SECRET`, `OURA_REDIRECT_URI`, `HEVY_API_KEY` and `HEVY_API_URL` in
  the environment are ignored. The environment holds only admin settings.
- **Vital has no login.** Anyone who can reach it can press **Connect** or **Disconnect** on
  Oura. Put your own authentication in front of it before exposing it.
- **Removing a source erases what Vital holds, at once, not what you copied.** See *Removing a
  source* in [Data sources](data-sources.md#removing-a-source). Screenshots and exports you made
  yourself, and Postgres backups taken before the removal, are outside Vital's reach.
- **Deploy on a private LAN or VPN, or behind an authenticated reverse proxy.** The container
  has no built-in authentication or TLS: anyone who can reach the port sees the dashboard.
  Put an authenticating reverse proxy in front of it before exposing it beyond a trusted
  network.
- **No HIPAA compliance or production-security claims.** This is a demo build for personal
  use: no audit logging, no encryption at rest (apart from the stored connection keys and Oura tokens), no multi-user isolation, no rate limiting,
  no hardened base-image supply chain process.
