"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Satellite } from "lucide-react"
import { useTranslations } from "next-intl"
import { apiClient, type ApiGpsSimDrive } from "@/lib/api-client"
import { wsClient } from "@/lib/websocket-client"
import { useAuth } from "@/lib/contexts/auth-context"

/**
 * "GPS-Simulation aktiv" indicator, shown ONLY on the map (rendered inside
 * MapView) — deliberately not app-wide, so trainees keep working realistically;
 * only whoever looks at the map sees that the vehicle movement is simulated.
 * Renders nothing while no simulation runs.
 *
 * NOT bound to `training_flag`, and that is deliberate: sim drives are global
 * and can outlive the drill they were started in, so simulated movement can
 * render on a LIVE event's map. The backend kills running sims when a real
 * alarm comes in; this banner is the belt-and-braces backstop — whenever the
 * user is authenticated and sim drives exist, it says so, whatever event is
 * selected.
 */
export function GpsSimBanner() {
  const t = useTranslations("training.banner")
  const { isAuthenticated } = useAuth()
  const [drives, setDrives] = useState<ApiGpsSimDrive[]>([])

  const refresh = useCallback(async () => {
    try {
      setDrives(await apiClient.getGpsSimulations())
    } catch {
      setDrives([])
    }
  }, [])

  useEffect(() => {
    if (!isAuthenticated) return
    refresh()
    const unsubscribe = wsClient.on(
      "gps_sim_status",
      (payload: { drives?: Array<{ vehicle_name: string }> }) => {
        // The WS payload is the authoritative "something changed" signal —
        // refetch for full drive details (progress etc. not in the event).
        if (payload?.drives && payload.drives.length === 0) setDrives([])
        else refresh()
      },
    )
    return () => unsubscribe()
  }, [isAuthenticated, refresh])

  if (!isAuthenticated || drives.length === 0) return null

  const names = drives.map((d) => d.vehicle_name).join(", ")

  return (
    <Link
      href="/training"
      className="absolute bottom-4 left-1/2 z-30 -translate-x-1/2 flex items-center gap-1.5 rounded-full border border-purple-400/60 bg-purple-100/90 px-3 py-1 text-xs font-semibold text-purple-900 shadow-md backdrop-blur-sm dark:bg-purple-950/90 dark:text-purple-200"
      title={t("linkTitle")}
    >
      <Satellite className="h-3.5 w-3.5" />
      {t("active", { names })}
    </Link>
  )
}
