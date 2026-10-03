"use client"

import { useEffect, useRef } from "react"
import { usePathname } from "next/navigation"
import { toast } from "sonner"
import { BUILD_ID } from "@/lib/build-info"
import { translateOutsideReact } from "@/lib/i18n-messages"

/** Same cadence as KP Front: a foregrounded tab learns about a deploy within 5 minutes. */
export const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000
const TOAST_ID = "app-update-available"
/** A wall display has nobody to tap «Neu laden» — it reloads itself, after a pause. */
const DISPLAY_RELOAD_DELAY_MS = 30_000
/** The build id a wall display last reloaded FOR — at most one reload per new build. */
export const RELOADED_FOR_KEY = "kp-update-reloaded-for"

function readReloadedFor(): string | null {
  try {
    return localStorage.getItem(RELOADED_FOR_KEY)
  } catch {
    // Unreadable storage: we could not COUNT reloads, so we never do one (the notice remains).
    return "unreadable"
  }
}
function writeReloadedFor(id: string): boolean {
  try {
    localStorage.setItem(RELOADED_FOR_KEY, id)
    return localStorage.getItem(RELOADED_FOR_KEY) === id
  } catch {
    return false
  }
}

/**
 * Is the new build really there to load? The page itself must answer 200 from this origin,
 * and the build endpoint must name the same new build a second time — a flapping check or a
 * half-rolled deploy is not a reason to blank a wall screen.
 */
export async function newBuildLoads(expectedId: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const page = await fetchImpl("/", { cache: "no-store" })
    if (!page.ok) return false
    return (await fetchServerBuildId(fetchImpl)) === expectedId
  } catch {
    return false
  }
}

/** Fetch the server's current build id; null when unreachable (offline is not an update). */
export async function fetchServerBuildId(fetchImpl: typeof fetch = fetch): Promise<string | null> {
  try {
    const response = await fetchImpl("/build-info", { cache: "no-store" })
    if (!response.ok) return null
    const body = (await response.json()) as { id?: unknown }
    return typeof body.id === "string" ? body.id : null
  } catch {
    return null
  }
}

/**
 * «Neue Version verfügbar» — Rück had no update check at all: after a deploy an open tab ran
 * the old bundle until somebody reloaded by hand. Now it compares its own build id with the
 * server's every 5 minutes and when the tab becomes visible again, and on a difference says
 * so ONCE, quietly, with «Neu laden» — never an automatic reload under somebody's hands
 * (KP Front's rule). Wall displays (/display) are the exception: nobody is there to tap, so
 * they reload themselves after a short pause — at most once per new build id, and only once
 * the new page and build answer (`newBuildLoads`); otherwise they get the notice too.
 *
 * The id never reads «unknown forever»: it is version · commit · BUILD TIME, all inlined at
 * build into both the page and /build-info, so one build always agrees with itself even
 * where the commit is missing.
 */
export function useUpdateNotice(
  fetchBuildId: () => Promise<string | null> = fetchServerBuildId,
  confirmLoads: (id: string) => Promise<boolean> = newBuildLoads,
) {
  const pathname = usePathname()
  const announced = useRef(false)
  const isDisplay = pathname === "/display" || pathname?.startsWith("/display/")

  useEffect(() => {
    let cancelled = false
    let reloadTimer: ReturnType<typeof setTimeout> | null = null

    const check = async () => {
      if (announced.current) return
      const serverId = await fetchBuildId()
      if (cancelled || !serverId || serverId === BUILD_ID) return
      announced.current = true
      // Wall display: reload ONCE per new build, and only when it really loads. Already
      // reloaded for this id and still served something else (two instances, a cache with
      // mixed builds)? Then it is the quiet notice like everywhere else — never a loop.
      if (isDisplay && readReloadedFor() !== serverId && (await confirmLoads(serverId))) {
        if (cancelled) return
        if (writeReloadedFor(serverId)) {
          reloadTimer = setTimeout(() => window.location.reload(), DISPLAY_RELOAD_DELAY_MS)
          return
        }
      }
      if (cancelled) return
      toast(translateOutsideReact("common.update.available"), {
        id: TOAST_ID,
        description: translateOutsideReact("common.update.hint"),
        duration: Infinity,
        action: { label: translateOutsideReact("common.update.reload"), onClick: () => window.location.reload() },
      })
    }

    const onVisible = () => {
      if (document.visibilityState === "visible") void check()
    }
    const interval = setInterval(() => void check(), UPDATE_CHECK_INTERVAL_MS)
    document.addEventListener("visibilitychange", onVisible)
    void check()
    return () => {
      cancelled = true
      clearInterval(interval)
      document.removeEventListener("visibilitychange", onVisible)
      if (reloadTimer) clearTimeout(reloadTimer)
    }
  }, [fetchBuildId, confirmLoads, isDisplay])
}

/** Renders nothing; mounted once in the AppShell for every page. */
export function UpdateNotice() {
  useUpdateNotice()
  return null
}
