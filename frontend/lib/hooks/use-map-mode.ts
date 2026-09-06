/**
 * useMapMode Hook
 *
 * Manages map tile source mode (auto/online/offline) with automatic fallback.
 * Also manages tile style selection (OSM, topo, satellite).
 *
 * Modes:
 * - auto: Try online tiles first, fall back to offline on error
 * - online: Always use online tiles
 * - offline: Always use offline tiles (the bundled tileserver)
 *
 * Styles (online only):
 * - osm: OpenStreetMap standard
 * - topo: Esri World Topo Map
 * - carto-light: CARTO Voyager (light, clean labels)
 * - carto-dark: CARTO Dark Matter (dark theme)
 *
 * The hook answers in MapLibre's shape: `getOnlineRasterBasemap()` hands out an explicit list of
 * tile URLs (a GL source lists its hosts rather than templating them), and
 * `getOfflineStyleUrl()`/`offlineBasemapFor()` hand out the tileserver's vector style document.
 *
 * `<BaseMap>` is the only consumer, and the surface is kept to what it actually asks for: which
 * source to draw, and what to do when its tiles fail. Anything else that was once returned here
 * was read by nobody.
 */

import { useState, useEffect, useCallback } from 'react';
import { getApiUrl, getCartoApiKey, getTileBaseUrl } from '@/lib/env';
import type { TileAvailability } from '@/lib/hooks/use-tile-availability';

export type MapMode = 'auto' | 'online' | 'offline';
export type EffectiveMode = 'online' | 'offline';
export type MapStyle = 'osm' | 'topo' | 'carto-light' | 'carto-dark';

interface TileConfig {
  /** XYZ URL template. `{s}` is the classic subdomain placeholder – MapLibre has no such thing,
   *  so `expandSubdomains()` writes it out into one concrete URL per host. */
  url: string;
  /** What `{s}` stands for. Omitted when the provider serves from a single host. */
  subdomains?: readonly string[];
  /** Edge length of one tile in px. The offline tileserver renders 512, everyone else 256. */
  tileSize: number;
  /** Deepest zoom the provider actually has tiles for; MapLibre overzooms past it. */
  maxzoom: number;
  attribution: string;
  /**
   * The tiles are ALREADY dark – they need lifting, not muting.
   *
   * Every other basemap here is a light map that gets desaturated (day) or dimmed (night) so the
   * overlays carry the colour. A dark raster arrives at that destination on its own, and the same
   * treatment ruins it in both themes: see `DARK_BASE_PAINT` in `lib/map-view.ts`.
   */
  dark?: boolean;
  /** This provider requires the runtime CARTO key as a query parameter. */
  carto?: boolean;
}

const TILE_STYLES: Record<MapStyle, TileConfig> = {
  osm: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    subdomains: ['a', 'b', 'c'],
    tileSize: 256,
    maxzoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  topo: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    tileSize: 256,
    maxzoom: 19,
    attribution: '© Esri, HERE, Garmin, OpenStreetMap contributors',
  },
  'carto-light': {
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
    subdomains: ['a', 'b', 'c', 'd'],
    tileSize: 256,
    maxzoom: 20,
    carto: true,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>',
  },
  'carto-dark': {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
    subdomains: ['a', 'b', 'c', 'd'],
    tileSize: 256,
    maxzoom: 20,
    dark: true,
    carto: true,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>',
  },
};

// Resolved per call, not at module load: the tile host depends on where the page is served
// from (dev → localhost:8080, deployment → /tiles on the same origin), and on the server
// there is no window to ask.
const OFFLINE_ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors (Offline)';

/**
 * A raster XYZ basemap as MapLibre wants it: one concrete URL per subdomain, since a MapLibre
 * source lists its hosts rather than templating them.
 */
export interface RasterBasemap {
  tiles: string[];
  tileSize: number;
  maxzoom: number;
  attribution: string;
  /** These tiles are already dark – the renderer has to lift them, not mute them. */
  dark: boolean;
}

/** `https://{s}.host/{z}/{x}/{y}.png` + `['a','b']` → one URL per subdomain. */
function expandSubdomains(config: TileConfig): string[] {
  const urls = config.subdomains?.length
    ? config.subdomains.map((s) => config.url.replace('{s}', s))
    : [config.url];
  const cartoApiKey = config.carto ? getCartoApiKey() : null;
  if (!cartoApiKey) return urls;
  return urls.map((url) => `${url}?key=${encodeURIComponent(cartoApiKey)}`);
}

const asRasterBasemap = (config: TileConfig): RasterBasemap => ({
  tiles: expandSubdomains(config),
  tileSize: config.tileSize,
  maxzoom: config.maxzoom,
  attribution: config.attribution,
  dark: config.dark ?? false,
});

/** What MapLibre renders for a mode: a whole style document, or one raster XYZ source. */
export type MapLibreBasemap =
  | { kind: 'vector'; styleUrl: string }
  | { kind: 'raster'; source: RasterBasemap };

/**
 * The offline basemap this station can actually render – or `null` when offline has nothing to
 * show and the caller should stay on the online source.
 *
 * `null` is the honest answer more often than the plan assumed. The "Bootstrap MBTiles" that
 * `scripts/init-tileserver.sh` writes on first boot holds zero tile rows: there is no style
 * (`/styles.json` is empty, `/styles/basic-preview/style.json` 404s) AND no raster to fall back
 * to (`/data/{id}/…png` 404s as well). Rendering "offline" against it produces a blank
 * rectangle with no error – exactly the failure the availability check exists to prevent.
 */
export function offlineBasemapFor(availability: TileAvailability): MapLibreBasemap | null {
  if (availability.status !== 'installed') return null

  if (availability.format === 'vector') {
    return { kind: 'vector', styleUrl: getOfflineStyleUrl() }
  }

  // A plain raster tileset is addressed by its own id under /data – there is no style to render
  // it through. Without an id it cannot be addressed at all.
  //
  // No tile-size segment: `/data/{id}/{z}/{x}/{y}.{ext}` is the whole route, and only `/styles/…`
  // takes a `{tileSize}` in front of the coordinates. And `index.json`'s `id` is the MBTiles file
  // basename, which is a usable route key only for a genuinely raster tileset – OpenMapTiles data
  // is served as `v3` whatever the file is called, which is why that case never gets here (the
  // vector branch above handles it).
  if (!availability.id) return null
  return {
    kind: 'raster',
    source: {
      tiles: [`${getTileBaseUrl()}/data/${availability.id}/{z}/{x}/{y}.png`],
      tileSize: 256,
      maxzoom: availability.maxzoom ?? 20,
      attribution: OFFLINE_ATTRIBUTION,
      // A locally installed tileset is whatever the station generated – the default extract is a
      // light map, and nothing here can tell. Treated as light, i.e. themed like any other.
      dark: false,
    },
  }
}

/** A hung settings request must not hold a map on its defaults for longer than a glance. */
const SETTINGS_TIMEOUT_MS = 5000;

/** True on a page whose only credential is a share token in the URL (`/display/map?token=…`). */
function hasShareToken(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).has('token');
}

/**
 * The station's map settings, or `null` when this page cannot read them.
 *
 * Deliberately NOT `apiClient.getAllSettings()`. That endpoint is authenticated, so on a
 * token-gated wall display it answers 401 on every mount – and the api-client turns a 401 into a
 * console warning plus a `kp:session-expired` event, i.e. a "Sitzung abgelaufen" message on a
 * screen that never had a session. A basemap preference is not worth any of that: ask plainly,
 * and treat no answer as no preference.
 *
 * No answer resolves to `auto`, which is the honest default here: the tile-availability probe
 * (`/tiles/index.json`) needs no auth, and `auto` falls back to those tiles the moment the online
 * ones fail. What it cannot do is honour an operator who explicitly chose «Nur Offline» – that
 * needs the mode in the token payload, which it does not carry today.
 */
async function fetchMapSettings(): Promise<Record<string, string> | null> {
  if (hasShareToken()) return null;
  try {
    const response = await fetch(`${getApiUrl()}/api/settings/`, {
      credentials: 'include',
      signal: AbortSignal.timeout(SETTINGS_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    return body && typeof body === 'object' ? (body as Record<string, string>) : null;
  } catch {
    return null;
  }
}

/**
 * The request currently in flight, shared by maps that mount together (the print sheet opening
 * over the board's map asks the same question at the same moment). Cleared on settle, so a later
 * mount still sees a settings change the operator just made.
 */
let pendingSettings: Promise<Record<string, string> | null> | null = null;

function readMapSettings(): Promise<Record<string, string> | null> {
  pendingSettings ??= fetchMapSettings().finally(() => {
    pendingSettings = null;
  });
  return pendingSettings;
}

interface MapModeState {
  preferredMode: MapMode;
  effectiveMode: EffectiveMode;
  mapStyle: MapStyle;
}

export function useMapMode() {
  const [state, setState] = useState<MapModeState>({
    preferredMode: 'auto',
    effectiveMode: 'online',
    mapStyle: 'osm',
  });

  // Fetch map mode and style preferences from settings
  useEffect(() => {
    let mounted = true;

    void readMapSettings().then((settings) => {
      // No settings – no preference. The defaults above already are `auto`/online.
      if (!mounted || !settings) return;
      const mode = (settings.map_mode || 'auto') as MapMode;
      const style = (settings.map_style || 'osm') as MapStyle;
      setState({
        preferredMode: mode,
        effectiveMode: mode === 'offline' ? 'offline' : 'online',
        mapStyle: TILE_STYLES[style] ? style : 'osm',
      });
    });

    return () => {
      mounted = false;
    };
  }, []);

  const handleTileError = useCallback(() => {
    setState((prev) => {
      if (prev.preferredMode === 'auto' && prev.effectiveMode === 'online') {
        console.warn('Map tiles failed to load, switching to offline mode');
        return { ...prev, effectiveMode: 'offline' };
      }
      return prev;
    });
  }, []);

  /** The selected online style as a MapLibre raster source, whatever the effective mode is. */
  const getOnlineRasterBasemap = useCallback(
    (): RasterBasemap => asRasterBasemap(TILE_STYLES[state.mapStyle] ?? TILE_STYLES.osm),
    [state.mapStyle],
  );

  return {
    isOnline: state.effectiveMode === 'online',
    handleTileError,
    getOnlineRasterBasemap,
  };
}

/**
 * The offline vector style document served by the bundled tileserver.
 *
 * Free-standing rather than a hook member: it depends on nothing but the request's own origin,
 * and the same rule as `offlineTile()` applies – resolve per call, never at module load.
 */
export function getOfflineStyleUrl(): string {
  return `${getTileBaseUrl()}/styles/basic-preview/style.json`;
}
