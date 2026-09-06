"""Bounded online geocoding without forwarding credentials or storing queries in the DB."""

import asyncio
import json
import logging
import math
import time
from collections import OrderedDict
from contextvars import ContextVar
from datetime import timedelta
from html.parser import HTMLParser
from typing import Any

import httpx
from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..models import GeocodingDispatch
from ..schemas.geocoding import AddressReverse, AddressSearch, AddressSuggestion

SWISS_BASE = "https://api3.geo.admin.ch/rest/services/ech"
ADDRESS_LAYER = "ch.swisstopo.amtliches-gebaeudeadressverzeichnis"
DISPATCH_INTERVAL = timedelta(milliseconds=1600)  # <=38 requests per rolling minute across workers
CACHE_TTL = 300
CACHE_LIMIT = 128
MAX_RESPONSE_BYTES = 128 * 1024
REQUEST_TIMEOUT = 5.0
_request_active: ContextVar[bool] = ContextVar("geocoding_request", default=False)


class _PrivateProviderLog(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        # httpx's INFO request log includes the full query URL. Other HTTP clients keep logging.
        return not _request_active.get()


logging.getLogger("httpx").addFilter(_PrivateProviderLog())


class GeocodingBusyError(Exception):
    """A previous caller used this installation's shared upstream allowance."""


class GeocodingUnavailableError(Exception):
    """The provider did not supply a bounded, successful response."""


class _PlainLabel(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        self.parts.append(data)


def _label(value: object) -> str:
    if not isinstance(value, str):
        return ""
    parser = _PlainLabel()
    parser.feed(value[:2000])
    return " ".join(" ".join(parser.parts).split())[:500]


def _coordinate(value: object, limit: int) -> float:
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        raise ValueError("Invalid coordinate")
    number = float(value)
    if not math.isfinite(number) or not -limit <= number <= limit:
        raise ValueError("Invalid coordinate")
    return number


def _distance(lat: float, lon: float, other_lat: float, other_lon: float) -> float:
    dlat, dlon = math.radians(other_lat - lat), math.radians(other_lon - lon)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat)) * math.cos(math.radians(other_lat)) * math.sin(dlon / 2) ** 2
    )
    return 6371000 * 2 * math.asin(math.sqrt(min(1, a)))


async def reserve_dispatch(db: AsyncSession) -> None:
    """Commit one atomic reservation, without queueing callers or retaining their queries."""
    statement = insert(GeocodingDispatch).values(id=1, next_request_at=func.clock_timestamp() + DISPATCH_INTERVAL)
    reservation = statement.on_conflict_do_update(
        index_elements=[GeocodingDispatch.id],
        set_={"next_request_at": func.clock_timestamp() + DISPATCH_INTERVAL},
        where=GeocodingDispatch.next_request_at <= func.clock_timestamp(),
    ).returning(GeocodingDispatch.id)
    reserved = (await db.execute(reservation)).scalar_one_or_none()
    await db.commit()
    if reserved is None:
        raise GeocodingBusyError


class Geocoder:
    """One small per-worker memory cache; the database gate covers all worker caches."""

    def __init__(self) -> None:
        self.cache: OrderedDict[tuple[str, tuple[tuple[str, str], ...]], tuple[float, Any]] = OrderedDict()

    async def _fetch(self, url: str, parameters: dict[str, str]) -> Any:
        marker = _request_active.set(True)
        try:
            async with asyncio.timeout(REQUEST_TIMEOUT):
                async with httpx.AsyncClient(
                    timeout=httpx.Timeout(3, connect=2),
                    follow_redirects=False,
                    trust_env=False,
                    headers={
                        "User-Agent": "KP-Rueck-Geocoding/1.0",
                        "Accept": "application/json",
                        "Accept-Encoding": "identity",
                    },
                ) as client:
                    async with client.stream("GET", url, params=parameters) as response:
                        if (
                            response.status_code != 200
                            or response.headers.get("content-encoding", "identity") != "identity"
                        ):
                            raise GeocodingUnavailableError
                        body = bytearray()
                        async for chunk in response.aiter_bytes(chunk_size=16384):
                            body.extend(chunk)
                            if len(body) > MAX_RESPONSE_BYTES:
                                raise GeocodingUnavailableError
                        return json.loads(body)
        except (httpx.HTTPError, TimeoutError, ValueError):
            raise GeocodingUnavailableError from None
        finally:
            _request_active.reset(marker)

    async def _lookup(self, db: AsyncSession, url: str, parameters: dict[str, str]) -> Any:
        key = (url, tuple(sorted(parameters.items())))
        now = time.monotonic()
        for stale in [entry for entry, (expiry, _) in self.cache.items() if expiry <= now]:
            del self.cache[stale]
        if key in self.cache:
            self.cache.move_to_end(key)
            return self.cache[key][1]
        await reserve_dispatch(db)
        payload = await self._fetch(url, parameters)
        self.cache[key] = (time.monotonic() + CACHE_TTL, payload)
        while len(self.cache) > CACHE_LIMIT:
            self.cache.popitem(last=False)
        return payload

    async def search(self, db: AsyncSession, query: AddressSearch) -> list[AddressSuggestion]:
        if settings.geocoding_provider == "disabled":
            return []
        if settings.geocoding_provider == "swisstopo":
            if query.countrycodes and "ch" not in query.countrycodes.split(","):
                return []
            # SearchServer's bbox is a hard filter, unlike Nominatim's viewbox bias.
            # Keep Swiss results broad; the caller already sorts around its station.
            payload = await self._lookup(
                db,
                SWISS_BASE + "/SearchServer",
                {
                    "searchText": query.q,
                    "type": "locations",
                    "origins": "address,gazetteer,zipcode",
                    "limit": "10",
                    "sr": "4326",
                },
            )
            if not isinstance(payload, dict) or not isinstance(payload.get("results"), list):
                raise GeocodingUnavailableError
            results = []
            for entry in payload["results"][:10]:
                if not isinstance(entry, dict) or not isinstance(entry.get("attrs"), dict):
                    continue
                attrs = entry["attrs"]
                try:
                    lat, lon = _coordinate(attrs.get("lat"), 90), _coordinate(attrs.get("lon"), 180)
                except ValueError:
                    continue
                label = _label(attrs.get("label"))
                if label:
                    results.append(
                        AddressSuggestion(
                            id=f"swisstopo:{lat}:{lon}:{label}",
                            display_name=label,
                            lat=lat,
                            lon=lon,
                            formattedAddress=label,
                            attribution="© Data: swisstopo",
                        )
                    )
            return results
        base = settings.geocoding_nominatim_url
        if not base:
            raise GeocodingUnavailableError
        parameters = {"q": query.q, "format": "jsonv2", "addressdetails": "1", "limit": "10"}
        if query.countrycodes:
            parameters["countrycodes"] = query.countrycodes
        if query.viewbox:
            parameters.update(viewbox=query.viewbox, bounded="0")
        payload = await self._lookup(db, base + "/search", parameters)
        if not isinstance(payload, list):
            raise GeocodingUnavailableError
        return [result for entry in payload[:10] if (result := _nominatim_result(entry)) is not None]

    async def reverse(self, db: AsyncSession, point: AddressReverse) -> str | None:
        if settings.geocoding_provider == "disabled":
            return None
        if settings.geocoding_provider == "nominatim":
            if not settings.geocoding_nominatim_url:
                raise GeocodingUnavailableError
            payload = await self._lookup(
                db,
                settings.geocoding_nominatim_url + "/reverse",
                {
                    "lat": str(point.lat),
                    "lon": str(point.lon),
                    "format": "jsonv2",
                    "addressdetails": "1",
                },
            )
            if isinstance(payload, dict) and payload.get("error"):
                return None
            result = _nominatim_result(payload)
            return result.formattedAddress if result else None
        latitude_delta = math.degrees(100 / 6371000)
        longitude_delta = latitude_delta / max(math.cos(math.radians(point.lat)), 0.000001)
        extent = (
            max(-180, point.lon - longitude_delta),
            max(-90, point.lat - latitude_delta),
            min(180, point.lon + longitude_delta),
            min(90, point.lat + latitude_delta),
        )
        payload = await self._lookup(
            db,
            SWISS_BASE + "/MapServer/identify",
            {
                "geometry": ",".join(str(value) for value in extent),
                "geometryType": "esriGeometryEnvelope",
                "layers": "all:" + ADDRESS_LAYER,
                "tolerance": "0",
                "sr": "4326",
                "geometryFormat": "geojson",
                "returnGeometry": "true",
                "limit": "200",
            },
        )
        if not isinstance(payload, dict) or not isinstance(payload.get("results"), list):
            raise GeocodingUnavailableError
        candidates: list[tuple[float, str]] = []
        for entry in payload["results"][:200]:
            if not isinstance(entry, dict):
                continue
            geometry, properties = entry.get("geometry"), entry.get("properties")
            if not isinstance(geometry, dict) or not isinstance(properties, dict) or geometry.get("type") != "Point":
                continue
            coordinates = geometry.get("coordinates")
            if not isinstance(coordinates, list) or len(coordinates) < 2:
                continue
            try:
                lon, lat = _coordinate(coordinates[0], 180), _coordinate(coordinates[1], 90)
            except ValueError:
                continue
            label = _label(properties.get("label"))
            distance = _distance(point.lat, point.lon, lat, lon)
            if label and distance <= 100:
                candidates.append((distance, label))
        return min(candidates)[1] if candidates else None


def _nominatim_result(entry: object) -> AddressSuggestion | None:
    if not isinstance(entry, dict):
        return None
    try:
        lat, lon = _coordinate(entry.get("lat"), 90), _coordinate(entry.get("lon"), 180)
    except ValueError:
        return None
    label = _label(entry.get("display_name"))
    if not label:
        return None
    address = entry.get("address")
    formatted = label
    if isinstance(address, dict):
        street = " ".join(filter(None, [_label(address.get("road")), _label(address.get("house_number"))]))
        city = next(
            (_label(address.get(key)) for key in ("city", "town", "village", "municipality") if address.get(key)), ""
        )
        locality = " ".join(filter(None, [_label(address.get("postcode")), city]))
        formatted = ", ".join(filter(None, [street, locality])) or label
    return AddressSuggestion(
        id=f"nominatim:{lat}:{lon}:{label}",
        display_name=label,
        lat=lat,
        lon=lon,
        formattedAddress=formatted,
        attribution="© OpenStreetMap contributors",
    )


geocoder = Geocoder()
