/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
      "img-src 'self' data: blob: https://*.tile.openstreetmap.org https://tile.openstreetmap.org http://localhost:8080",
      // Fonts: self + data URIs
      "font-src 'self' data:",
      // Connect: self + API + map tiles + local tile server + WebSocket
      "connect-src 'self' http://localhost:8000 https://*.fwo.li https://*.railway.app https://*.tile.openstreetmap.org http://localhost:8080 ws://localhost:* wss://*.fwo.li wss://*.railway.app",
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
            value: 'camera=(), microphone=(), geolocation=(self), payment=()',
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

export default nextConfig
