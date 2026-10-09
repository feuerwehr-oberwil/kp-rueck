"use client"

import type { ReactNode } from "react"
import { useTranslations } from "next-intl"
import { ArrowLeft, ArrowRight, Package, Truck, User } from "lucide-react"

import { cn } from "@/lib/utils"
import { statusBadgeClass } from "@/lib/kanban-utils"
import { PRIORITY_ICONS, PRIORITY_TEXT_CLASSES } from "@/lib/priority"
import type {
  DispatchIncident,
  DispatchResource,
  DispatchTarget,
  DispatchToken,
  ParsedDispatch,
  PlannedResource,
} from "@/lib/command-dispatch"

/**
 * The ⌘K preview row: exactly what ↵ will do, as chips, before anything happens.
 *
 * `#14 Bachweg 3 ← TLF · Muster Peter · → Im Einsatz` for a dispatch; the one
 * chip for a jump or an open; and every typed word that did not count, greyed.
 * Neutral chips — slate/red keep their meanings (CLAUDE.md → Colour roles); only
 * the status chip carries its column's tint, the same chip the dialogs use, and
 * the priority its own icon colour.
 */

const CHIP = "inline-flex max-w-full min-w-0 items-center gap-1 rounded-sm border px-1.5 py-0.5 text-xs leading-5"

export function ResourceIcon({ kind, className }: { kind: DispatchResource["kind"]; className?: string }) {
  const Icon = kind === "vehicle" ? Truck : kind === "material" ? Package : User
  return <Icon aria-hidden className={cn("!size-3.5 shrink-0", className)} />
}

function IncidentChip({ incident }: { incident: DispatchIncident }) {
  const t = useTranslations("common.commandPalette.dispatch")
  return (
    <span className={cn(CHIP, "border-transparent bg-muted font-medium")} title={t("incidentTitle", { number: incident.number })}>
      <span className="font-mono tabular-nums text-muted-foreground">{incident.number}</span>
      <span className="truncate">{incident.label}</span>
    </span>
  )
}

function ResourceChip({ planned, resource }: { planned?: PlannedResource; resource: DispatchResource }) {
  const t = useTranslations("common.commandPalette.dispatch")
  const notes: string[] = []
  if (planned?.alreadyHere) notes.push(t("alreadyHere"))
  else if (planned && planned.elsewhere.length > 0) notes.push(t("elsewhere", { numbers: planned.elsewhere.join(", ") }))
  if (resource.kind !== "person" && resource.outOfService) notes.push(t("outOfService"))
  return (
    <span
      className={cn(CHIP, "border-border bg-background", planned?.alreadyHere && "text-muted-foreground")}
      data-dispatch-chip={resource.kind}
    >
      <ResourceIcon kind={resource.kind} />
      <span className="truncate">{resource.name}</span>
      {notes.length > 0 && <span className="shrink-0 text-muted-foreground">· {notes.join(" · ")}</span>}
    </span>
  )
}

function TargetChip({ target }: { target: DispatchTarget }) {
  const tColumns = useTranslations("kanban.columns")
  const tPriority = useTranslations("incidents.priority")
  if (target.kind === "status") {
    return (
      <span className={cn(CHIP, statusBadgeClass(target.status))} data-dispatch-chip="status">
        <ArrowRight aria-hidden className="!size-3.5" />
        {tColumns(target.status)}
      </span>
    )
  }
  if (target.kind === "priority") {
    const Icon = PRIORITY_ICONS[target.priority]
    return (
      <span className={cn(CHIP, "border-border bg-background")} data-dispatch-chip="priority">
        <Icon aria-hidden className={cn("!size-3.5", PRIORITY_TEXT_CLASSES[target.priority])} />
        {tPriority(target.priority)}
      </span>
    )
  }
  if (target.kind === "incident") return <IncidentChip incident={target.incident} />
  return <ResourceChip resource={target} />
}

/** A word that does not count: unknown, or recognised but superseded. */
function GreyToken({ token }: { token: DispatchToken }) {
  const t = useTranslations("common.commandPalette.dispatch")
  return (
    <span
      className={cn(CHIP, "border-dashed border-border font-mono text-muted-foreground/70")}
      title={token.state === "ignored" ? t("ignored") : t("unknown")}
      data-dispatch-token="grey"
    >
      {token.text}
    </span>
  )
}

function AmbiguousToken({ token }: { token: DispatchToken }) {
  const t = useTranslations("common.commandPalette.dispatch")
  return (
    <span className={cn(CHIP, "border-dashed border-foreground/40 font-mono")} data-dispatch-token="ambiguous">
      {token.text}
      <span className="font-sans text-muted-foreground">
        {token.confirm === "typo"
          ? t("confirmTypo")
          : token.confirm === "split"
            ? t("confirmSplit")
            : t("ambiguousCount", { count: token.choices?.length ?? 0 })}
      </span>
    </span>
  )
}

/** What ↵ does, right-aligned like the shortcut hints of every other row. */
function Action({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return (
    <span className={cn("ml-auto shrink-0 pl-2 text-xs", muted ? "text-muted-foreground" : "text-foreground")}>
      {children}
    </span>
  )
}

export function DispatchPreview({ parsed, canDispatch }: { parsed: ParsedDispatch; canDispatch: boolean }) {
  const t = useTranslations("common.commandPalette.dispatch")
  const { plan, tokens } = parsed
  const greyed = tokens.filter((token) => token.state === "unknown" || token.state === "ignored")
  const grey = greyed.length > 0 && (
    <span className="flex flex-wrap items-center gap-1">
      {greyed.map((token) => (
        <GreyToken key={`${token.start}-${token.text}`} token={token} />
      ))}
    </span>
  )

  let body: ReactNode
  let action: ReactNode
  if (plan.kind === "dispatch") {
    const statusOrPriority = tokens.filter(
      (token) => token.state === "match" && (token.target?.kind === "status" || token.target?.kind === "priority"),
    )
    body = (
      <>
        <IncidentChip incident={plan.incident} />
        <ArrowLeft aria-label={t("arrowAssign")} className="!size-3.5 shrink-0 text-muted-foreground" />
        {plan.assign.map((entry) => (
          <ResourceChip key={`${entry.target.kind}-${entry.target.id}`} planned={entry} resource={entry.target} />
        ))}
        {statusOrPriority.map((token) => (
          <TargetChip key={`${token.start}`} target={token.target!} />
        ))}
      </>
    )
    action = !canDispatch ? (
      <Action muted>{t("readOnly")}</Action>
    ) : plan.noop ? (
      <Action muted>{t("nothingToDo")}</Action>
    ) : (
      <Action>
        <kbd className="mr-1 font-sans">↵</kbd>
        {t("actionRun")}
      </Action>
    )
  } else if (plan.kind === "open") {
    body = <IncidentChip incident={plan.incident} />
    action = (
      <Action>
        <kbd className="mr-1 font-sans">↵</kbd>
        {t("actionOpen")}
      </Action>
    )
  } else if (plan.kind === "jump") {
    body = <ResourceChip resource={plan.target} />
    action = (
      <Action>
        <kbd className="mr-1 font-sans">↵</kbd>
        {t("actionJump")}
      </Action>
    )
  } else if (plan.kind === "blocked" && plan.reason === "ambiguous") {
    body = (
      <>
        {plan.incident && <IncidentChip incident={plan.incident} />}
        {plan.incident && <ArrowLeft aria-hidden className="!size-3.5 shrink-0 text-muted-foreground" />}
        {tokens.map((token) =>
          token.state === "ambiguous" ? (
            <AmbiguousToken key={token.start} token={token} />
          ) : token.state === "match" && token.target ? (
            <TargetChip key={token.start} target={token.target} />
          ) : null,
        )}
      </>
    )
    action = <Action muted>{t("pickBelow")}</Action>
  } else if (plan.kind === "blocked" && plan.reason === "unknown-incident") {
    body = <span className="text-sm text-muted-foreground">{t("unknownIncident", { number: plan.number })}</span>
  } else if (plan.kind === "blocked") {
    body = <span className="text-sm text-muted-foreground">{t("needsIncident")}</span>
  }

  return (
    <span className="flex w-full min-w-0 items-center gap-2" data-testid="dispatch-preview">
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
        {body}
        {grey}
      </span>
      {action}
    </span>
  )
}

/** One candidate of an ambiguous word, as a row under the preview. */
export function DispatchChoice({ token, choice }: { token: DispatchToken; choice: DispatchTarget }) {
  const t = useTranslations("common.commandPalette.dispatch")
  const tColumns = useTranslations("kanban.columns")
  const tPriority = useTranslations("incidents.priority")
  const label =
    choice.kind === "status"
      ? tColumns(choice.status)
      : choice.kind === "priority"
        ? tPriority(choice.priority)
        : choice.kind === "incident"
          ? choice.incident.label
          : choice.name
  const detail =
    choice.kind === "incident"
      ? choice.incident.type
      : choice.kind === "status" || choice.kind === "priority"
        ? undefined
        : choice.detail
  return (
    <span className="flex w-full min-w-0 items-center gap-2">
      {choice.kind === "status" ? (
        <ArrowRight aria-hidden className="!size-4 shrink-0" />
      ) : choice.kind === "priority" ? (
        (() => {
          const Icon = PRIORITY_ICONS[choice.priority]
          return <Icon aria-hidden className={cn("!size-4 shrink-0", PRIORITY_TEXT_CLASSES[choice.priority])} />
        })()
      ) : choice.kind === "incident" ? (
        <span className="min-w-4 shrink-0 text-center font-mono text-xs tabular-nums text-muted-foreground">
          {choice.incident.number}
        </span>
      ) : (
        <ResourceIcon kind={choice.kind} className="!size-4" />
      )}
      <span className="truncate">{label}</span>
      {detail && <span className="truncate text-xs text-muted-foreground">{detail}</span>}
      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
        {t(token.confirm ? "choiceConfirm" : "choiceFor", { text: token.text })}
      </span>
    </span>
  )
}
