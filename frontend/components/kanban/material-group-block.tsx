"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"
import { draggable } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { DraggableMaterial } from "@/components/kanban/draggable-material"
import { type Material, useOperations } from "@/lib/contexts/operations-context"
import { useMaterials, type MaterialGroup } from "@/lib/contexts/materials-context"
import { useGroups } from "@/lib/contexts/groups-context"
import { getIncidentRefLabel } from "@/lib/incident-types"
import { requestIncidentHighlight } from "@/lib/notification-highlight"
import { cn } from "@/lib/utils"
import { ArrowRight, ArrowUpRight, ChevronDown, ChevronRight, Layers } from "lucide-react"

interface MaterialGroupBlockProps {
  group: MaterialGroup
  materials: Material[]
  allAvailable: boolean
  someAssigned: boolean
  allAssigned: boolean
  onMaterialClick: (material: Material) => void
}

/** Where a busy device is currently spoken for — an incident, or an Auftrag. */
interface DeviceBinding {
  key: string
  kind: 'incident' | 'route'
  targetId: string
  label: string
  detail: string
}

/**
 * A module block in the board's Material sidebar.
 *
 * The block itself is one draggable magnet: dragging it hands over every
 * available device at once. Expanding it lists the members, and each member is
 * a row with the same two affordances an UNGROUPED device has in the sidebar
 * (`MaterialSidebarRow` in `app/page.tsx`) — right-click → «Nicht einsatzbereit»,
 * and a popover naming every binding of a busy device. Being inside a module is
 * a fact about the depot, not a reason to lose them.
 */
export function MaterialGroupBlock({
  group,
  materials,
  allAvailable,
  someAssigned,
  allAssigned,
  onMaterialClick,
}: MaterialGroupBlockProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  // Which member's bindings list is open. Local, unlike the ungrouped rows'
  // (which the board owns): the board has no anchor inside a module block, so
  // the popover has to be positioned by the row that raised it.
  const [openBindingsFor, setOpenBindingsFor] = useState<string | null>(null)
  const { setMaterialOutOfService } = useMaterials()

  const availableCount = materials.filter(m => m.status === 'available').length
  const totalCount = materials.length
  const hasAvailable = availableCount > 0

  useEffect(() => {
    const element = ref.current
    if (!element || !hasAvailable) return

    return draggable({
      element,
      getInitialData: () => ({
        type: "material-group",
        materials: materials.filter(m => m.status === 'available'),
        group,
      }),
      onDragStart: () => setIsDragging(true),
      onDrop: () => setIsDragging(false),
    })
  }, [materials, group, hasAvailable])

  return (
    <Card
      ref={ref}
      className={cn(
        "border border-border/50 bg-card/80 backdrop-blur-sm transition-all overflow-hidden p-0 gap-0",
        allAssigned && "opacity-60",
        hasAvailable && !expanded && "cursor-grab",
        isDragging && "opacity-50",
      )}
    >
      {/* Group header — clickable to expand */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 transition-colors"
      >
        <Layers className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
        <span className="font-medium text-sm text-foreground flex-1 truncate">{group.name}</span>

        {/* Status indicator */}
        <span className={cn(
          "text-xs font-medium tabular-nums px-1.5 py-0.5 rounded",
          allAvailable && "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10",
          someAssigned && !allAssigned && "text-amber-600 dark:text-amber-400 bg-amber-500/10",
          allAssigned && "text-muted-foreground bg-muted"
        )}>
          {availableCount}/{totalCount}
        </span>

        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
        )}
      </button>

      {/* Expanded children */}
      {expanded && (
        <div className="px-1.5 pb-1.5 pt-1 space-y-1 border-t border-border/50">
          {materials.map((material) => (
            <ModuleMemberRow
              key={material.id}
              material={material}
              onClick={() => onMaterialClick(material)}
              bindingsOpen={openBindingsFor === material.id}
              onOpenBindings={() => setOpenBindingsFor(material.id)}
              onCloseBindings={() => setOpenBindingsFor(null)}
              onToggleOutOfService={(outOfService) => {
                void setMaterialOutOfService(material.id, outOfService)
              }}
            />
          ))}
        </div>
      )}
    </Card>
  )
}

/**
 * One device inside an expanded module block.
 *
 * Same contract as the ungrouped `MaterialSidebarRow`: the right-click menu
 * writes the SAME single `out_of_service` flag the Materialverwaltung writes —
 * no submenu, no reason picker, no cause list — and a busy device with more
 * than one binding opens the list instead of guessing one.
 *
 * A device that IS flagged never renders here: the board pulls flagged devices
 * out of their module and draws them as a dashed row at the end of the category
 * list, so the dead device cannot sit in the middle of the pickable ones.
 */
function ModuleMemberRow({
  material,
  onClick,
  bindingsOpen,
  onOpenBindings,
  onCloseBindings,
  onToggleOutOfService,
}: {
  material: Material
  onClick: () => void
  bindingsOpen: boolean
  onOpenBindings: () => void
  onCloseBindings: () => void
  onToggleOutOfService: (outOfService: boolean) => void
}) {
  const t = useTranslations('kanban.common')
  const bindings = useDeviceBindings(material)

  const handleClick = () => {
    // One binding (or none) is the board's own job — it owns the scroll, the
    // spotlight and the Aufträge sheet. Only the ambiguous case is ours.
    if (bindings.length <= 1) {
      onClick()
      return
    }
    onOpenBindings()
  }

  return (
    <Popover open={bindingsOpen} onOpenChange={(open) => { if (!open) onCloseBindings() }}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <PopoverAnchor asChild>
            <div>
              <DraggableMaterial material={material} onClick={handleClick} />
            </div>
          </PopoverAnchor>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuCheckboxItem
            checked={material.outOfService}
            onCheckedChange={(checked) => onToggleOutOfService(checked === true)}
          >
            {t('notReady')}
          </ContextMenuCheckboxItem>
        </ContextMenuContent>
      </ContextMenu>
      <PopoverContent align="start" side="left" className="w-80 p-3">
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{material.name}</p>
              <p className="truncate text-2xs text-muted-foreground">{material.category}</p>
            </div>
            <Badge variant="outline" className="shrink-0 border-amber-200 text-amber-700 dark:border-amber-800/50 dark:text-amber-400">
              {t('bindingsCount', { count: bindings.length })}
            </Badge>
          </div>
          <p className="text-2xs text-muted-foreground">{t('bindingsPick')}</p>
          <div className="space-y-1">
            {bindings.map((binding) => (
              <button
                key={binding.key}
                type="button"
                onClick={() => { followDeviceBinding(binding); onCloseBindings() }}
                className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted/60"
              >
                <ArrowRight className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{binding.label}</span>
                  {binding.detail && <span className="block truncate text-2xs text-muted-foreground">{binding.detail}</span>}
                </span>
                <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" />
              </button>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

/**
 * Every place this device is currently spoken for: the incidents carrying it,
 * plus the Aufträge that own it. Mirrors the board's `collectMaterialBindings`
 * — the board's copy is bound to page state this component cannot reach.
 */
function useDeviceBindings(material: Material): DeviceBinding[] {
  const { operations } = useOperations()
  const { groups, getGroupResources } = useGroups()
  return useMemo(() => {
    const groupNames = new Map(groups.map((g) => [g.id, g.name] as const))
    const bindings: DeviceBinding[] = operations
      .filter((op) => op.materials.includes(material.id))
      .map((op) => ({
        key: `incident-${op.id}`,
        kind: 'incident' as const,
        targetId: op.id,
        label: getIncidentRefLabel(op, 60),
        detail: op.groupId ? groupNames.get(op.groupId) ?? '' : '',
      }))
    for (const group of groups) {
      if (getGroupResources(group.id).materials.some((m) => m.resourceId === material.id)) {
        bindings.push({ key: `route-${group.id}`, kind: 'route', targetId: group.id, label: group.name, detail: '' })
      }
    }
    return bindings
  }, [material.id, operations, groups, getGroupResources])
}

/**
 * Jump to one binding, through the same two doors the board already listens on
 * (`lib/notification-highlight.ts` and the `kp:open-auftraege` event) rather
 * than threading page handlers down into a sidebar row.
 */
function followDeviceBinding(binding: DeviceBinding): void {
  if (binding.kind === 'incident') {
    // A sidebar binding: open the card, but never behind a modal on a phone —
    // that would bury the very list being worked through.
    requestIncidentHighlight(binding.targetId, { allowModal: false })
    return
  }
  window.dispatchEvent(new CustomEvent('kp:open-auftraege', { detail: { groupId: binding.targetId } }))
}
