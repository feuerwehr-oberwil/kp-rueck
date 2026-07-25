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

  // Security headers for all routes
  async headers() {
    // CSP directives - allow maps, inline styles (Tailwind), and Next.js hydration
    const cspDirectives = [
      "default-src 'self'",
      // Scripts: self + inline (Next.js hydration) + eval (dev hot reload)
      process.env.NODE_ENV === 'production'
        ? "script-src 'self' 'unsafe-inline'"
        : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      // Styles: self + inline (Tailwind CSS)
      "style-src 'self' 'unsafe-inline'",
      // Images: self + data URIs + blob + map tile servers
      "img-src 'self' data: blob: https://*.tile.openstreetmap.org https://tile.openstreetmap.org https://*.basemaps.cartocdn.com https://server.arcgisonline.com http://localhost:8080",
      // Fonts: self + data URIs
      "font-src 'self' data:",
      // Connect: self + API + map tiles + local tile server + WebSocket
      // Dynamically include backend URL from env (supports custom domains like kp-api.fwo.li)
      // A self-hosted deployment needs no entry of its own: it is served from ONE origin, so
      // the API (/backend-api), the tiles (/tiles) and the WebSocket all fall under 'self' —
      // which per CSP3 covers same-origin ws:/wss: too. The explicit hosts below are for the
      // split-origin Railway deployment and for local development.
      `connect-src 'self' http://localhost:8000 https://*.railway.app ${process.env.NEXT_PUBLIC_API_URL ? process.env.NEXT_PUBLIC_API_URL : ''} ${process.env.NEXT_PUBLIC_API_URL ? process.env.NEXT_PUBLIC_API_URL.replace(/^https?/, 'wss') : ''} https://*.tile.openstreetmap.org https://nominatim.openstreetmap.org https://*.basemaps.cartocdn.com https://server.arcgisonline.com http://localhost:8080 ws://localhost:* wss://*.railway.app`,
      // Frame ancestors: prevent clickjacking
      "frame-ancestors 'none'",
      // Form actions: only to self
      "form-action 'self'",
      // Base URI: only self
      "base-uri 'self'",
      // Object sources: none (no plugins)
      "object-src 'none'",
    ].join('; ')

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
          // Content Security Policy
          { key: 'Content-Security-Policy', value: cspDirectives },
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
