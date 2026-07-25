# Plan 09 – Emergency Plans Integration (Einsatzpläne, generic provider)

**Priority:** P2 (post-publication feature)
**Scope:** Backend + frontend.
**Estimated size:** ~500 LOC + tests. Implement in the two phases below.

## Goal

When an incident has a location, the operator can pull up the **Einsatzplan**
(building emergency plan PDFs), Sofortmassnahmen, tactical info, and nearest
hydrants for that address – directly in the incident detail view.

The first (reference) data source is **SchlüHü** (`https://schlue-api.fwo.li`, the
FWO Schlüsselbox-Planer at `../fwo-schlühü`), but kp-rueck is meant to be
open-sourced: the integration must be a **generic provider interface** so other
departments can plug in their own plan source (or none). Nothing FWO-specific may
leak into kp-rueck's core code or UI strings.

## The reference provider: SchlüHü consumer API (verified)

- `GET /api/emergency/query?lat=<f>&lon=<f>&radius_m=500&object_limit=10`,
  header `X-API-Key: <CONSUMER_API_KEY>`, SLA <500ms. Returns objects sorted by
  distance, each with: address, lat/lon, `distance_m`, `operational_info`
  (approach, hazmat, contacts…), `measures[]` (Sofortmassnahmen), `plan_pdfs[]`
  with `name` + **pre-authenticated `download_url`** (SharePoint Graph URL,
  valid ~1 h), plus nearby hydrants with distances.
- `GET /api/v1/geo/resolve?address=<text>` → WGS84 lat/lon (5-tier resolver).
  kp-rueck incidents already carry `location_lat`/`location_lng`
  (`backend/app/models.py:287-360`), so the resolver is only a fallback for
  incidents that have an address but no coordinates.

## Design decisions (final – do not change)

- **Backend proxy, never direct browser calls.** The provider API key must stay
  server-side; the browser talks only to kp-rueck
  (`GET /api/emergency-plans/query`). This also sidesteps CORS and lets us cache.
- **Generic provider abstraction** in
  `backend/app/services/emergency_plans/`:
  - `base.py`: `class EmergencyPlanProvider(Protocol)` with one method
    `async def query(self, lat: float, lng: float, radius_m: int, limit: int) -> EmergencyPlanResult`
    plus `async def health(self) -> bool` for the settings "Verbindung testen"
    button.
  - `schemas.py`: the **normalized contract** (Pydantic) that the frontend
    consumes – this is the open-source interface, documented in code:
    - `EmergencyPlanResult { provider: str, objects: list[PlanObject] }`
    - `PlanObject { name: str, address: str, lat: float|None, lng: float|None, distance_m: float|None, documents: list[PlanDocument], measures: list[str], info: dict[str, str], hydrants: list[Hydrant] }`
      (`info` is a flat ordered label→value dict – providers map their tactical
      fields into it; the UI renders it generically as a definition list)
    - `PlanDocument { name: str, type: str|None, url: str }`
    - `Hydrant { ref: str|None, type: str|None, distance_m: float|None }`
  - `schluehue.py`: maps the SchlüHü response into the contract (httpx
    AsyncClient, 5 s timeout, `X-API-Key` header).
  - `generic_json.py`: a second provider that expects an endpoint **already
    returning the normalized contract** (`GET <base_url>?lat&lng&radius_m&limit`,
    optional `Authorization: Bearer <key>`). This is what makes the feature
    open-source friendly: any department can implement one JSON endpoint instead
    of writing Python. Document the contract in `docs/EMERGENCY_PLANS_PROVIDER.md`
    (new doc: endpoint shape, auth, the JSON schema with an example response).
- **Configuration via the existing settings table** (runtime-configurable by
  admins, no redeploy): new keys in `DEFAULT_SETTINGS`
  (`backend/app/services/settings.py:18-35`):
  `emergency_plans.enabled` (`"false"`), `emergency_plans.provider`
  (`"schluehue"` | `"generic_json"`), `emergency_plans.base_url` (`""`),
  `emergency_plans.radius_m` (`"500"`).
  The **API key is NOT in the settings table** (it's readable via the settings
  API): config field `emergency_plans_api_key: str = ""` in
  `backend/app/config.py` (env `EMERGENCY_PLANS_API_KEY`), like other secrets.
- **kp-rueck endpoints** (new router `backend/app/api/emergency_plans.py`,
  mounted like the other routers in `main.py`):
  - `GET /api/emergency-plans/query?lat=<f>&lng=<f>` – auth `CurrentUser`, rate
    limit: new `RateLimits.EMERGENCY_PLANS = "30/minute"`. Returns the normalized
    contract. 404-style empty result (`objects: []`) when nothing nearby; **503**
    with `{"detail": "Einsatzplan-Dienst nicht erreichbar"}` when the provider
    errors/times out; **409** when `emergency_plans.enabled` is false (frontend
    hides the feature anyway – this is a guard, exact code matters only for tests).
  - `GET /api/emergency-plans/health` – auth `CurrentEditor`; used by the
    settings test button; returns `{"ok": bool, "provider": str}`.
- **Caching:** in-memory TTL cache in the service module keyed by
  `(round(lat, 4), round(lng, 4))` (~11 m grid), TTL **10 minutes** – well under
  the ~1 h validity of SchlüHü's pre-authenticated download URLs, and enough to
  absorb repeated opens of the same incident. Simple dict + timestamps; evict
  on read when expired; cap at 200 entries (drop oldest). No Redis.
- **Demo mode:** feature stays disabled (default `enabled=false`); additionally
  the settings section shows the standard demo-hint card and the toggle is
  disabled when `demo_mode` (mirror how printer settings handle demo mode).
- **Frontend placement:** a collapsible **"Einsatzpläne"** section in the incident
  detail view (the side panel / detail modal – locate the component that renders
  incident details, the one opened by `E`/`Enter` per
  `use-kanban-shortcuts.ts`). Visible only when the feature is enabled (expose
  `emergency_plans.enabled` through whatever settings payload the frontend
  already fetches) **and** the incident has `location_lat`/`location_lng`.
  Content per nearby object: name/address + distance, document list (each opens
  `url` in a new tab, `rel="noopener noreferrer"`), Sofortmassnahmen as a bullet
  list, `info` as a compact two-column definition list, hydrants one-liner.
  Data is fetched **lazily on expand** (not on detail open) via a new api-client
  method; loading spinner + error state ("Einsatzplan-Dienst nicht erreichbar –
  erneut versuchen").

## Implementation steps

### Phase 1 – Backend

1. `backend/app/services/emergency_plans/{__init__,base,schemas,schluehue,generic_json,cache}.py`
   as specified above. Provider selection: factory
   `get_provider(db) -> EmergencyPlanProvider | None` reading the settings keys +
   config secret; returns `None` when disabled/unconfigured.
2. Router + rate-limit constant + mount in `main.py`.
3. Settings keys in `DEFAULT_SETTINGS`; config secret field.
4. `docs/EMERGENCY_PLANS_PROVIDER.md` – the public provider contract (write it
   from `schemas.py`, include one full example JSON response and a curl example).

### Phase 2 – Frontend

5. `frontend/lib/api-client.ts`: `async queryEmergencyPlans(lat: number, lng: number): Promise<EmergencyPlanResult>`
   (+ TS types mirroring the contract in `frontend/lib/types/`).
6. `frontend/components/emergency-plans-section.tsx` (`"use client"`): the
   collapsible section described above; integrate into the incident detail
   component.
7. Settings UI: new entry in the **Konfiguration** group of the settings page
   (`frontend/app/settings/page.tsx`, `SECTIONS` at lines 92-103, `editorOnly`):
   "Einsatzpläne" – enable toggle, provider select (SchlüHü / Generisches JSON),
   base-URL field, radius field, hint that the API key is set via the
   `EMERGENCY_PLANS_API_KEY` environment variable (never typed into the UI), and
   a "Verbindung testen" button calling the health endpoint (success/error toast).
8. German copy throughout; add strings to `de.json`/`fr.json` if plan 06 has
   landed by then.

## Test plan

### Backend – `backend/tests/test_services/test_emergency_plans.py` + `backend/tests/test_api/test_emergency_plans.py`

Mock HTTP with `respx` (add as dev dependency, `uv add --dev respx`) or
monkeypatch the provider's httpx client – check `backend/tests/test_services/`
for existing httpx-mocking precedent (the Divera poller tests likely have one;
reuse that approach).

1. **SchlüHü mapping:** feed a recorded-shape SchlüHü JSON response (build the
   fixture from the real API shape: objects with `plan_pdfs`, `measures`,
   `operational_info`, hydrants) → assert normalized `EmergencyPlanResult`:
   documents carry name+url, measures flattened, `info` populated, distances
   preserved, sorted by distance.
2. **Generic JSON provider:** endpoint returning the contract verbatim →
   passes Pydantic validation unchanged; invalid payload → provider raises →
   endpoint returns 503.
3. **Endpoint behavior:** enabled + provider mocked → 200 with contract;
   disabled → 409; provider timeout (mock raises `httpx.TimeoutException`) → 503
   with German detail; missing/invalid lat/lng → 422; unauthenticated → 401.
4. **Secret hygiene:** the API key never appears in any response body – query
   the kp-rueck endpoint and the settings list endpoint and assert the key
   string is absent.
5. **Cache:** two queries with coordinates 5 m apart hit the upstream once
   (assert mock call count == 1); after TTL expiry (monkeypatch the clock or
   inject TTL=0) it calls again; 201st distinct key evicts the oldest.
6. **Health endpoint:** provider health ok/fail → `{"ok": true/false}`; requires
   editor (viewer → 403).

### Frontend

- **Unit (Vitest + RTL, `emergency-plans-section.test.tsx`):** mock
  `apiClient.queryEmergencyPlans` –
  1. collapsed → no fetch; expand → fetch called with the incident's lat/lng;
  2. renders object name, document links (with `target="_blank"` and correct
     `href`), measures, hydrant line;
  3. error → error state with retry button; retry refetches;
  4. empty `objects` → "Keine Einsatzpläne in der Nähe gefunden".
- **E2E:** skip live-provider E2E (external dependency). One spec only if cheap:
  with the feature disabled (default), assert the section does **not** render in
  the incident detail – guards against leaking a half-configured feature into
  the demo.

## Acceptance criteria

- [ ] Backend + frontend suites green; `ruff check`, `pnpm lint`, `tsc --noEmit` clean.
- [ ] Manual against real SchlüHü (`EMERGENCY_PLANS_API_KEY` set, base URL `https://schlue-api.fwo.li`): open an incident at a known Oberwil address → section lists the object, PDF opens in a new tab, hydrants shown.
- [ ] Manual: "Verbindung testen" in settings reports ok; with a wrong key reports failure without exposing the key.
- [ ] `docs/EMERGENCY_PLANS_PROVIDER.md` is sufficient for a third party to implement the generic JSON endpoint without reading kp-rueck source.
- [ ] Nothing FWO-specific in UI strings or defaults (grep "schlue", "fwo", "Oberwil" in the diff – allowed only in the provider name label and docs).

## Out of scope

- Embedding/rendering PDFs inline (new tab is fine; command-post screens have a PDF viewer).
- Offline caching of plan PDFs (SharePoint URLs expire; a future plan could mirror PDFs into kp-rueck's photo-storage pattern).
- Showing plan objects/hydrants as map layers on `/map` – natural follow-up once this lands.
- Write-back (inspections, service events) – kp-rueck is read-only toward the provider.
- Using SchlüHü's `/api/v1/geo/resolve` for incidents without coordinates – follow-up.
