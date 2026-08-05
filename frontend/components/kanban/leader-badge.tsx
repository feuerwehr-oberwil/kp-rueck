"use client"

/**
 * LeaderBadge — marks one assigned person as Einsatzleiter.
 *
 * "Who do I call about this one" is a question the board could not answer: it
 * showed a crew, not a chain of command. The role lives on the ASSIGNMENT, so
 * it can only ever name someone actually on the incident, and releasing them
 * clears it for free.
 *
 * Rendered as the literal abbreviation «EL» rather than an icon. A star reads
 * as "favourite", and any glyph has to be learned once; «EL» is what the role
 * is called on the radio, so it needs no legend — and the same two letters go
 * out unchanged in the Funkspruch and the WhatsApp text.
 *
 * Where it hangs follows who owns the resources: an incident that stands alone
 * carries its own leader, while a stop belonging to an Auftrag takes the
 * route's — one squad working a route has one leader, not one per tree it
 * clears. Callers pass the right `onPromote` for their level.
 */

import { useTranslations } from "next-intl"

import { cn } from "@/lib/utils"

/** Amber, like the other "pay attention to this one" marks on the board. */
const BADGE_BASE =
  "inline-flex flex-shrink-0 items-center justify-center rounded-[3px] px-1 font-mono text-[10px] font-bold uppercase leading-[1.4] tracking-wide"

export function LeaderBadge({
  isLeader,
  onPromote,
  className,
}: {
  isLeader: boolean
  /** Omitted for viewers and read-only surfaces — the badge still shows. */
  onPromote?: () => void
  className?: string
}) {
  const t = useTranslations("kanban.leader")

  // Read-only: show the badge only on the person who holds the role. An
  // uninteractive placeholder next to everyone else would be noise.
  if (!onPromote) {
    if (!isLeader) return null
    return (
      <span
        className={cn(BADGE_BASE, "bg-amber-400/20 text-amber-600 dark:text-amber-400", className)}
        title={t("is")}
        aria-label={t("is")}
      >
        {t("abbr")}
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={(event) => {
        // These sit inside chips and rows that are themselves clickable.
        event.stopPropagation()
        onPromote()
      }}
      aria-pressed={isLeader}
      title={isLeader ? t("is") : t("promote")}
      aria-label={isLeader ? t("is") : t("promote")}
      className={cn(
        BADGE_BASE,
        "transition-colors",
        isLeader
          ? "bg-amber-400/20 text-amber-600 dark:text-amber-400"
          : // Hidden until the row is hovered: on a twelve-person crew, twelve
            // grey EL stubs compete with the names they annotate.
            "text-muted-foreground/50 opacity-0 hover:bg-amber-400/10 hover:text-amber-600 focus-visible:opacity-100 group-hover:opacity-100 dark:hover:text-amber-400",
        className,
      )}
    >
      {t("abbr")}
    </button>
  )
}
