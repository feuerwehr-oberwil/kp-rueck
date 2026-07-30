import { readFileSync } from 'node:fs'

import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./i18n/request.ts')

/** @type {import('next').NextConfig} */
// The version a problem report is filed against. Read from package.json rather than
// hard-coded so it cannot drift from the release the image was built as — a bug report
// naming the wrong version is worse than one naming none.
const appVersion = JSON.parse(readFileSync('./package.json', 'utf8')).version

const nextConfig = {
  reactStrictMode: true,

  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion,
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

  // Optimize images and static assets
  images: {
    formats: ['image/avif', 'image/webp'],
    dangerouslyAllowSVG: true,
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
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
    ]
  },

  // Webpack config to improve CSS hot reload stability
  webpack: (config, { dev }) => {
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
