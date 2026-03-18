/**
 * useMapMode Hook
 *
 * Manages map tile source mode (auto/online/offline) with automatic fallback.
 * Also manages tile style selection (OSM, topo, satellite).
 *
 * Modes:
 * - auto: Try online tiles first, fall back to offline on error
 * - online: Always use online tiles
 * - offline: Always use offline tiles (localhost:8080)
 *
 * Styles (online only):
 * - osm: OpenStreetMap standard
 * - topo: Esri World Topo Map
 * - carto-light: CARTO Voyager (light, clean labels)
 * - carto-dark: CARTO Dark Matter (dark theme)
 */

import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';

export type MapMode = 'auto' | 'online' | 'offline';
export type EffectiveMode = 'online' | 'offline';
export type MapStyle = 'osm' | 'topo' | 'carto-light' | 'carto-dark';

interface TileConfig {
  url: string;
  attribution: string;
}

const TILE_STYLES: Record<MapStyle, TileConfig> = {
  osm: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  topo: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: '© Esri, HERE, Garmin, OpenStreetMap contributors',
  },
  'carto-light': {
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>',
  },
  'carto-dark': {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>',
  },
};

const OFFLINE_TILE: TileConfig = {
  url: 'http://localhost:8080/styles/basic-preview/512/{z}/{x}/{y}.png',
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors (Offline)',
};

interface MapModeState {
  preferredMode: MapMode;
  effectiveMode: EffectiveMode;
  mapStyle: MapStyle;
  loading: boolean;
  error: string | null;
}

export function useMapMode() {
  const [state, setState] = useState<MapModeState>({
    preferredMode: 'auto',
    effectiveMode: 'online',
    mapStyle: 'osm',
    loading: true,
    error: null,
  });

  // Fetch map mode and style preferences from settings
  useEffect(() => {
    let mounted = true;

    const fetchMapMode = async () => {
      try {
        const settings = await apiClient.getAllSettings();
        const mode = (settings.map_mode || 'auto') as MapMode;
        const style = (settings.map_style || 'osm') as MapStyle;

        if (mounted) {
          setState((prev) => ({
            ...prev,
            preferredMode: mode,
            effectiveMode: mode === 'offline' ? 'offline' : 'online',
            mapStyle: TILE_STYLES[style] ? style : 'osm',
            loading: false,
          }));
        }
      } catch (error) {
        console.error('Failed to fetch map mode:', error);
        if (mounted) {
          setState((prev) => ({
            ...prev,
            loading: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          }));
        }
      }
    };

    fetchMapMode();

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

  const resetEffectiveMode = useCallback(() => {
    setState((prev) => ({
      ...prev,
      effectiveMode: prev.preferredMode === 'offline' ? 'offline' : 'online',
    }));
  }, []);

  const getTileUrl = useCallback((): string => {
    if (state.effectiveMode === 'offline') {
      return OFFLINE_TILE.url;
    }
    return TILE_STYLES[state.mapStyle]?.url || TILE_STYLES.osm.url;
  }, [state.effectiveMode, state.mapStyle]);

  const getAttribution = useCallback((): string => {
    if (state.effectiveMode === 'offline') {
      return OFFLINE_TILE.attribution;
    }
    return TILE_STYLES[state.mapStyle]?.attribution || TILE_STYLES.osm.attribution;
  }, [state.effectiveMode, state.mapStyle]);

  return {
    preferredMode: state.preferredMode,
    effectiveMode: state.effectiveMode,
    mapStyle: state.mapStyle,
    loading: state.loading,
    error: state.error,

    isOnline: state.effectiveMode === 'online',
    isOffline: state.effectiveMode === 'offline',
    isAuto: state.preferredMode === 'auto',

    handleTileError,
    resetEffectiveMode,
    getTileUrl,
    getAttribution,
  };
}
