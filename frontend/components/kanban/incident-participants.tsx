"use client"

/**
 * IncidentParticipants — "wer war dabei", including everyone already released.
 *
 * Completing an incident releases its crew, so the board's own crew list goes
 * empty and the record of who actually turned out survives only in the
 * assignment rows (soft-released via `unassigned_at`, never deleted). This
 * surfaces that record, so the question asked weeks later — "who was at the
 * Kellerbrand" — has an answer on the incident itself.
 *
 * Always expanded, and loaded when it mounts. It lives in the Verlauf tab,
 * which is itself the "show me the history" click — a second toggle inside it
 * was one more thing to find at 02:00 for no information gained. The tab does
 * not mount until it is in front, so a board click still pays nothing.
 */

import { useCallback, useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { History, Loader2, Package, Search, Truck, User } from "lucide-react"

import { apiClient, type ApiIncidentParticipant } from "@/lib/api-client"
import { sortCrewByLeader } from "@/lib/crew-order"
import { formatClockTime } from "@/lib/incident-time"
import { LeaderBadge } from "@/components/kanban/leader-badge"
import { cn } from "@/lib/utils"

const RESOURCE_ICON = { personnel: User, vehicle: Truck, material: Package } as const

/** Someone who went to look rather than to work gets the same magnifying glass
 *  the board already uses for the Reko row, so the two read as the same role. */
function participantIcon(p: ApiIncidentParticipant) {
  if (p.resource_type === "personnel" && p.is_reko) return Search
  return RESOURCE_ICON[p.resource_type] ?? User
}

export function IncidentParticipants({
  incidentId,
  className,
}: {
  incidentId: string
  className?: string
}) {
  const t = useTranslations("kanban.participants")
  const [participants, setParticipants] = useState<ApiIncidentParticipant[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setFailed(false)
    try {
      const response = await apiClient.getIncidentParticipants(incidentId)
      setParticipants(response.participants)
    } catch {
      // Non-fatal: this is a history panel, not the board. Show a retry rather
      // than a toast — nothing the operator was doing has failed.
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [incidentId])

  // Refetch when the incident changes under a panel that stays mounted, and on
  // every mount: the tab can sit open on a running incident for an hour, and a
  // crew list that quietly stopped updating is worse than one that takes a
  // moment to appear.
  useEffect(() => {
    setParticipants(null)
    setFailed(false)
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incidentId])

  return (
    <div className={cn("rounded-lg border border-border", className)}>
      <div className="flex w-full items-center gap-2 px-3 py-2">
        <History className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
        <span className="flex-1 text-sm font-semibold">{t("title")}</span>
        {participants !== null && (
          <span className="text-xs tabular-nums text-muted-foreground">{participants.length}</span>
        )}
      </div>

      <div className="border-t border-border px-3 py-2">
          {loading && (
            <p className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t("loading")}
            </p>
          )}

          {failed && (
            <button type="button" onClick={() => void load()} className="py-2 text-xs text-muted-foreground underline">
              {t("retry")}
            </button>
          )}

          {!loading && !failed && participants?.length === 0 && (
            <p className="py-2 text-xs italic text-muted-foreground/60">{t("empty")}</p>
          )}

          {!loading && !failed && participants && participants.length > 0 && (
            <ul className="space-y-1 py-1">
              {/* EL first (decision 23). Only a person carries is_leader, so the
                  Einsatzleiter lands on row 1 and the first_assigned_at order the
                  API returns survives underneath. */}
              {sortCrewByLeader(participants, (p) => p.is_leader).map((p) => {
                const Icon = participantIcon(p)
                const from = formatClockTime(new Date(p.first_assigned_at))
                const to = p.last_released_at ? formatClockTime(new Date(p.last_released_at)) : null
                return (
                  <li key={`${p.resource_type}:${p.resource_id}`} className="flex items-center gap-2 text-xs">
                    <Icon className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                    {/* Read-only: who LED the incident is part of the record. */}
                    <LeaderBadge isLeader={p.is_leader} />
                    <span className={cn("min-w-0 flex-1 truncate", !p.name && "italic text-muted-foreground")}>
                      {p.name ?? t("deletedResource")}
                    </span>
                    {p.stints > 1 && (
                      <span className="flex-shrink-0 text-muted-foreground/70" title={t("stints", { count: p.stints })}>
                        ×{p.stints}
                      </span>
                    )}
                    <span className="flex-shrink-0 font-mono tabular-nums text-muted-foreground">
                      {to ? `${from}–${to}` : t("stillOn", { from })}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
      </div>
    </div>
  )
}
