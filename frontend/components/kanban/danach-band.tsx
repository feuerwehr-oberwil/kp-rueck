"use client"

import { Clock, X } from "lucide-react"
import { useTranslations } from "next-intl"
import { useAuth } from "@/lib/contexts/auth-context"
import { useOperations } from "@/lib/contexts/operations-context"
import { usePlanned, type PlannedAssignment } from "@/lib/contexts/planned-context"
import { cn } from "@/lib/utils"

/**
 * The «Danach» of an Einsatz or an Auftrag (owner pick 1B, 24.11.2026): who and what is planned
 * to come here after their current work. Drawn on the holder's card, under its resources.
 *
 * - Waiting: a dashed grey band «DANACH» – never a colour of its own (blue is an Auftrag,
 *   docs/DESIGN.md «Colour roles»); a resource further back in its queue says «2. Danach».
 * - Ready (the resource is free, this is its first Danach): the band turns warning-amber,
 *   «DANACH · JETZT FREI», with «Zuteilen» for the ready ones. Nothing moves by itself (pick 5).
 *
 * Reads the plans from `PlannedProvider` itself, so the card's memo gate needs no new prop: a
 * context change re-renders this child on its own. Renders nothing without plans.
 */
export function DanachBand({ holderId, className }: { holderId: string; className?: string }) {
  const plans = usePlanned().plannedFor(holderId)
  // Nothing planned (the usual case) reads nothing else – a card without plans stays as it was.
  return plans.length === 0 ? null : <DanachBandBody plans={plans} className={className} />
}

function DanachBandBody({ plans, className }: { plans: PlannedAssignment[]; className?: string }) {
  const t = useTranslations("incidents.danach")
  const { promote, remove } = usePlanned()
  const { isEditor } = useAuth()
  const { personnel, vehicles, materials } = useOperations()

  const nameOf = (plan: PlannedAssignment): string => {
    const list: { id: string; name: string }[] =
      plan.resource_type === "personnel" ? personnel : plan.resource_type === "vehicle" ? vehicles : materials
    return list.find((item) => item.id === plan.resource_id)?.name ?? "…"
  }
  const ready = plans.filter((plan) => plan.ready)
  const anyReady = ready.length > 0
  /** «Zuteilen» for every ready plan, one after the other: each promote locks the same holder.
   *  Never rejects – a refused promote is its own toast. */
  const promoteReady = async () => {
    for (const plan of ready) await promote(plan.id)
  }

  return (
    <div
      className={cn(
        "grid gap-1.5 rounded-md border px-2 py-1.5 text-xs",
        className,
        anyReady ? "border-warning bg-warning/10" : "border-dashed border-muted-foreground/50",
      )}
      aria-label={t("bandAria", { names: plans.map(nameOf).join(", ") })}
      onClick={(event) => event.stopPropagation()}
    >
      <div
        className={cn(
          "flex items-center gap-1.5 text-[10px] font-semibold tracking-wider",
          anyReady ? "text-warning-foreground" : "text-muted-foreground",
        )}
      >
        <Clock className="size-3" aria-hidden="true" />
        {anyReady ? t("readyLabel") : t("label")}
      </div>
      <div className="flex flex-wrap gap-1">
        {plans.map((plan) => (
          <span
            key={plan.id}
            className={cn(
              "inline-flex items-center gap-1 rounded border border-dashed px-1.5 py-0.5",
              plan.ready ? "border-warning text-foreground" : "border-muted-foreground/50 text-muted-foreground",
            )}
          >
            {nameOf(plan)}
            {plan.position > 1 && <span className="text-[10px]">· {t("queuePos", { position: plan.position })}</span>}
            {isEditor && (
              <button
                type="button"
                className="-mr-0.5 rounded p-0.5 hover:bg-muted"
                aria-label={`${t("remove")}: ${nameOf(plan)}`}
                title={t("remove")}
                onClick={() => void remove(plan.id)}
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            )}
          </span>
        ))}
      </div>
      {isEditor && anyReady && (
        <button
          type="button"
          className="justify-self-start rounded-md bg-foreground px-2 py-0.5 text-[11px] font-semibold text-background"
          onClick={() => void promoteReady()}
        >
          {t("assign")}
        </button>
      )}
    </div>
  )
}
