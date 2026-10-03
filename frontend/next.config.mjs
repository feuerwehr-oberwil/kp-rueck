import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./i18n/request.ts')

/** @type {import('next').NextConfig} */
// The version a problem report is filed against. Read from package.json rather than
// hard-coded so it cannot drift from the release the image was built as — a bug report
// naming the wrong version is worse than one naming none.
const appVersion = JSON.parse(readFileSync('./package.json', 'utf8')).version

// Which build this is — for the version label (lib/build-info.ts) and the «Neue Version
// verfügbar» check (/build-info). The commit is optional: a Docker build has no .git, so it
// comes from a build arg (GIT_SHA from the release workflow, RAILWAY_GIT_COMMIT_SHA on
// Railway) or stays empty. The build time is always there, which is what makes the id unique
// per build even without a commit (KP Front learned that the hard way: `dev@dev` forever).
function gitSha() {
  const fromEnv = process.env.GIT_SHA || process.env.RAILWAY_GIT_COMMIT_SHA || process.env.SOURCE_COMMIT
  if (fromEnv) return fromEnv.slice(0, 7)
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().slice(0, 7)
  } catch {
    return ''
  }
}
const gitShaShort = gitSha()
const buildTime = new Date().toISOString()

const nextConfig = {
  reactStrictMode: true,

  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion,
    NEXT_PUBLIC_GIT_SHA: gitShaShort,
    NEXT_PUBLIC_BUILD_TIME: buildTime,
  },
  output: 'standalone',

  // Disable ESLint during build (we run it separately in CI)
  eslint: {
    ignoreDuringBuilds: true,
  },

  // Performance optimizations
  compiler: {
    // Remove console.log in production (except error, warn, and log for debugging)
    removeConsole: process.env.NODE_ENV === 'production' ? {
      exclude: ['error', 'warn', 'log'],
    } : false,
  },

  // Photos are already resized by the backend; all Image consumers use direct URLs.
  // Disable the otherwise unused public /_next/image processing endpoint as well.
  images: {
    unoptimized: true,
  },

  // Experimental features for better performance
  experimental: {
    // Enable faster runtime
    optimizePackageImports: ['lucide-react', 'date-fns'],
  },

  // Security headers for all routes.
  //
  // The Content-Security-Policy is NOT here: Next serialises this block into the route manifest
  // during `next build`, so a header written here is fixed for the life of the image — and the
  // CSP's `connect-src` has to name a backend that is only known at runtime (`API_URL`). It is
  // built per request in `middleware.ts` instead; see `buildContentSecurityPolicy()` in
  // `lib/env.ts`. The headers below have no such dependency, and keeping them here keeps them
  // on every response, including the static assets the middleware matcher skips.
  async headers() {
    return [
      {
        // Apply to all routes
        source: '/(.*)',
        headers: [
          // Prevent MIME type sniffing
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Prevent clickjacking
          { key: 'X-Frame-Options', value: 'DENY' },
          // XSS protection (legacy browsers)
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          // Referrer policy - don't leak URLs to external sites
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Permissions policy - restrict sensitive APIs
          {
            key: 'Permissions-Policy',
            value: 'camera=(self), microphone=(), geolocation=(self), payment=()',
          },
        ],
      },
      {
        // Next applies configured headers after proxy response headers. Keep
        // credential-bearing API images at least as strict as the backend.
        source: '/backend-api/:path*',
        headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }],
      },
    ]
  },

  // Webpack config to improve CSS hot reload stability
  webpack: (config, { dev }) => {
    // `import svg from '…svg?raw'` → the file's text (types/svg-raw.d.ts). Only the shared
    // loading snail uses it: it is the byte-identical copy of KP Front's mascot, and the
    // boot screen needs it inline. Next's own image loader also claims `.svg`, so it is
    // told to leave `?raw` alone; both rules applying would hand webpack a JS module as
    // the "source". The rule has no `test` on purpose — Next treats a custom rule whose
    // `test` matches `.svg` as an SVGR setup and drops `.svg` from its image loader.
    const imageRule = config.module.rules.find(
      (rule) => rule && typeof rule === 'object' && rule.loader === 'next-image-loader',
    )
    if (imageRule?.resourceQuery?.not) imageRule.resourceQuery.not.push(/raw/)
    config.module.rules.push({ resourceQuery: /raw/, type: 'asset/source' })

    if (dev) {
      // Increase CSS chunk buffer to prevent 404s during hot reload
      config.optimization.splitChunks = {
        ...config.optimization.splitChunks,
        cacheGroups: {
          ...config.optimization.splitChunks?.cacheGroups,
          styles: {
            name: 'styles',
            type: 'css/mini-extract',
            chunks: 'all',
            enforce: true,
          },
        },
      }
    }
    return config
  },

  // Extend hot reload timeout to reduce 404 flickers
  onDemandEntries: {
    // Keep pages in memory longer (default: 15000ms)
    maxInactiveAge: 60 * 1000,
    // Buffer more pages in memory (default: 5)
    pagesBufferLength: 10,
  },
}

export default withNextIntl(nextConfig)
