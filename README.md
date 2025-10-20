# KP Rück Dashboard

Tactical dashboard for managing personnel, materials, and incidents during firefighting operations. Built with Next.js 15, TypeScript, and Tailwind CSS.

## Prerequisites

- Node.js 20.15 or newer
- pnpm 9.x (recommended via `corepack enable pnpm`)

## Local Development

```bash
pnpm install
pnpm dev
```

The development server runs on <http://localhost:3000>. Hot reload is enabled by default.

## Quality Checks

- `pnpm lint` — Runs Next.js ESLint checks
- `pnpm build` — Ensures the app compiles in production mode

Run both commands before deploying to catch type or runtime issues.

## Production Build

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

The `start` command serves the pre-built app. Railway (and most PaaS providers) automatically set the `PORT` environment variable; no additional configuration is required.

## Deploying to Railway

1. Push the repository to a Git provider (GitHub, GitLab, etc.).
2. Create a new Railway project and link the repository.
3. Use the default Nixpacks build; Railway will run `pnpm install` followed by `pnpm build`.
4. Set the start command to `pnpm start`.
5. Deploy. The app listens on the port provided by Railway.

No environment variables are required. If you later introduce secrets (APIs, databases), add them via Railway's Variables tab.

## Project Structure

- `app/` — Next.js App Router entry points
- `components/` — Reusable UI and layout primitives
- `hooks/` — Client-side utilities
- `lib/` — Shared helpers
- `public/` — Static assets
