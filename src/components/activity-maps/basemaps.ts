// ── Basemap tile providers ──────────────────────────────
//
// Almost nothing about the two providers is interchangeable (subdomains, a
// retina suffix on one and not the other, zoom ceilings of 20 against 17), so
// each is a descriptor rather than a URL swap. Above a provider's native
// ceiling Leaflet upscales its last real tile instead of requesting tiles the
// server does not have.
//
// Tiles load straight from the provider into the browser, which tells the
// provider which area is on screen and, through the Referer, which site asked
// (see docs/privacy-and-security.md). Vital's pages send no Referer at all, so
// tile requests opt back in to the ORIGIN alone: OpenStreetMap's tile policy
// requires one, and a CARTO key can be restricted to a domain.
// Attribution is always shown: every provider requires it, and OpenTopoMap's
// CC-BY-SA licence also requires crediting the map style.

import type { BasemapId } from '@/lib/activity-maps/types';
import type { TileConfig } from '@/lib/activity-maps/tiles';

export interface BasemapDescriptor {
  id: BasemapId;
  label: string;
  url: { light: string; dark: string };
  subdomains: string;
  maxNativeZoom: number;
  attribution: string;
  /** False when the tiles have no dark rendering: the light ramps are used on them. */
  followsTheme: boolean;
}

export const TILE_REFERRER_POLICY = 'strict-origin-when-cross-origin' as const;

const OSM = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors';

function street(config: TileConfig): BasemapDescriptor {
  if (config.cartoKey) {
    const key = encodeURIComponent(config.cartoKey);
    return {
      id: 'street',
      label: 'Street',
      url: {
        light: `https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?key=${key}`,
        dark: `https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?key=${key}`,
      },
      subdomains: 'abcd',
      maxNativeZoom: 20,
      attribution: `${OSM} &copy; <a href="https://carto.com/attributions" target="_blank" rel="noreferrer">CARTO</a>`,
      followsTheme: true,
    };
  }
  return {
    id: 'street',
    label: 'Street',
    url: {
      light: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      dark: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    },
    subdomains: '',
    maxNativeZoom: 19,
    attribution: OSM,
    followsTheme: false,
  };
}

const TOPO: BasemapDescriptor = {
  id: 'topo',
  label: 'Terrain',
  url: {
    light: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    dark: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
  },
  subdomains: 'abc',
  maxNativeZoom: 17,
  attribution: `Map data: ${OSM}, SRTM | Map style: &copy; <a href="https://opentopomap.org" target="_blank" rel="noreferrer">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="noreferrer">CC-BY-SA</a>)`,
  followsTheme: false,
};

export function basemap(id: BasemapId, config: TileConfig): BasemapDescriptor {
  return id === 'topo' ? TOPO : street(config);
}

export const BASEMAP_LABELS: Record<BasemapId, string> = { street: 'Street', topo: 'Terrain' };

export const MAX_ZOOM = 19;
