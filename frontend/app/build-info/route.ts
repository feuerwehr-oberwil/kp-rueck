import { NextResponse } from "next/server"
import { APP_VERSION, BUILD_ID } from "@/lib/build-info"

/**
 * The build the SERVER is running now. An open tab compares it with the build it loaded
 * (`useUpdateNotice`): different means a deploy happened since, and the tab offers
 * «Neu laden». Public and tiny on purpose — it says a version string and nothing else, and
 * it must answer on the login page and the phone forms too.
 */
export const dynamic = "force-dynamic"

export function GET() {
  return NextResponse.json(
    { id: BUILD_ID, version: APP_VERSION },
    { headers: { "Cache-Control": "no-store" } },
  )
}
