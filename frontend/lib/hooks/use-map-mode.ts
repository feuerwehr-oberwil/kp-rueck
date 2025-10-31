/**
 * useMapMode Hook
 *
 * Manages map tile source mode (auto/online/offline) with automatic fallback.
 *
 * Modes:
 * - auto: Try online OSM tiles first, fall back to offline on error
 * - online: Always use online OSM tiles
 * - offline: Always use offline tiles (localhost:8080)
 */

import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';

export type MapMode = 'auto' | 'online' | 'offline';
export type EffectiveMode = 'online' | 'offline';

interface MapModeState {
  // User preference from settings
  preferredMode: MapMode;
  // Current effective mode (what's actually being used)
  effectiveMode: EffectiveMode;
  // Loading state
  loading: boolean;
  // Error state
  error: string | null;
}

export function useMapMode() {
  const [state, setState] = useState<MapModeState>({
    preferredMode: 'auto',
    effectiveMode: 'online',
    loading: true,
    error: null,
  });

  // Fetch map mode preference from settings
  useEffect(() => {
    let mounted = true;

    const fetchMapMode = async () => {
      try {
        const settings = await apiClient.getAllSettings();
        const mode = (settings.map_mode || 'auto') as MapMode;

        if (mounted) {
          setState((prev) => ({
            ...prev,
            preferredMode: mode,
            effectiveMode: mode === 'offline' ? 'offline' : 'online',
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

  /**
   * Handle tile load error (for auto mode)
   * Switches to offline when online tiles fail
   */
  const handleTileError = useCallback(() => {
    setState((prev) => {
      // Only switch to offline if in auto mode and currently online
      if (prev.preferredMode === 'auto' && prev.effectiveMode === 'online') {
        console.warn('Map tiles failed to load, switching to offline mode');
        return { ...prev, effectiveMode: 'offline' };
      }
      return prev;
    });
  }, []);

  /**
   * Reset effective mode to match preference
   * Used when user changes settings or to retry online
   */
  const resetEffectiveMode = useCallback(() => {
    setState((prev) => ({
      ...prev,
      effectiveMode: prev.preferredMode === 'offline' ? 'offline' : 'online',
    }));
  }, []);

  /**
   * Get tile layer URL based on current effective mode
   */
  const getTileUrl = useCallback((): string => {
    if (state.effectiveMode === 'offline') {
      // Use local tile server (basic-preview style with 512px tiles)
      return 'http://localhost:8080/styles/basic-preview/512/{z}/{x}/{y}.png';
    } else {
      // Use online OpenStreetMap
      return 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
    }
  }, [state.effectiveMode]);

  /**
   * Get attribution text based on current effective mode
   */
  const getAttribution = useCallback((): string => {
    const baseAttribution = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

    if (state.effectiveMode === 'offline') {
      return `${baseAttribution} (Offline)`;
    } else {
      return baseAttribution;
    }
  }, [state.effectiveMode]);

  return {
    // Current state
    preferredMode: state.preferredMode,
    effectiveMode: state.effectiveMode,
    loading: state.loading,
    error: state.error,

    // Helpers
    isOnline: state.effectiveMode === 'online',
    isOffline: state.effectiveMode === 'offline',
    isAuto: state.preferredMode === 'auto',

    // Functions
    handleTileError,
    resetEffectiveMode,
    getTileUrl,
    getAttribution,
  };
}
