// ── Basemap tile configuration ──────────────────────────
//
// CARTO's basemaps need an API key since September 2026 (free for
// non-commercial use: carto.com/basemaps/apikey). A tile key is public by
// design (it travels in every tile URL the browser requests), so it is not a
// secret; it is still read from the server environment at runtime rather than
// built into the bundle, so one image serves any deployment. Without a key the
// street map is OpenStreetMap's own standard tiles.

export interface TileConfig {
  /** CARTO basemaps key, or null to use OpenStreetMap's standard tiles. */
  cartoKey: string | null;
}

export function readTileConfig(env: NodeJS.ProcessEnv = process.env): TileConfig {
  const key = (env.MAP_TILES_CARTO_KEY ?? '').trim();
  return { cartoKey: /^[A-Za-z0-9._-]{8,200}$/.test(key) ? key : null };
}
