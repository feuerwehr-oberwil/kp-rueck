# Fat Ereignis: does a large or long operation make the board worse?

**Status:** measurement tooling + the first recorded run (2026-10-05)
**Audience:** whoever changes the board's load, the sync path (socket pushes, polling), the
card rendering, the map, or anything that runs once per card

A long or large Ereignis is exactly when KP Rück matters most, and it is also when every
per-card, per-device and per-reload cost adds up. `just fat-perf` measures that against a real
backend and a throttled browser, with a workload built from what real users actually did.

Ported from KP Front's `just fat-perf` (its `docs/testing/fat-incident.md`), adapted to how
this app syncs: every open board reloads the whole board on every push.

## Calibrated against real user actions

`frontend/test-utils/fat-event.ts` builds a synthetic, deterministic Ereignis as a log of
user actions: create, status moves, edits, assign and unassign of people, vehicles and
material, Spezialfunktionen, check-ins. It is sized against prod's `audit_log`, which records
every API request with its path and duration. A read-only, aggregate-only look on 2026-10-05
found the busiest real session on record to be 29.06.2026, 16–18 h:

- 63 Einsätze in play in 2 h, and 431 user actions on them from about 5 devices
- 121 incident updates, 33 status changes, 85/41 personnel assign/unassign, 40/24 vehicle,
  30/7 material, and 33 Spezialfunktionen
- a write peak of 113 requests in 10 min, and every device polling about 108 requests per minute
- a roster of 67 people, 5 vehicles and 39 materials, with at most 8 assignments on one Einsatz

| Preset | scale × hours | Einsätze | Actions | Roster (P/V/M) | Devices (writing) |
| --- | --- | --- | --- | --- | --- |
| `real` | 1 × 2 h | 63 | 498 | 67 / 5 / 39 | 5 (4) |
| `long` | 1 × 12 h | 378 | 1 909 | 67 / 5 / 39 | 5 (4) |
| `large` | 4 × 4 h | 504 | 3 610 | 268 / 20 / 156 | 20 (16) |
| `extreme` | 10 × 8 h | 2 520 | 14 379 | 670 / 50 / 390 | 50 (40) |

`real` is the record to beat. `long` is a night that does not end. `large` is an Unwetter
day with neighbouring Feuerwehren. `extreme` is a region's storm, and it takes a long time to
run, so run it on purpose.

There are two knobs because they grow different things. `scale` grows what stands at once:
roster, devices and writing desks. `hours` grows what piles up, because the board keeps
every card, including completed ones, and every reload on every device loads all of them.

`fat-event.test.ts` pins the calibration (`real` within ±25 % of the record). It also checks
that the log never double-books a resource. The log is split by desk: each writer owns its own
Einsätze and its own share of the roster, so the desks can write concurrently without 409s a
real crew would never cause.

## The tool

`just fat-perf [preset …]` (default `real large`) stands up a **throwaway** stack for each
preset and never touches the dev database:

- a fresh Postgres container, migrated and dev-seeded
- the backend in production mode with one uvicorn worker, as prod runs it
- the production frontend build (`next build`, standalone server)

Then `frontend/tests/perf/fat-event.perf.ts` runs three phases:

- **Build-up.** The desks play the action log as fast as they can. Every simulated device
  has the board open the way the real one does: a socket on the `operations` room, the app's
  own `ReloadScheduler` (200 ms debounce, single-flight), the full board load on every push,
  the 5 s polling fallback while the socket is down, and the Aufträge and notification side
  polls. A heartbeat asks `/health` every 20 ms, so an event-loop stall shows up.
- **Steady window.** 60 s at the record's write peak × scale (`FAT_STEADY`) against the
  full-grown board. Each write carries a token. The measured lag is the time until each
  device's reload carries it: the delay a crew notices between one desk's change and another
  desk's screen.
- **Browser.** It opens the board in Chromium with the CPU throttled 4× (`FAT_CPU`, roughly a
  tablet), then measures:
  - time to the first card and to a settled board
  - what an idle board requests per minute
  - how long another device's new Einsatz takes to show
  - typing into the search
  - opening the map and panning it

Knobs: `FAT_CPU`, `FAT_STEADY`, `FAT_SKIP_BUILD=1` (reuse the last build),
`FAT_API_PORT`/`FAT_WEB_PORT`/`FAT_PG_PORT`.

### Reading the numbers

- **Compare presets, not absolute values.** What matters is how a number grows from `real` to
  `large`. Headless Chromium draws WebGL in software, so map numbers are pessimistic everywhere.
- **Check the `machine load` line.** A run on a busy machine is not comparable to a quiet one.
- **The build-up is compressed time.** It runs at 40–150× real time, so its write latencies are
  a stress figure. The steady window is the realistic one.

## Results – 2026-10-05

Dev laptop (WSL, 12 cores), machine load 4–9 (other work was running, so treat the absolute numbers as pessimistic), 4× CPU throttle.

| | `real` | `long` | `large` |
| --- | --- | --- | --- |
| Full board load (one reload, all requests) | 191 KB | 814 KB | 1.3 MB |
| `GET /api/incidents/` cold, quiet server | 51 ms / 82 KB | 113 ms / 487 KB | 261 ms / 649 KB |
| Device reload p50/p95, steady window | 856 / 1 076 ms | 1.2 / 1.4 s | 2.6 / 3.3 s |
| **Write → other device** p50/p95, steady window | **1.2 / 1.4 s** | **1.5 / 2.0 s** | **6.7 / 10.8 s** |
| Write p50, steady window | 61 ms | 42 ms | 1.4 s |
| Heartbeat p99 during build-up (event-loop stalls) | 244 ms | 275 ms | 2.4 s (max 4.1 s) |
| Sockets dropped by the server | 0 | 0 | 20 of 20 |
| Browser: open → first card | 6.2 s | 9.4 s | 13.1 s |
| Browser: open → board settled (worst long task) | 8.1 s (2.3 s) | 12.6 s (5.8 s) | 18.2 s (8.7 s) |
| Browser: idle board, requests per minute (prod record: ~108) | 160 | 794 | 1 032 |
| Browser: another device's new Einsatz shown | 4.5 s | 9.8 s | 18.8 s |
| Browser: typing «Mühle» into the search (frame p95) | 1.6 s (200 ms) | 3.3 s (583 ms) | 5.4 s (767 ms) |
| Browser: open map → settled (DOM markers) | 5.1 s (114) | 6.3 s (640) | 7.7 s (860) |
| Browser: map pan frame p50/p95 | 50 / 83 ms | 50 / 133 ms | 50 / 167 ms |

No write was ever refused (0 × 409/4xx), at any size.

### What it found

1. **Every push reloads the whole board on every device, and that is what breaks first.**
   One write → a socket push to every device → each one reloads all ten board endpoints. That
   is about 1.3 MB per device at `large`. So the server's work per write grows with devices ×
   board size. At `real` that is invisible: another desk sees a change within 1.2 s. At
   `large` (20 devices, 504 Einsätze) the single worker cannot keep up:
   - another desk sees a change only after 6.7 s (p95 11 s)
   - a plain write takes 1.4 s
   - `/health` stalls for up to 4 s, long enough that the server dropped every device's
     socket, and those boards fell back to 5 s polling
   The fix is not in the save path. It is in what a push makes a device do: apply the pushed
   change (the push already carries the full incident) or reload only what changed, instead
   of the whole board.
2. **`useRekoNotifications` costs one request per card on every reload.**
   `lib/hooks/use-reko-notifications.tsx` fetches every card's Reko reports on mount. Its
   effect depends on the `operations` array, which every reload replaces, so it runs again
   each time. That means one request per card for every remote change on every open device:
   378 requests in an idle 30 s at `long`, 500 at `large`. It is why an idle board sends 7–10×
   prod's ~108 requests per minute. It was already visible in prod's June traffic, where
   `/api/reko/incident/:id/reports` was about 9 % of all requests. The board already loads
   `/api/reko/event/:id/summaries` for the whole Ereignis in one request.
3. **The board's render cost grows with the cards it keeps, so a long Ereignis also hurts on the
   device, not only a large one.** At `long` (same crew, same 5 devices, only more hours) a
   tablet-class CPU needs:
   - 12.6 s to settle the board, with a single 5.8 s freeze
   - 9.8 s to show another device's new Einsatz
   - over 1 s of jank per search keystroke
   That is about 6× the cards of `real` and roughly 2× every browser number. Completed cards are
   hidden but still loaded (`/api/incidents/` grows 82 → 487 KB), and every reload re-renders.
4. **The map holds up.** Hundreds of DOM markers still pan at p50 50 ms (20 fps in software
   WebGL). It is not where the problem is.
5. **The backend's per-request cost is fine when it is quiet.** Every board endpoint answers in
   15–50 ms on a quiet server at every size, except `/api/incidents/` at 261 ms at `large`.
   The trouble in (1) is the number of requests, not their individual cost.

Harness lessons, kept here so the next person doesn't relearn them:

- Run the backend in production mode. In dev mode python-socketio logs every packet it sends
  at INFO, which costs a measurable share of the CPU under this load.
- A simulated device has to reconnect and fall back to polling like the real client.
  Otherwise one dropped socket silently ends its part of the measurement (at `large` it did).
- Count network errors instead of throwing. A reset connection under load is a finding, not
  the end of the run.
