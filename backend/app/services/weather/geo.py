"""Coordinate helpers for the weather layer: LV95 ⇄ WGS84 ⇄ Web Mercator, and point-in-polygon.

The radar grid is LV95 (EPSG:2056); the map is Web Mercator. pyproj would do this, but it is a
40 MB dependency for one conversion. swisstopo's published approximation formulas
(«Näherungsformeln für die Transformation zwischen Schweizer Projektionskoordinaten und WGS84»)
are accurate to about a metre inside Switzerland, and against the radar file's own corner
coordinates – 300+ km outside the country – they still land within ~10 m of the 1 km grid
(tests/test_services/test_weather_radar.py pins that). A radar pixel is 1000 m, so that is
two orders of magnitude below anything the overlay can show.
"""

from __future__ import annotations

import math
from collections.abc import Sequence

import numpy as np
from numpy.typing import NDArray

#: WGS84 semi-major axis, the sphere Web Mercator projects onto.
EARTH_RADIUS_M = 6378137.0


def wgs84_to_lv95(
    lat: NDArray[np.float64], lon: NDArray[np.float64]
) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    """swisstopo approximation, vectorised. Degrees in, LV95 metres (E, N) out."""
    phi = (lat * 3600.0 - 169028.66) / 10000.0
    lam = (lon * 3600.0 - 26782.5) / 10000.0
    east = 2600072.37 + 211455.93 * lam - 10938.51 * lam * phi - 0.36 * lam * phi**2 - 44.54 * lam**3
    north = 1200147.07 + 308807.95 * phi + 3745.25 * lam**2 + 76.63 * phi**2 - 194.56 * lam**2 * phi + 119.79 * phi**3
    return east, north


def lv95_to_wgs84(east: float, north: float) -> tuple[float, float]:
    """swisstopo approximation, the inverse direction. LV95 metres in, (lat, lon) degrees out."""
    y = (east - 2600000.0) / 1000000.0
    x = (north - 1200000.0) / 1000000.0
    lam = 2.6779094 + 4.728982 * y + 0.791484 * y * x + 0.1306 * y * x**2 - 0.0436 * y**3
    phi = 16.9023892 + 3.238272 * x - 0.270978 * y**2 - 0.002528 * x**2 - 0.0447 * y**2 * x - 0.0140 * x**3
    return phi * 100.0 / 36.0, lam * 100.0 / 36.0


def lon_to_mercator_x(lon: float) -> float:
    return EARTH_RADIUS_M * math.radians(lon)


def lat_to_mercator_y(lat: float) -> float:
    return EARTH_RADIUS_M * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))


def mercator_x_to_lon(x: NDArray[np.float64]) -> NDArray[np.float64]:
    return np.degrees(x / EARTH_RADIUS_M)


def mercator_y_to_lat(y: NDArray[np.float64]) -> NDArray[np.float64]:
    return np.degrees(2.0 * np.arctan(np.exp(y / EARTH_RADIUS_M)) - math.pi / 2)


def point_in_ring(lat: float, lon: float, ring: Sequence[tuple[float, float]]) -> bool:
    """Ray casting on one closed ring of (lat, lon) vertices. Plain degrees: the warning regions
    are a few tens of kilometres across, where the curvature of a parallel is irrelevant."""
    inside = False
    count = len(ring)
    if count < 3:
        return False
    j = count - 1
    for i in range(count):
        lat_i, lon_i = ring[i]
        lat_j, lon_j = ring[j]
        if (lat_i > lat) != (lat_j > lat):
            crossing = lon_i + (lat - lat_i) * (lon_j - lon_i) / (lat_j - lat_i)
            if lon < crossing:
                inside = not inside
        j = i
    return inside


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in metres (for Alertswiss circle areas)."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371008.8 * math.asin(math.sqrt(a))
