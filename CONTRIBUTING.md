# Contributing to KP Rück

Thank you for your interest in contributing! This project started as a tool for a Swiss fire department but is designed to be adaptable for fire departments and emergency services worldwide.

## How this codebase was built

Worth knowing before you read it: KP Rück was **vibe coded** – an experiment in how far
AI-assisted development can be taken, and how much you can trust the result in a real-world
operational setting. It has been carrying live operations at Feuerwehr Oberwil since then, and
the guard rails are the ones you'd expect from that bet rather than from a hand-written
codebase: a CI gate that has to be green before `main` moves, migrations as the only schema
truth, an append-only audit log, and a documented paper fallback for when the software is wrong.

Practically, this means patterns are consistent to a fault and worth following rather than
fighting, and that test coverage is the thing most worth adding.

## Sign your commits (DCO)

Every commit needs a `Signed-off-by` line. Add it automatically with `-s`:

```bash
git commit -s -m "fix: …"     # appends: Signed-off-by: Your Name <you@example.com>
```

That line is your statement that you wrote the patch, or otherwise have the right to submit it
under this project's licence – the [Developer Certificate of Origin
1.1](https://developercertificate.org/). Nothing is signed away and no copyright is transferred:
you keep the rights to your work, and it stays under AGPL-3.0-or-later like the rest of the
codebase.

We use the DCO rather than a Contributor Licence Agreement on purpose. A CLA would let the
maintainer relicense contributed code – for a closed hosted tier, say – and this project's
promise to the fire departments running it is that **what we operate is what you can operate**.
Shared copyright is what keeps that promise enforceable rather than voluntary.

Forgot the sign-off? `git commit --amend -s` for the last commit, or
`git rebase --signoff <base>` for a series, then force-push the branch.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/kp-rueck.git`
3. Create a branch: `git checkout -b feature/your-feature-name`
4. Set up the development environment (see below)
5. Make your changes
6. Test your changes
7. Submit a pull request

## Development Setup

See the [README](README.md#quick-start) for detailed setup instructions.

```bash
just dev       # Start all services with Docker (hot reload)
just test      # Run E2E tests
just lint      # Lint frontend + backend
```

## Code Style

### Backend (Python)
- **Formatter**: `ruff format .` (run via `just fmt`)
- **Linter**: `ruff check .` (run via `just lint`)
- Use type hints on all function signatures
- All database operations must be `async/await`
- Follow existing patterns in the codebase

### Frontend (TypeScript)
- **Linter**: ESLint (`pnpm lint` or `just lint`)
- Use TypeScript strictly, avoid `any`
- Follow Next.js 15 App Router conventions
- Use `"use client"` only when the component needs interactivity
- Use shadcn/ui components from `components/ui/` where applicable

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add vehicle GPS tracking display
fix: correct incident status transition validation
docs: update deployment guide
refactor: simplify polling logic in operations context
chore: update dependencies
```

## Pull Request Guidelines

1. **Keep PRs focused:** one feature or fix per PR
2. **Update documentation** if you change behavior
3. **Add tests** for new features
4. **Test manually** in the browser
5. **Describe your changes:** explain what and why in the PR description
6. **Run linting:** ensure `just lint` passes before submitting

## Releases (maintainers)

Other stations run **published images**, not `main`, so a tag is a promise. A release is a
label on a `main` commit CI already proved green – never a rushed cut. All four images
(backend, frontend, tileserver, print-agent) ship under one version.

```bash
just changelog            # draft notes from the commits since the last tag
#                           → curate them into CHANGELOG.md's [Unreleased] section
just release 0.2.0        # bump all four packages + open the CHANGELOG section
just release-tag 0.2.0    # commit (only the release files) + annotated tag
git push --follow-tags    # → CI gate → four GHCR images → GitHub Release
```

Pick the number by **what the update costs the operator**, not by how much code moved:
PATCH = fixes only, MINOR = features with automatic migrations, MAJOR = operator action
required. The table at the top of [`CHANGELOG.md`](CHANGELOG.md) is the contract.

Write the notes for a station commander deciding whether to update tonight – not for the
person who wrote the diff.

## Areas for Contribution

### High Impact
- **Translations / i18n** – the next-intl layer is in place, but `de.json` is the only
  catalogue, so any second language is largely a translation job rather than a plumbing one
- **Alerting integrations** – connect to platforms like Alamos, BORS, or other regional systems
- **CAD integration** – connect to Computer-Aided Dispatch systems
- **PDF report generation** – export incidents, board snapshots, or statistics as PDF

### Good First Issues
- UI improvements and accessibility
- Additional keyboard shortcuts
- Test coverage improvements
- Code cleanup and refactoring
- Documentation improvements (screenshots, tutorials)

### Advanced
- A **generic OIDC** sign-in adapter – external identity is Microsoft Entra-only today, so
  Google Workspace, Keycloak, Authentik and Zitadel are out of reach for one code path
- Generalising **vehicle GPS** behind a provider seam, the way alarm intake already is
- Progressive Web App (PWA) support
- Mobile app (React Native)
- Analytics / statistics dashboard

## Testing

### Backend
```bash
cd backend
uv run pytest                    # Run all tests
uv run pytest -v                 # Verbose output
uv run pytest tests/test_api/    # Run specific test suite
```

### Frontend E2E
```bash
cd frontend
pnpm test           # Run frontend unit tests (Vitest)
pnpm test:watch     # Vitest watch mode
pnpm test:e2e       # Run all E2E tests (Playwright)
pnpm test:e2e:ui    # Interactive Playwright UI mode
pnpm test:e2e:headed # Run E2E tests with visible browser
```

Or via just:
```bash
just test            # Run all E2E tests
just test-ui         # Interactive UI mode
```

> **The E2E suite does not run in CI – running it locally is your job.** ~300 Playwright tests
> take about 25 minutes, too slow to sit in front of every pull request, so the job in
> `.github/workflows/ci.yml` is switched off (`if: false`). Nothing else covers a full
> click-through, so **run `pnpm test:e2e` locally before a release and after any change to
> auth, the board, or alarm intake.** It needs the backend and frontend up (`just dev`).
>
> Making the suite fast enough to bring back into CI is [plan 15](docs/plans/15-e2e-in-ci.md).

## Project Architecture

- **Backend**: FastAPI with async SQLAlchemy, PostgreSQL, Alembic migrations
- **Frontend**: Next.js 15 App Router, React 19, Tailwind CSS 4, shadcn/ui
- **State management**: React Context with polling-based sync
- **Database settings**: Key-value store for runtime configuration (no restarts needed)
- **Print agent**: Standalone Python service for thermal printer support

See the [README](README.md#project-structure) for the full project structure.

## Questions?

- Open a [GitHub Issue](https://github.com/feuerwehr-oberwil/kp-rueck/issues) for bugs or feature requests
- Start a [Discussion](https://github.com/feuerwehr-oberwil/kp-rueck/discussions) for questions

## License

By contributing, you agree that your contributions will be licensed under the [AGPL-3.0 License](LICENSE).
