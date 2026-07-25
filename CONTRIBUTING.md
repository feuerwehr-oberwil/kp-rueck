# Contributing to KP Rück

Thank you for your interest in contributing! This project started as a tool for a Swiss fire department but is designed to be adaptable for fire departments and emergency services worldwide.

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
- **Translations / i18n** — the UI is currently German-only
- **Alerting integrations** — connect to platforms like Alamos, BORS, or other regional systems
- **CAD integration** — connect to Computer-Aided Dispatch systems
- **PDF report generation** — export incidents, board snapshots, or statistics as PDF

### Good First Issues
- UI improvements and accessibility
- Additional keyboard shortcuts
- Test coverage improvements
- Code cleanup and refactoring
- Documentation improvements (screenshots, tutorials)

### Advanced
- WebSocket support for real-time updates (replacing polling)
- Progressive Web App (PWA) support
- Mobile app (React Native)
- Analytics / statistics dashboard
- Multi-language support infrastructure

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
