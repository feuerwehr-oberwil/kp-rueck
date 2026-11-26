"use client"

import { useQuery } from "@tanstack/react-query"
import Link from "next/link"
import { Satellite } from "lucide-react"
import { useTranslations } from "next-intl"
import { apiClient } from "@/lib/api-client"
import { useAuth } from "@/lib/contexts/auth-context"
import { queryKeys } from "@/lib/query/keys"

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
 *
 * It wears the ÜBUNG tag's hatching (`training-hatch`, owner pick COL-07 A): one sign for
 * «nicht echt» everywhere, and no hue – it was purple, right beside the Reko violet pins.
 */
export function GpsSimBanner() {
  const t = useTranslations("training.banner")
  const { isAuthenticated } = useAuth()
  // Read again on every `gps_sim_status` (lib/query/socket-bridge.ts): the event says that
  // something changed, the read brings the drive details. A failed read shows no banner.
  const query = useQuery({
    queryKey: queryKeys.gpsSimulations,
    queryFn: () => apiClient.getGpsSimulations(),
    enabled: isAuthenticated,
  })
  const drives = query.isError ? [] : (query.data ?? [])

  if (!isAuthenticated || drives.length === 0) return null

  const names = drives.map((d) => d.vehicle_name).join(", ")

  return (
    <Link
      href="/training"
      className="absolute bottom-4 left-1/2 z-map-chrome -translate-x-1/2 training-hatch flex items-center gap-1.5 rounded-full bg-background/90 px-3 py-1 text-xs font-semibold text-foreground backdrop-blur-sm"
      title={t("linkTitle")}
    >
      <Satellite className="h-3.5 w-3.5" />
      {t("active", { names })}
    </Link>
  )
}
