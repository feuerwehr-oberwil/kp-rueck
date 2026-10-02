"use client"

import { useTranslations } from "next-intl"
import { useOperations } from "@/lib/contexts/operations-context"

/**
 * The chip menu's second header line for a person: rank, and «Einsatzleiter»
 * when they hold the role — «Wachtmeister · Einsatzleiter».
 *
 * A component rather than a string the chip is handed, because the chips only
 * know a name: looking the rank up for every chip on every card render is work
 * for a line nobody sees until a menu opens. The menu content mounts on open,
 * so this runs for one chip at a time.
 */
export function PersonMenuSubtitle({ name, isLeader = false }: { name: string; isLeader?: boolean }) {
  const t = useTranslations("kanban.leader")
  const { personnel } = useOperations()
  const role = personnel.find((person) => person.name === name)?.role
  const parts = [role, isLeader ? t("is") : null].filter(Boolean)
  return parts.length > 0 ? <>{parts.join(" · ")}</> : null
}
