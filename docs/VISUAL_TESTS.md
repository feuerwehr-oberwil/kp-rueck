# Visual regression tests

**Status:** 🟢 running in CI on every pull request (job `visual`), on probation — not a
required check yet
**Audience:** anyone who changes how KP Rück looks, and anyone who sees the `visual` check red

A unit test cannot see that the board lost its column colours, that a merged design pass
quietly disappeared in a later rebuild, or that a phone card grew a second scrollbar. A
screenshot can. This suite renders nine frozen states of the app and compares each with a PNG
committed in the repository; a screen that changed fails the job and shows you the diff.

It uses nothing but Playwright's own `expect(page).toHaveScreenshot` — no service, no SaaS, no
extra package.

## What runs

| PNG (`frontend/tests/visual/__screenshots__/`) | Screen | Viewport | Scheme |
| --- | --- | --- | --- |
| `board-desktop-dark.png` | `/`, the board | 1920×1080 | dark |
| `board-desktop-light.png` | `/`, the board | 1920×1080 | light |
| `board-desktop-detail.png` | `/`, the detail panel open on «Langegasse 28» | 1920×1080 | dark |
| `board-phone.png` | `/`, the phone list | 390×844 | dark |
| `feld-phone.png` | `/feld`, Müller Hans's Schadenplatz (EL), reached through the real door | 390×844 | light |
| `map-desktop.png` | `/map`, markers on a flat basemap | 1920×1080 | dark |
| `display-board.png` | `/display/board`, the wall | 1920×1080 | dark |
| `display-status.png` | `/display/status`, the wall | 1920×1080 | dark |
| `settings.png` | `/settings`, Allgemein | 1920×1080 | light |

Specs: `frontend/tests/visual/*.visual.ts`, shared arrangement in `visual.fixture.ts`, config
`frontend/playwright.visual.config.ts`. The config is separate from `playwright.config.ts` on
purpose: the nightly runs `playwright test` over every project in the main config, and these
specs only mean something against the visual seed and a production build. The existing E2E,
`@smoke` and nightly runs are unchanged.

`scripts/visual-test.sh` (`just visual`) does the whole run: the production frontend build
(`next build`, standalone server — no dev overlay, no compile-on-demand), an empty Postgres
(`postgres:16-alpine`, as in production), migrations, the visual seed, the backend, the specs,
and the teardown. CI runs the same script.

## How it stays deterministic

The suite is only worth something if the same commit paints the same pixels every time. Each
source of change is pinned once, in one place:

- **Data** — `backend/app/seed_visual.py` (`python -m app.seed_visual`, empty database only).
  It is the demo scenario (`seed_demo_event_content`: a storm evening in Oberwil, every column
  filled, an Auftrag, Rekos, a filed Rapport) written at one fixed instant, `VISUAL_NOW`
  (11.07.2026, 19:30 in Oberwil), instead of the wall clock. Everything the database stamps on
  its own (`server_default=now()`) is moved off the wall clock afterwards, and the seed fails if
  any timestamp is still later than `VISUAL_NOW`.
- **Clock** — the browser's `Date` is frozen at the same instant (`page.clock.setFixedTime`);
  timers keep running, so polling and sockets behave normally. The first spec checks the
  event's `created_at` against `VISUAL_NOW` and fails loudly if seed and spec disagree.
  `timezoneId: Europe/Zurich`, `locale: de-CH`.
- **Device** — fixed viewport, `deviceScaleFactor: 1`, colour scheme set per state, reduced
  motion; screenshots with `animations: 'disabled'`, `caret: 'hide'`.
- **Network** — nothing leaves the box. Basemap tiles (OSM, CARTO, ArcGIS) are answered with a
  1×1 flat PNG, so the map is one even colour under our own markers, labels and routes; every
  other foreign request is aborted; the local tileserver probe gets a 404.
- **Server clock** — the one thing that cannot be frozen without a new dependency. It only
  matters for the Warnungen (`notification_service.py` evaluates them on every request against
  the server's wall clock, «2141 h im Status …» on a three-hour-old story), so the browser gets
  an empty list for `GET /api/notifications/`: the bell and its toasts are not in these
  screenshots.
- **Settling** — before a shot the spec waits for named content (the first and last card, a
  marker label, a stored setting value), the boot cover and every shell trail gone, the top
  progress line idle, fonts loaded, and every scroller at rest. `toHaveScreenshot` then still
  wants two identical frames in a row.
- **Ordering** — the Postgres image matters: the backend sorts names in SQL, and the collation
  of `postgres:16-alpine` puts «Ölsperre» after «Wassersauger», the Debian image between
  «Motorsäge» and «Tauchpumpe». CI, `just visual` and production all use `-alpine`.

### Masks

One, in `variableParts()`: the version label («v0.7.0 · 1a2b3c4 · 09.10.2026»), whose commit
and build day differ on every build. Add a mask only for something that is variable by nature,
with the reason beside it — a mask hides a regression as surely as a flake.

### Threshold

`maxDiffPixels: 20` per screenshot, with Playwright's default per-pixel `threshold` (0.2, YIQ
colour distance: a pixel closer than that to the baseline counts as equal). Measured, not
guessed:

- **Noise.** At `threshold: 0` two runs of the same build differ by 2–30 px per state
  (anti-aliasing at a text or border edge). At the default 0.2 the same runs differ by
  **0 px** — 15 consecutive local runs, each on a fresh database.
- **Signal.** A 12 → 8 px corner radius (`--radius`) changed **4–302 px** per state (board
  dark 247, detail 302, wall 217, status 124, map 56, phone 43, `/feld` 6, settings 4). So the
  limit is an absolute count, not a ratio: 0.1 % of a 1920×1080 shot is 2 074 px and would have
  let that change through entirely. With 20 px it fails seven of the nine states.

A change that is only a hair of colour (below the per-pixel threshold) is not caught; a moved
border, a lost colour role, a changed radius, spacing or font is. Never raise the number to
make a flaky state pass — find what moves (see «When the job is red»).

## Running it locally

```bash
just visual                    # build, seed, run all nine, tear down
just visual board              # only the board specs
VISUAL_SKIP_BUILD=1 just visual   # reuse frontend/.next
```

Needs Docker (for the throwaway Postgres), uv and pnpm. Chromium's system libraries missing
(WSL without sudo)? Point `LD_LIBRARY_PATH` at them.

**A local run is a look, not a verdict.** The baselines are rendered on CI's Linux Chromium; a
laptop rasterises fonts differently, so a local run may fail on every state without anything
being wrong. Use it to see the screens and to debug a spec, and use the `visual` job for the
verdict. Never commit PNGs a local run wrote (`updateSnapshots: 'missing'` writes the missing
ones locally; CI never writes).

## When the `visual` job is red

1. Open the job summary: one row per state, with the share of pixels that differed.
2. Download the `visual-diff` artifact: per state `*-expected.png`, `*-actual.png` and
   `*-diff.png`, plus `playwright-report/` (open `index.html`; the image comparison has a
   slider).
3. Unintended? Fix the code. A flaky state (the same commit red once and green once) is a
   determinism bug in the spec or the app: fix the cause — don't raise the threshold, don't add
   a mask, don't retry.
4. Intended? Accept it (next section).

## Accepting a change

**Never accept a baseline to turn the check green.** Accept only a visual change you made on
purpose, in its own commit, with the reason in the commit message, and say so in the pull
request.

Baselines come from CI only:

1. Render them for your branch: Actions → **Visual baselines** → Run workflow with your branch
   (`gh workflow run visual-baselines.yml -f ref=<branch>`), or put the label `visual-update`
   on the pull request (that also works before the workflow has reached `main`; remove and
   re-add the label to render again).
2. `just visual-accept <run-id>` downloads the `visual-baselines` artifact and replaces
   `frontend/tests/visual/__screenshots__/` with it (so a state you removed disappears too).
3. Look at the changed PNGs (`git diff --stat`, open them), then commit them alone:
   `test(visual): accept baselines – <why the screen changed>`.
4. Push. The `visual` job must now be green on that commit.

CI never commits baselines itself: a commit pushed with `GITHUB_TOKEN` does not trigger the
pull request's CI, so nothing would check the new PNGs, and the DCO check needs a real sign-off.

## Adding a state

Add a test to the matching `*.visual.ts` (or a new file), with a readiness check that names
content only the settled screen has, then render the baselines on CI as above. Keep the set
small: each state costs a few seconds and one more PNG to review on every deliberate change.
A state that shows something time- or connection-dependent needs that pinned in the seed or the
fixture first, not masked afterwards.

## Measurements

Recorded when the suite was introduced (2026-10-09), local runs on a WSL box:

- **Noise:** see «Threshold» — 0 px past the per-pixel threshold in 15 fresh-database runs.
  Two determinism bugs were found on the way and fixed at the cause, not masked: the Postgres
  image's collation (see «Ordering») and crew lists ordered by an `assigned_at` the demo story
  gives a whole crew at once (`_break_assignment_ties` in the seed spreads ties a second apart,
  in name order). The hover state of a clicked card is moved off it before the shot.
- **Run time:** the nine specs take 12–30 s on two workers once the stack is up; the
  production build is most of the job. CI numbers are in the pull request that added the
  suite.
