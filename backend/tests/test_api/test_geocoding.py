"""Geocoding must authenticate before sharing data and obey one shared provider budget."""

import asyncio
import gzip
import logging
from datetime import UTC, datetime

import httpx
import pytest
from pydantic import ValidationError
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.config import Settings, settings
from app.models import FeldDeviceClaim, GeocodingDispatch
from app.services import geocoding
from app.services.tokens import generate_feld_token, validate_feld_token
from tests.conftest import feld_device_token, feld_unlock_token


@pytest.fixture
def provider(monkeypatch):
    calls = []
    instance = geocoding.Geocoder()
    monkeypatch.setattr("app.api.geocoding.geocoder", instance)
    monkeypatch.setattr(settings, "geocoding_provider", "swisstopo")
    original_client = httpx.AsyncClient
    payload = {"results": [{"attrs": {"lat": 47, "lon": 7, "label": "<b>Example</b> &amp; Test 1"}}]}

    def handler(request):
        calls.append(request)
        return httpx.Response(200, json=payload)

    def make_client(**kwargs):
        assert kwargs["trust_env"] is False
        assert kwargs["follow_redirects"] is False
        return original_client(transport=httpx.MockTransport(handler), **kwargs)

    monkeypatch.setattr(geocoding.httpx, "AsyncClient", make_client)
    return instance, calls, payload


async def test_anonymous_and_early_field_stages_never_contact_provider(client, test_event, provider):
    _, calls, _ = provider
    assert (await client.get("/api/geocoding/search", params={"q": "Example"})).status_code == 401
    poster = generate_feld_token(test_event.id)
    picker = await feld_unlock_token(client, test_event)
    for credential in (poster, picker, "invalid"):
        assert (
            await client.get("/api/geocoding/search", params={"q": "Example"}, headers={"X-Feld-Token": credential})
        ).status_code == 401
        assert (
            await client.get(
                "/api/geocoding/reverse", params={"lat": 47, "lon": 7}, headers={"X-Feld-Token": credential}
            )
        ).status_code == 401
    assert calls == []


@pytest.mark.parametrize("credential_location", ["header", "cookie"])
async def test_bound_device_admitted_but_revocation_blocks_even_cached_result(
    client,
    db_session,
    test_event,
    test_personnel,
    provider,
    credential_location,
):
    _, calls, _ = provider
    token = await feld_device_token(db_session, test_event.id, test_personnel.id)
    headers = {"X-Feld-Token": token} if credential_location == "header" else {}
    if credential_location == "cookie":
        client.cookies.set("feld-device-token", token)
    response = await client.get("/api/geocoding/search", params={"q": "Example"}, headers=headers)
    assert response.status_code == 200
    claims = validate_feld_token(token)
    claim = await db_session.get(FeldDeviceClaim, claims.claim_id)
    claim.revoked_at = datetime.now(UTC)
    await db_session.commit()
    assert (await client.get("/api/geocoding/search", params={"q": "Example"}, headers=headers)).status_code == 401
    assert len(calls) == 1
    assert "cookie" not in calls[0].headers
    assert "authorization" not in calls[0].headers
    assert "x-feld-token" not in calls[0].headers


async def test_search_normalizes_html_caches_and_throttles_new_queries(editor_client, provider, caplog):
    _, calls, _ = provider
    caplog.set_level(logging.INFO, logger="httpx")
    response = await editor_client.get("/api/geocoding/search", params={"q": "Example"})
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.json()[0]["formattedAddress"] == "Example & Test 1"
    assert response.json()[0]["lat"] == 47
    assert (await editor_client.get("/api/geocoding/search", params={"q": "Example"})).json() == response.json()
    busy = await editor_client.get("/api/geocoding/search", params={"q": "Different"})
    assert busy.status_code == 429
    assert busy.headers["retry-after"] == "2"
    assert len(calls) == 1
    assert calls[0].url.params["searchText"] == "Example"
    assert not any("api3.geo.admin.ch" in record.getMessage() for record in caplog.records)


@pytest.mark.parametrize(
    "parameters",
    [
        {"q": "xy"},
        {"q": "x" * 201},
        {"q": " " * 4},
        {"q": "Example", "countrycodes": "ch&evil=true"},
        {"q": "Example", "viewbox": "7,47,6,48"},
        {"q": "Example", "viewbox": "nan,47,8,48"},
    ],
)
async def test_invalid_search_never_contacts_provider(editor_client, provider, parameters):
    assert (await editor_client.get("/api/geocoding/search", params=parameters)).status_code == 422
    assert provider[1] == []


@pytest.mark.parametrize("point", [{"lat": 91, "lon": 7}, {"lat": 47, "lon": "nan"}, {"lat": 47, "lon": 181}])
async def test_invalid_reverse_never_contacts_provider(editor_client, provider, point):
    assert (await editor_client.get("/api/geocoding/reverse", params=point)).status_code == 422
    assert provider[1] == []


async def test_disabled_provider_and_non_swiss_search_do_not_dispatch(editor_client, provider, monkeypatch):
    assert (
        await editor_client.get("/api/geocoding/search", params={"q": "Example", "countrycodes": "de"})
    ).json() == []
    monkeypatch.setattr(settings, "geocoding_provider", "disabled")
    assert (await editor_client.get("/api/geocoding/search", params={"q": "Example"})).json() == []
    assert (await editor_client.get("/api/geocoding/reverse", params={"lat": 47, "lon": 7})).json() == {"address": None}
    assert provider[1] == []


async def test_swiss_reverse_chooses_nearest_point_within_100m(editor_client, provider):
    _, calls, payload = provider
    payload["results"] = [
        {"geometry": {"type": "Point", "coordinates": [7.1, 47.1]}, "properties": {"label": "Outside"}},
        {"geometry": {"type": "Point", "coordinates": [7, 47.0002]}, "properties": {"label": "Further"}},
        {"geometry": {"type": "Point", "coordinates": [7, 47.0001]}, "properties": {"label": "Nearest"}},
    ]
    response = await editor_client.get("/api/geocoding/reverse", params={"lat": 47, "lon": 7})
    assert response.json() == {"address": "Nearest"}
    assert calls[0].url.params["layers"] == "all:" + geocoding.ADDRESS_LAYER
    assert calls[0].url.params["geometryType"] == "esriGeometryEnvelope"
    assert calls[0].url.params["tolerance"] == "0"


async def test_swiss_reverse_does_not_invent_a_distant_address(editor_client, provider):
    provider[2]["results"] = [
        {"geometry": {"type": "Point", "coordinates": [7.1, 47.1]}, "properties": {"label": "Outside"}},
    ]
    assert (await editor_client.get("/api/geocoding/reverse", params={"lat": 47, "lon": 7})).json() == {"address": None}


@pytest.mark.parametrize(
    "url",
    [
        "https://nominatim.openstreetmap.org",
        "https://NOMINATIM.openstreetmap.org./",
        "https://www.nominatim.openstreetmap.org",
        "https://user:secret@example.test",
        "https://example.test?q=x",
        "file:///tmp/geocoder",
        "https://example.test/#secret",
    ],
)
def test_public_nominatim_and_credential_urls_rejected(url):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, geocoding_nominatim_url=url)


async def test_nominatim_adapter_preserves_viewbox_bias(editor_client, provider, monkeypatch):
    instance, _, _ = provider
    calls = []

    async def fetch(url, parameters):
        calls.append((url, parameters))
        return [
            {
                "lat": "47",
                "lon": "7",
                "display_name": "Long provider label",
                "address": {
                    "road": "Example Street",
                    "house_number": "1",
                    "postcode": "1000",
                    "city": "Test City",
                },
            }
        ]

    monkeypatch.setattr(settings, "geocoding_provider", "nominatim")
    monkeypatch.setattr(settings, "geocoding_nominatim_url", "http://geocoder.test/nominatim")
    monkeypatch.setattr(instance, "_fetch", fetch)
    response = await editor_client.get(
        "/api/geocoding/search",
        params={
            "q": "Example",
            "countrycodes": "de,ch",
            "viewbox": "6,46,8,48",
        },
    )
    assert response.status_code == 200
    assert response.json()[0]["formattedAddress"] == "Example Street 1, 1000 Test City"
    assert calls == [
        (
            "http://geocoder.test/nominatim/search",
            {
                "q": "Example",
                "format": "jsonv2",
                "addressdetails": "1",
                "limit": "10",
                "countrycodes": "ch,de",
                "viewbox": "6.0,46.0,8.0,48.0",
                "bounded": "0",
            },
        )
    ]


async def test_separate_workers_compete_for_one_database_dispatch_slot(test_engine):
    sessions = async_sessionmaker(test_engine, expire_on_commit=False)
    async with sessions() as db:
        await db.execute(delete(GeocodingDispatch))
        await db.commit()

    async def attempt():
        async with sessions() as db:
            try:
                await geocoding.reserve_dispatch(db)
                return True
            except geocoding.GeocodingBusyError:
                return False

    try:
        assert sum(await asyncio.gather(*(attempt() for _ in range(8)))) == 1
    finally:
        async with sessions() as db:
            await db.execute(delete(GeocodingDispatch))
            await db.commit()


async def test_cache_expiry_and_capacity(provider, db_session, monkeypatch):
    instance, _, _ = provider
    monkeypatch.setattr(geocoding, "reserve_dispatch", lambda db: asyncio.sleep(0))
    monkeypatch.setattr(geocoding, "CACHE_LIMIT", 2)
    for q in ("one", "two", "three"):
        await instance.search(db_session, geocoding.AddressSearch(q=q))
    assert len(instance.cache) == 2
    for key, (_, value) in list(instance.cache.items()):
        instance.cache[key] = (0, value)
    await instance.search(db_session, geocoding.AddressSearch(q="four"))
    assert len(instance.cache) == 1


@pytest.mark.parametrize("failure", ["redirect", "oversize", "invalid_json", "timeout", "compressed"])
async def test_provider_failures_are_bounded_and_do_not_leak_query(editor_client, provider, monkeypatch, failure):
    # The provider fixture wraps this class; use a distinct captured original from httpx's implementation.
    from httpx._client import AsyncClient

    calls = []

    async def handler(request):
        calls.append(request)
        if failure == "redirect":
            return httpx.Response(302, headers={"location": "https://other.test"})
        if failure == "oversize":
            return httpx.Response(200, content=b"x" * (geocoding.MAX_RESPONSE_BYTES + 1))
        if failure == "invalid_json":
            return httpx.Response(200, content=b"not json")
        if failure == "compressed":
            return httpx.Response(200, content=gzip.compress(b'{"results":[]}'), headers={"Content-Encoding": "gzip"})
        await asyncio.sleep(0.05)
        return httpx.Response(200, json={})

    monkeypatch.setattr(
        geocoding.httpx, "AsyncClient", lambda **kwargs: AsyncClient(transport=httpx.MockTransport(handler), **kwargs)
    )
    monkeypatch.setattr(geocoding, "REQUEST_TIMEOUT", 0.01 if failure == "timeout" else 5)
    response = await editor_client.get("/api/geocoding/search", params={"q": "Private example"})
    assert response.status_code == 503
    assert "Private example" not in response.text
    assert len(calls) == 1
