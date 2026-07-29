# Node 24 = Active LTS (security support to 2028-04-30). Node 20 went end-of-life on
# 2026-04-30 and this image sat on it for three months — a published image a fire station
# runs, on a runtime nobody was patching any more. Keep this in step with NODE_VERSION in
# .github/workflows/*.yml and the engines field in package.json; dependabot's docker
# ecosystem now proposes the bumps so it cannot drift silently again.
FROM node:24-alpine AS base

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

# Dependencies stage
FROM base AS deps
WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Builder stage
FROM base AS builder
WORKDIR /app

# Copy dependencies
COPY --from=deps /app/node_modules ./node_modules

# Copy source code
COPY . .

# Build the application
# Disable telemetry during build
ENV NEXT_TELEMETRY_DISABLED=1

# Next.js inlines NEXT_PUBLIC_* at build time — pass as build args.
#
# Both are OPTIONAL and the published image is built with NEITHER set: baking a URL in would
# tie the image to one station. Leave them unset and the browser uses its own origin
# (/backend-api for HTTP, forwarded to the runtime API_URL) — see frontend/lib/env.ts.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

# Only needed where the socket cannot be reached on the app's own origin: a platform with no
# shared reverse proxy, i.e. Railway behind a custom domain (docs/RAILWAY.md §1.2). WebSockets
# cannot traverse the /backend-api route, so the browser must address the backend directly.
#
# Unlike NEXT_PUBLIC_API_URL this is safe to bake in: it only names the socket endpoint and
# does not move HTTP traffic off the app's origin, so session cookies stay first-party and
# mobile logins keep working.
ARG NEXT_PUBLIC_WS_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL

RUN pnpm build

# Runner stage
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy built application
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
