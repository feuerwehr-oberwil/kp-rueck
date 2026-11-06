"use client"

/**
 * RouteResourceSections — the per-type resource sections (Mannschaft / Fahrzeuge /
 * Material) for a route-owned (Auftrag) resource roll-up. Extracted from the
 * operation detail modal so the detail modal AND the Aufträge sheet render the
 * exact same section UI (icon + count heading + add control + removable chips)
 * without duplicating markup.
 *
 * Behaviour is route-scoped: `onAssign` opens the resource dialog scoped to the
 * Auftrag and `onUnassign` detaches a route-owned resource by its assignment id.
 *
 * Provenance ("these belong to the Auftrag, not to this Schadenplatz") is NOT
 * said here any more. It used to be a `viaLabel` badge stamped into all three
 * section heads, which printed the Auftrag's name three times in a 372px column
 * and — sitting next to a `truncate`d label as a non-shrinkable span — pushed
 * the one genuinely new piece of information, the count in «Mannschaft (3)», out
 * of the heading. It is now said once, by the frame these sections sit in:
 * `ResourceSourceBlock` below.
 */

import { Fragment, type ComponentType, type ReactNode } from "react"
import { useTranslations } from "next-intl"
import { AlertTriangle, Users, Truck, Package, Plus, UserMinus } from "lucide-react"
import { RemovableChip } from "@/components/ui/removable-chip"
import { LeaderBadge, LeaderGlyph } from "@/components/kanban/leader-badge"
import { PersonMenuSubtitle } from "@/components/kanban/chip-menu-subtitle"
import { sortCrewByLeader } from "@/lib/crew-order"
import { cn } from "@/lib/utils"
import type { GroupResources } from "@/lib/types/groups"

/**
 * Shared section header — icon + "Label (N)" on the left, a trailing action on
 * the right. This is the single visual template for every peer sub-section of an
 * Auftrag (Mannschaft / Fahrzeuge / Material *and* Zugewiesene Einsätze), so all
 * four headers read as identical siblings. The Aufträge sheet imports this to
 * build its "Zugewiesene Einsätze" header from the same markup; the incident
 * detail builds its own three sections from it too.
 */
interface ResourceSectionHeaderProps {
  icon: ComponentType<{ className?: string }>
  /** The "Label (N)" text. */
  label: ReactNode
  /** Right-aligned control(s): the add button for resources, add/optimize for stops. */
  action?: ReactNode
}

export function ResourceSectionHeader({ icon: Icon, label, action }: ResourceSectionHeaderProps) {
  return (
    <div className="mb-1.5 flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <Icon className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
        <span className="truncate text-sm font-medium">{label}</span>
      </div>
      {action}
    </div>
  )
}

/**
 * The one chip every resource wears in the detail — person, vehicle, material
 * and module alike: the board card's filled muted chip (`<RemovableChip
 * variant="secondary">`), softly squared, 13/18 500.
 *
 * Filled, like the card and the phone sheet. It was an outlined chip here and a
 * filled one there, so one person on one Einsatz looked like three different
 * objects depending on where you read it (hill climb r18). The edge comes back
 * only on hover and keyboard focus, where it says «this one» together with the
 * remove tint.
 *
 * `rounded-sm` (8px, the radius of a control under 32px) rather than a pill: a
 * pill reads as a tag you filter by, a squared chip as an object that sits
 * somewhere, and these are objects. Colour on this board is for status and
 * priority, not for resource type; what genuinely distinguishes a chip lives
 * in words: the driver name, the depot – and the EL badge in the crew's
 * leading slot (`CrewChipSlot`).
 *
 * The hover tint is the remove affordance. `duration-150` rather than the bare
 * `transition-colors` default: an instant jump to destructive red on a row of
 * twelve chips reads as flicker while the pointer crosses them.
 */
export const RESOURCE_CHIP =
  "group gap-1 rounded-sm border-transparent px-2 pr-1 text-[13px] leading-[18px] font-medium " +
  "transition-colors duration-150 hover:border-border hover:bg-destructive/20 focus-within:border-border"

/**
 * One crew member of a detail resource row: a 28px leader slot, then the chip –
 * the 22px «EL» plus the chip row's 6px gap.
 *
 * The «EL» badge (or, with a mouse, the hover-only promote stub) stands in the
 * slot BEFORE the chip, not inside it, so every crew chip starts its name 8px in
 * and is as wide as its name – and the names of a column hang on one edge, the
 * EL in the margin like a list mark. Inside the chip, the invisible stub kept
 * ~30px of filled chip in front of every other name, so «Hoffmann Lisa» read as
 * centred in a fixed-width pill beside a left-aligned «EL Müller Hans» (hill
 * climb r19). `group`: hovering the person – slot or chip – reveals the stub.
 *
 * `leader` omitted = no slot: a row where nobody leads and nobody can be
 * promoted (read-only, a stop inside an Auftrag) has nothing to hang there. The
 * slot swallows its own clicks, so the space around the badge is not the row's
 * «zuweisen» target.
 */
export function CrewChipSlot({ leader, children }: { leader?: ReactNode; children: ReactNode }) {
  if (!leader) return <>{children}</>
  return (
    <span className="group inline-flex min-w-0 max-w-full items-center">
      <span className="flex w-7 shrink-0 items-center" onClick={(event) => event.stopPropagation()}>
        {leader}
      </span>
      {children}
    </span>
  )
}

/** Width of the resource row's label gutter — the same 120px `DetailField` uses. */
const RESOURCE_LABEL_GUTTER = "w-[120px]"

/** The row's trailing action column: 24px wide, as tall as a chip line. */
const RESOURCE_ACTION_COLUMN = "flex h-6 w-6 shrink-0 items-center justify-center"

/**
 * One resource row: `Symbol Beschriftung (n) │ Chips │ +`.
 *
 * The label with its live count sits in the same gutter every other
 * Übersicht row uses, the chip cluster to its right (wrapping in the 420px
 * panel), and the add control at the END of the row — not floating at the pane
 * edge, which is what a `flex-1` on the chips used to cause.
 *
 * A sibling of `DetailField`, not a use of it: the value here is a wrapping chip
 * cluster rather than a control, and the label heads a section instead of naming
 * a focusable field.
 *
 * Both mounts render from this one component now. The Auftrag roll-up used to
 * have its own — a full-size icon over a `text-sm font-medium` heading, the add
 * button at the far right, and a different chip family per resource type — so a
 * grouped Einsatz and a standalone one showed the same three lists in two
 * visibly different designs, one above the other in the same column.
 */
export function ResourceRow({
  icon: Icon,
  label,
  addLabel,
  onAdd,
  isEmpty = false,
  emptyLabel,
  children,
}: {
  icon?: ComponentType<{ className?: string }>
  label: ReactNode
  /** Accessible name and hover title of the add control, e.g. «Mannschaft zuweisen». */
  addLabel?: string
  /** Omitted = read-only row: no add control, and the empty placeholder is inert. */
  onAdd?: () => void
  /** Draws the clickable placeholder instead of `children`. */
  isEmpty?: boolean
  /** The placeholder's word — «keine». */
  emptyLabel?: ReactNode
  children?: ReactNode
}) {
  // The WHOLE row adds — full or empty. It was empty-only at first, on the
  // theory that a row with chips has controls of its own and a stray click
  // beside them should do nothing. In practice that left the common case
  // untouched: an Auftrag whose three rows all carry chips still had exactly one
  // 24px target per row, which is the complaint the empty case was fixing.
  //
  // The chips keep their own clicks (see the guard below), so removing a
  // resource and adding one never compete. What becomes clickable is the label,
  // the space after the last chip, the blank space beside a wrapped chip, and
  // the glyph: the parts of the row that did nothing at all before.
  const addLabelled = Boolean(onAdd && addLabel)

  /**
   * Add, unless the click was aimed at something that answers for itself.
   *
   * The guard is on the ROW rather than a `stopPropagation` on the chip cluster,
   * which is what it was first: a wrapping cluster is as wide as the row, so the
   * blank space beside a chip that had wrapped onto a second line sat *inside*
   * the cluster and swallowed the click. The obvious empty space in the middle of
   * the row did nothing.
   *
   * `closest` instead, so only the real controls opt out — the chip's X, the EL
   * badge, the driver-stay toggle. Everything else in the row, chips included,
   * opens the picker.
   */
  const addAnywhere = onAdd
    ? (event: React.MouseEvent<HTMLDivElement>) => {
        const target = event.target as HTMLElement | null
        const control = target?.closest("button, a, input, select, textarea, [role='button']")
        // `!== currentTarget`: this row IS a `role="button"`, so `closest` walks
        // straight up to it and would refuse every click on the row's own space
        // — the exact clicks this handler exists for.
        if (control && control !== event.currentTarget) return
        onAdd()
      }
    : undefined

  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-md py-1",
        onAdd && "-mx-1 cursor-pointer px-1 transition-colors duration-150 hover:bg-muted/40",
      )}
      onClick={addAnywhere}
      // When the row IS the control, it carries the control's name. Otherwise
      // the biggest target on screen would be the one thing with no accessible
      // name, and the name would sit on a 24px glyph nobody aims at.
      {...(addLabelled
        ? { role: "button", tabIndex: 0, title: addLabel, "aria-label": addLabel }
        : {})}
      onKeyDown={
        onAdd
          ? (event) => {
              if (event.target !== event.currentTarget) return
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault()
                onAdd()
              }
            }
          : undefined
      }
    >
      <span
        className={cn(
          "flex shrink-0 items-center gap-1.5 pt-1 text-xs text-muted-foreground",
          RESOURCE_LABEL_GUTTER,
        )}
      >
        {Icon && <Icon className="h-3.5 w-3.5 shrink-0" />}
        {label}
      </span>
      {/* `flex-1` on the value, so «+» sits at the END of the line and the three
          add buttons of a block stand in ONE column. Sized-to-content chips put
          each «+» wherever its row happened to stop — ragged, and the eye had to
          hunt for the next one. The rows are capped (`tabGridClass`), so the end
          of the line is a short trip, not the 500px it was on an uncapped one. */}
      {isEmpty ? (
        <span className="min-w-0 flex-1 py-0.5 text-sm text-muted-foreground">{emptyLabel}</span>
      ) : (
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">{children}</div>
      )}
      {/* The add glyph is decoration over a target that already spans the line —
          `aria-hidden` so the keyboard and a screen reader meet ONE control, not
          two answering to the same name. It stands in a fixed 24px action column
          (8px after the chips, the row's gap), so the «+» of all three rows sit in
          one column and a long chip wraps before it instead of running into it
          (hill climb r5). */}
      {addLabelled && (
        <span className={RESOURCE_ACTION_COLUMN} aria-hidden="true">
          <Plus className="size-3.5" />
        </span>
      )}
    </div>
  )
}

interface ResourceSourceBlockProps {
  /** Which side of the boundary this block is: the route's, or the stop's own. */
  variant: "route" | "incident"
  /**
   * The provenance heading — «Auftrag «Sturmholz Nord»» / «Nur dieser Einsatz».
   *
   * Left OUT for an incident that has only one source: with nothing to tell
   * apart, a frame that never gets a sibling is decoration, and the sections
   * render bare exactly as they always did.
   */
  title?: ReactNode
  /** One line saying what happens to what is in here on completion. */
  hint?: ReactNode
  /** The Auftrag's colour, for the edge and the dot. Route blocks only. */
  accentColor?: string | null
  children: ReactNode
}

/**
 * A provenance frame around resource sections — Variante A of mockup 08.
 *
 * «Fährt mit dem Auftrag weiter» and «gehört nur diesem Schadenplatz» are two
 * different things (completing a stop releases the second and not the first), so
 * the difference has to be visible. It is shown by POSITION: everything under
 * one edge has one origin, said once at the top, instead of a sentence repeated
 * into every section head.
 *
 * The two blocks never differ by colour alone — the route's dot is filled and
 * carries the Auftrag's colour, the incident's is a hollow ring on the neutral
 * border, and each block names itself in words.
 */
export function ResourceSourceBlock({ variant, title, hint, accentColor, children }: ResourceSourceBlockProps) {
  if (!title) return <>{children}</>

  const isRoute = variant === "route"

  return (
    <div
      data-resource-source={variant}
      className="mt-4 border-l-2 border-border pl-3"
      style={isRoute && accentColor ? { borderColor: accentColor } : undefined}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={cn(
            // 8px, not 6: the incident's marker is a RING, and a 1px border on
            // a 6px dot reads as a smudge rather than as "hollow".
            "size-2 shrink-0 rounded-full",
            isRoute ? "bg-muted-foreground" : "border border-muted-foreground",
          )}
          style={isRoute && accentColor ? { backgroundColor: accentColor } : undefined}
        />
        <span className="truncate text-xs font-semibold text-muted-foreground">{title}</span>
      </div>
      {hint && <p className="text-2xs text-muted-foreground/80">{hint}</p>}
      {children}
    </div>
  )
}

interface RouteResourceSectionsProps {
  resources: GroupResources
  /** Opens the resource dialog scoped to the ROUTE (works with 0 stops). */
  onAssign: (resourceType: "crew" | "vehicles" | "materials") => void
  /** Detach a route-owned resource by its group-assignment id. */
  onUnassign: (assignmentId: string) => void
  /** vehicle id → driver name, so a Fahrzeug chip names who is behind the
   *  wheel. Passed in rather than fetched here: this component stays
   *  presentational, and every caller already holds the live map from
   *  `useVehicleDrivers`. */
  vehicleDrivers?: ReadonlyMap<string, string>
  readOnly?: boolean
  /** Promote a route-owned person to Einsatzleiter. A stop owns no resources,
   *  so for a grouped incident this is where the leader is set — one squad on
   *  one route has one leader, not one per stop. */
  onPromoteLeader?: (assignmentId: string) => void
  /** Open the driver picker for a route vehicle that has nobody driving it —
   *  the «Fahrer wählen» action beside its amber «Kein Fahrer» note. */
  onPickDriver?: (vehicle: { resourceId: string; name: string }) => void
  /** Whether `vehicleDrivers` has actually loaded. Defaults to «a map was
   *  passed»; callers with a loading map pass the real flag so a vehicle does
   *  not flash «Kein Fahrer» before the first answer. */
  driversKnown?: boolean
}

export function RouteResourceSections({ resources, onAssign, onUnassign, vehicleDrivers, readOnly = false, onPromoteLeader, onPickDriver, driversKnown }: RouteResourceSectionsProps) {
  const knowsDrivers = driversKnown ?? Boolean(vehicleDrivers)
  const t = useTranslations("kanban")
  // The leader slot only where it can hold something (see `CrewChipSlot`).
  const crewHasLeaderSlot = (!readOnly && Boolean(onPromoteLeader)) || resources.personnel.some((p) => p.isLeader)
  return (
    <>
      {/* Mannschaft */}
      <ResourceRow
        icon={Users}
        label={t("common.crewCount", { count: resources.personnel.length })}
        addLabel={!readOnly ? t("common.assignCrew") : undefined}
        onAdd={!readOnly ? () => onAssign("crew") : undefined}
        isEmpty={resources.personnel.length === 0}
        emptyLabel={t("detail.resourceEmpty")}
      >
        {/* EL first (decision 23) — the route's leader heads the route's crew. */}
        {sortCrewByLeader(resources.personnel, (p) => Boolean(p.isLeader)).map((p) => (
          <CrewChipSlot
            key={p.assignmentId}
            leader={
              crewHasLeaderSlot && (
                <LeaderBadge
                  isLeader={Boolean(p.isLeader)}
                  onPromote={!readOnly && onPromoteLeader ? () => onPromoteLeader(p.assignmentId) : undefined}
                />
              )
            }
          >
            <RemovableChip
              variant="secondary"
              className={RESOURCE_CHIP}
              onRemove={!readOnly ? () => onUnassign(p.assignmentId) : undefined}
              removeTitle={t("common.removeNamed", { name: p.name })}
              removeButtonClassName="ml-1"
              // Touch: the same two actions the mouse has (EL stub, ✕), as rows.
              menuTitle={p.name}
              menuSubtitle={<PersonMenuSubtitle personnelId={p.resourceId} isLeader={Boolean(p.isLeader)} />}
              menuActions={
                !readOnly && onPromoteLeader && !p.isLeader
                  ? [{ label: t("leader.promote"), icon: <LeaderGlyph />, onSelect: () => onPromoteLeader(p.assignmentId) }]
                  : undefined
              }
              removeLabel={t("chipMenu.removeFromAuftrag")}
              removeIcon={UserMinus}
            >
              {p.name}
            </RemovableChip>
          </CrewChipSlot>
        ))}
      </ResourceRow>

      {/* Fahrzeuge */}
      <ResourceRow
        icon={Truck}
        label={t("common.vehiclesCount", { count: resources.vehicles.length })}
        addLabel={!readOnly ? t("common.assignVehicle") : undefined}
        onAdd={!readOnly ? () => onAssign("vehicles") : undefined}
        isEmpty={resources.vehicles.length === 0}
        emptyLabel={t("detail.resourceEmpty")}
      >
        {resources.vehicles.map((v) => {
          // «TLF 1 (M. Muster)» — the same chip wording the incident detail
          // uses for a standalone Einsatz, so a route reads the same way.
          const driverName = vehicleDrivers?.get(v.resourceId)
          // Nobody driving it: an amber reminder, not a block (a driver is
          // sometimes named a minute later) — and fixing it is one tap from
          // here. Only when the caller passed the driver map: without it «no
          // driver» and «not known» would look the same.
          const driverless = knowsDrivers && !driverName
          return (
            <Fragment key={v.assignmentId}>
            <RemovableChip
              variant="secondary"
              className={RESOURCE_CHIP}
              onRemove={!readOnly ? () => onUnassign(v.assignmentId) : undefined}
              removeTitle={t("common.removeNamed", { name: v.name })}
              removeButtonClassName="ml-1"
              menuTitle={v.name}
              menuSubtitle={driverName}
              removeLabel={t("chipMenu.removeFromAuftrag")}
            >
              {v.name}{driverName ? ` (${driverName})` : ""}
            </RemovableChip>
            {driverless &&
              (!readOnly && onPickDriver ? (
                <button
                  type="button"
                  onClick={() => onPickDriver({ resourceId: v.resourceId, name: v.name })}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-500/10 dark:text-amber-400"
                  aria-label={t("driverNote.pickFor", { vehicle: v.name })}
                >
                  <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
                  {t("driverNote.missing")}
                  <span aria-hidden>·</span>
                  <span className="underline underline-offset-2">{t("driverNote.pick")}</span>
                </button>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
                  {t("driverNote.missing")}
                </span>
              ))}
            </Fragment>
          )
        })}
      </ResourceRow>

      {/* Material */}
      <ResourceRow
        icon={Package}
        label={t("common.materialsCount", { count: resources.materials.length })}
        addLabel={!readOnly ? t("common.assignMaterial") : undefined}
        onAdd={!readOnly ? () => onAssign("materials") : undefined}
        isEmpty={resources.materials.length === 0}
        emptyLabel={t("detail.resourceEmpty")}
      >
        {resources.materials.map((m) => (
          <RemovableChip
            key={m.assignmentId}
            variant="secondary"
            className={RESOURCE_CHIP}
            onRemove={!readOnly ? () => onUnassign(m.assignmentId) : undefined}
            removeTitle={t("common.removeNamed", { name: m.name })}
            removeButtonClassName="ml-1"
            menuTitle={m.name}
            menuSubtitle={m.location}
            removeLabel={t("chipMenu.removeFromAuftrag")}
          >
            {m.name}
            {/* «Motorsäge» alone never said where to fetch it from. The
                sidebar shows the depot only because it groups by Standort;
                here the chip has to say it. */}
            {m.location && <span className="text-xs text-muted-foreground">{m.location}</span>}
          </RemovableChip>
        ))}
      </ResourceRow>
    </>
  )
}
