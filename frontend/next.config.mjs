/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',

  // Performance optimizations
  compiler: {
    // Remove console.log in production
    removeConsole: process.env.NODE_ENV === 'production' ? {
      exclude: ['error', 'warn'],
    } : false,
  },

  // Optimize images and static assets
  images: {
    formats: ['image/avif', 'image/webp'],
    dangerouslyAllowSVG: true,
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },

  // Enable SWC minification for faster builds
  swcMinify: true,

  // Experimental features for better performance
  experimental: {
    // Optimize CSS loading
    optimizeCss: true,
    // Enable faster runtime
    optimizePackageImports: ['lucide-react', 'date-fns'],
  },
}

export default nextConfig
