import { buildManifest, manifestLocale } from '@/lib/web-manifest'

// A route handler rather than the `app/manifest.ts` file convention: that one cannot see the
// request, and the language arrives as `?lang=` (see lib/web-manifest.ts for why not a cookie).
export function GET(request: Request) {
  const locale = manifestLocale(new URL(request.url).searchParams.get('lang'))
  return Response.json(buildManifest(locale), {
    headers: { 'Content-Type': 'application/manifest+json; charset=utf-8' },
  })
}
