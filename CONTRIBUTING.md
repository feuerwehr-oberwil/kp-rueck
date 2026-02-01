# Contributing to KP Rück

Thank you for your interest in contributing! This project started as a tool for a specific fire department but is designed to be adaptable for emergency services worldwide.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/kp-rueck.git`
3. Create a branch: `git checkout -b feature/your-feature-name`
4. Make your changes
5. Submit a pull request

## Development Setup

See the [README](README.md#quick-start) for detailed setup instructions.

**Quick start:**
```bash
just dev          # Start development environment
just logs         # View logs
just test         # Run E2E tests
```

## Code Style

### Backend (Python)
- Format with `ruff format .`
- Lint with `ruff check .`
- Use type hints
- Follow async patterns consistently

### Frontend (TypeScript)
- Format with Prettier
- Lint with ESLint (`pnpm lint`)
- Use TypeScript strictly (no `any`)
- Follow Next.js App Router conventions

## Commit Messages

Use clear, descriptive commit messages:

```
feat: add vehicle GPS tracking display
fix: correct incident status transition validation
docs: update deployment guide for Railway
refactor: simplify polling logic in operations context
```

## Pull Request Guidelines

1. **Keep PRs focused** - One feature or fix per PR
2. **Update documentation** - If you change behavior, update relevant docs
3. **Add tests** - For new features, add appropriate test coverage
4. **Test manually** - Verify the feature works in the browser
5. **Describe your changes** - Explain what and why in the PR description

## Areas for Contribution

### High Impact
- **Translations** - Add support for other languages (currently German)
- **CAD Integration** - Connect to Computer-Aided Dispatch systems
- **Alerting Integration** - Connect to alerting platforms (Divera, Alamos)
- **Documentation** - Screenshots, tutorials, deployment guides

### Good First Issues
- UI improvements and accessibility
- Additional keyboard shortcuts
- Test coverage improvements
- Code cleanup and refactoring

### Advanced
- WebSocket support for real-time updates
- Mobile app (React Native)
- PDF report generation
- Analytics dashboard

## Testing

### Backend
```bash
cd backend
uv run pytest                    # Run all tests
uv run pytest -v                 # Verbose output
uv run pytest tests/test_api/    # Run specific tests
```

### Frontend E2E
```bash
cd frontend
pnpm test           # Run all E2E tests
pnpm test:ui        # Interactive Playwright UI
pnpm test:headed    # See the browser
```

## Questions?

- Open a [GitHub Issue](https://github.com/feuerwehr-oberwil/kp-rueck/issues) for bugs or feature requests
- Start a [Discussion](https://github.com/feuerwehr-oberwil/kp-rueck/discussions) for questions

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
