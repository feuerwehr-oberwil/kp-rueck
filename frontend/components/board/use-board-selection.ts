"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useOperations, type Operation } from "@/lib/contexts/operations-context"
import { useNotifications } from "@/lib/contexts/notification-context"
import { useCrossWindowSync } from "@/lib/hooks/use-cross-window-sync"
import { useIncidentHighlightListener } from "@/lib/hooks/use-incident-highlight-listener"
import { useOperationHandlers } from "@/lib/hooks/use-operation-handlers"
import type { IncidentHighlightOptions } from "@/lib/notification-highlight"
import { isDetailSection, isDetailTab, type OperationDetailSection, type OperationDetailTab } from "@/lib/hooks/use-operation-detail-shortcuts"
import { nextCardId, type BoardDirection } from "@/lib/board-keyboard-nav"
import { SIDE_PANEL_BREAKPOINT } from "@/lib/layout-breakpoints"
import { boardDetailSurface, isPhoneViewport } from "@/lib/incident-detail"
import type { useBoardLayoutPrefs } from "@/lib/hooks/use-board-layout-prefs"
import type { MobileOpenRequest } from "@/components/mobile/mobile-incident-list-view"

/** The board's remembered sidebars and detail panel (`useBoardLayoutPrefs`). */
export type BoardLayout = ReturnType<typeof useBoardLayoutPrefs>

/** The board's selection – see `useBoardSelection`. */
export type BoardSelection = ReturnType<typeof useBoardSelection>

/** Open a card's detail (panel, modal or phone sheet), optionally on one tab and block. */
export type OpenIncidentDetail = BoardSelection["openIncidentDetail"]

interface UseBoardSelectionInput {
  layout: BoardLayout
  /** Unfold a board column (`useCollapsedSections(...).expand`, stable). */
  expandColumn: (columnId: string) => void
}

/**
 * Which card the board has open, and where: the selection, hover and highlight,
 * the spotlight a jump to a card raises, opening the detail on the surface the
 * viewport allows (side panel, modal, phone sheet), and everything that points at
 * a card from outside – a notification, a `?highlight=` deep link, the other
 * window, a highlight event. The board page calls it once and passes its pieces on.
 */
export function useBoardSelection({ layout, expandColumn }: UseBoardSelectionInput) {
  const { operations, updateOperation, assignVehicleToOperation, deleteOperation } = useOperations()
  const { registerNavigateHandler, closeSidebar: closeNotificationSidebar } = useNotifications()
  const { sidePanelMode, setSidePanelMode, showLeftSidebar, showRightSidebar } = layout
  const searchParams = useSearchParams()
  const router = useRouter()
  const highlightParam = searchParams.get("highlight")
  const openDetailParam = searchParams.get("detail") === "1"
  // Which detail tab the deep link meant («Angekommen» clicked away from the
  // board lands on Rapport, not Übersicht). Unknown values fall back to none.
  const rawTabParam = searchParams.get("tab")
  const tabParam = isDetailTab(rawTabParam) ? rawTabParam : undefined
  // …and which block in it (`boardDetailHref`): only with a valid tab.
  const rawSectionParam = searchParams.get("section")
  const sectionParam = tabParam && isDetailSection(rawSectionParam) ? rawSectionParam : undefined

  // Ref for highlight timeout cleanup
  const highlightTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const spotlightTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  // Render-time mirror for `scrollToCard`, which stays dependency-free: the
  // operations list (to find the card's column).
  const operationsRef = useRef(operations)
  operationsRef.current = operations
  // Same trick for `moveSelection`: it reads the current selection without
  // taking a dependency on it, so the handler identity stays stable across the
  // selection changes it is itself causing. Assigned next to the state below.
  const selectedOperationIdRef = useRef<string | null>(null)
  // Spotlight: for the first moment of a highlight the REST of the board steps
  // back instead of the card shouting. It is a separate, shorter window than the
  // highlight itself — the dim lifts, the accent ring stays for the remainder.
  const [spotlightActive, setSpotlightActive] = useState(false)

  /**
   * Arrow-key movement between cards. Sets the same `selectedOperationId` a
   * click sets, so every shortcut that acts on the selection works from the
   * keyboard unchanged — that was the whole gap. Also moves DOM focus, because
   * the card is the tab stop (roving tabindex in draggable-operation.tsx) and
   * focus is what draws the ring.
   *
   * `block: 'nearest'` rather than `scrollToCard`: this is a step, not a jump
   * to somewhere the operator was sent, so it must not spotlight the card or
   * recentre the board under them.
   */
  const moveSelection = useCallback((direction: BoardDirection) => {
    const next = nextCardId(selectedOperationIdRef.current, direction)
    if (!next) return
    setSelectedOperationId(next)
    const card = document.querySelector<HTMLElement>(`[data-incident-id="${next}"]`)
    card?.focus({ preventScroll: true })
    card?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [])

  // Scroll to and highlight a card by operation ID
  const scrollToCard = useCallback((operationId: string) => {
    // Unfold the card's column FIRST: a spotlight inside a folded column is a
    // spotlight nobody sees — the card is not even in the DOM to scroll to.
    // A ref, not a dep: this callback stays stable while operations churn.
    const op = operationsRef.current.find((candidate) => candidate.id === operationId)
    if (op) expandColumn(op.status)

    // Clear any existing highlight timeout
    if (highlightTimeoutRef.current) {
      clearTimeout(highlightTimeoutRef.current)
    }
    if (spotlightTimeoutRef.current) {
      clearTimeout(spotlightTimeoutRef.current)
    }

    // Set highlight immediately
    setHighlightedOperationId(operationId)
    setSpotlightActive(true)

    spotlightTimeoutRef.current = setTimeout(() => {
      setSpotlightActive(false)
    }, 1200)

    // Clear highlight after 3 seconds
    highlightTimeoutRef.current = setTimeout(() => {
      setHighlightedOperationId(null)
    }, 3000)

    // Scroll after short delay for DOM readiness
    setTimeout(() => {
      const card = document.querySelector(`[data-incident-id="${operationId}"]`) as HTMLElement
      if (!card) return

      const mainContainer = document.getElementById('kanban-main')
      const column = card.closest('[data-column]') as HTMLElement

      if (mainContainer && column) {
        const columnsContainer = mainContainer.querySelector('.flex.h-full') as HTMLElement
        if (columnsContainer) {
          // Calculate column position
          let columnLeft = 0
          const columns = columnsContainer.children
          for (let i = 0; i < columns.length; i++) {
            if (columns[i] === column) break
            columnLeft += (columns[i] as HTMLElement).offsetWidth + 12 // 12px = gap-3
          }

          const columnWidth = column.offsetWidth
          const containerWidth = mainContainer.clientWidth
          const scrollLeft = columnLeft - (containerWidth / 2) + (columnWidth / 2)

          // Centring is right until the column cannot be centred — the first and
          // last columns clamp to an edge, and there the card ends up flush
          // against it with its highlight ring half cut off. A gutter costs
          // nothing when the column really is centred (the clamp never bites).
          const EDGE_GUTTER = 16
          const maxScroll = Math.max(0, mainContainer.scrollWidth - containerWidth)
          const gutteredLeft = Math.min(
            Math.max(scrollLeft, columnLeft + columnWidth + EDGE_GUTTER - containerWidth),
            columnLeft - EDGE_GUTTER,
          )

          mainContainer.scrollTo({
            // whole pixels, or where the board comes to rest depends on rounding
            left: Math.round(Math.min(Math.max(0, gutteredLeft), maxScroll)),
            behavior: 'smooth'
          })
        }
      }

      // Vertical scroll after horizontal completes
      setTimeout(() => {
        card.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
          inline: 'nearest'
        })
      }, 300)
    }, 100)
  }, [expandColumn])

  const [selectedOperationId, setSelectedOperationId] = useState<string | null>(null)
  selectedOperationIdRef.current = selectedOperationId
  const [detailModalOpen, setDetailModalOpen] = useState(false)
  // Derive current operation from operations array to get real-time updates
  const selectedOperation = useMemo(() => {
    if (!selectedOperationId) return null
    return operations.find(op => op.id === selectedOperationId) || null
  }, [selectedOperationId, operations])
  const [hoveredOperationId, setHoveredOperationId] = useState<string | null>(null)
  const [highlightedOperationId, setHighlightedOperationId] = useState<string | null>(null)
  // "Open the detail on THIS tab" — set by whoever pointed at one specific
  // thing: a notification, the Rapport-Backlog, or a click on one BLOCK of a
  // kanban card (its Reko part, its resource rows). A click on the card as a
  // whole names no tab, clears this, and lands on the tab the operator was last
  // working in. The nonce makes a repeat click a new event; the panel does not
  // remount for an incident that is already selected.
  const [openDetailOnTab, setOpenDetailOnTab] = useState<{ tab: OperationDetailTab; nonce: number; section?: OperationDetailSection } | null>(null)

  // The phone list's «open this sheet» request (see openIncidentDetail), with the tab the caller
  // meant: the phone sheet has no tabs and scrolls to the matching block (lib/detail-target.ts).
  const [mobileOpenRequest, setMobileOpenRequest] = useState<MobileOpenRequest | null>(null)
  /** `section` narrows the landing further than the tab does — today only
   *  Übersicht's Ressourcen block, which the panel has to scroll to. */
  const openIncidentDetail = useCallback((
    operationId: string,
    tab?: OperationDetailTab,
    section?: OperationDetailSection,
    { allowModal = true }: { allowModal?: boolean } = {},
  ) => {
    setOpenDetailOnTab(tab ? { tab, nonce: Date.now(), section } : null)
    setSelectedOperationId(operationId)
    setHoveredOperationId(operationId)
    // Narrow viewport: only a notification earns an overlay. A sidebar binding would bury the
    // list the operator is working through, and its answer — «this device is on THAT card» — is
    // the ring, not a modal. On a phone the overlay is the phone Einsatz sheet, never the
    // desktop modal (lib/incident-detail.ts).
    const surface = boardDetailSurface({
      phone: isPhoneViewport(),
      wide: typeof window !== 'undefined' && window.innerWidth >= SIDE_PANEL_BREAKPOINT,
      allowModal,
    })
    if (surface === 'side-panel') {
      setDetailModalOpen(false)
      setSidePanelMode('detail')
    } else if (surface === 'phone-sheet') {
      setMobileOpenRequest({ incidentId: operationId, nonce: Date.now(), target: tab ? { tab, section } : undefined })
    } else if (surface === 'modal') {
      setDetailModalOpen(true)
    }
    // `setSidePanelMode` comes from `usePersistedState`; it is the plain
    // `useState` setter and therefore stable, but eslint cannot see that.
  }, [setSidePanelMode])

  const handleOpenIncidentFromNotification = useCallback((incidentId: string) => {
    if (operations.some((operation) => operation.id === incidentId)) openIncidentDetail(incidentId)
  }, [openIncidentDetail, operations])

  // Anything that points at a card — a notification row, a device or person
  // binding in the sidebar — scrolls to it, rings it AND opens its detail. A ring
  // on its own was half an answer: the operator clicked the thing in order to
  // look at it, then had to open the detail by hand. On the desktop that always
  // means the side panel beside the board; `allowModal` decides only what a
  // narrow viewport does, and only a notification may take over the screen
  // (see notification-highlight.ts). A caller that named a tab lands on it;
  // one that did not gets the tab that card was last left on.
  useIncidentHighlightListener(
    useCallback(
      (incidentId: string, { tab, section, allowModal }: IncidentHighlightOptions) => {
        scrollToCard(incidentId)
        openIncidentDetail(incidentId, tab, section, { allowModal })
      },
      [scrollToCard, openIncidentDetail],
    ),
  )

  // Cross-window sync (bidirectional)
  const { broadcast } = useCrossWindowSync({
    onMessage: (msg) => {
      if (msg.type === "incident:selected" && msg.incidentId) {
        setSelectedOperationId(msg.incidentId)
        setHighlightedOperationId(msg.incidentId)
      }
    },
  })

  useEffect(() => {
    const handleResize = () => {
      // A phone has neither panel nor modal: its detail is the phone Einsatz sheet. Without this
      // a resize (the iOS URL bar collapsing, a rotation) promoted a remembered side-panel
      // detail into the desktop modal over the phone list.
      if (!selectedOperationId || isPhoneViewport()) return
      const usePanel = window.innerWidth >= SIDE_PANEL_BREAKPOINT
      if (usePanel && detailModalOpen) {
        setDetailModalOpen(false)
        setSidePanelMode('detail')
      } else if (!usePanel && sidePanelMode === 'detail' && !detailModalOpen) {
        setDetailModalOpen(true)
      }
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [detailModalOpen, selectedOperationId, sidePanelMode, setSidePanelMode])
  // Anything that moves the open card, or moves the board around it, must not
  // lose it: toggling a sidebar or the panel re-lays the board out, and
  // «Status ändern» drops the card into a different column — often one that is
  // scrolled off the right-hand edge. Bring it back. Quietly: no highlight, no
  // spotlight. This is not «look here», it is «stay where you were».
  const selectedStatus = selectedOperation?.status
  useEffect(() => {
    if (!selectedOperationId) return
    const timer = setTimeout(() => {
      document
        .querySelector(`[data-incident-id="${selectedOperationId}"]`)
        ?.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" })
    }, 220)
    return () => clearTimeout(timer)
  }, [sidePanelMode, showLeftSidebar, showRightSidebar, selectedOperationId, selectedStatus])

  // Register notification click → scroll to card + open detail
  // Small screens: open modal overlay. Large screens (≥1536px): select in side panel.
  useEffect(() => {
    registerNavigateHandler((incidentId, tab, section) => {
      closeNotificationSidebar()
      scrollToCard(incidentId)
      // Open detail after scroll
      setTimeout(() => {
        const operation = operations.find(op => op.id === incidentId)
        if (operation) {
          // `tab` is what the notification was about (§18.27) — a rapport, a
          // Meldung, an arrival all live on Rapport now, and landing on
          // Übersicht made the operator hunt for the thing they were just told
          // about. Same call on both screen sizes; the detail decides whether
          // it renders as a modal or in the panel.
          openIncidentDetail(incidentId, tab, section)
        }
      }, 200)
    })
    return () => registerNavigateHandler(null)
  }, [registerNavigateHandler, closeNotificationSidebar, scrollToCard, operations, openIncidentDetail])

  // Scroll to and highlight operation when navigating with ?highlight= param.
  // With `&detail=1` the card is also OPENED — that is the Karte page's
  // «Details anzeigen» arriving here: the incident detail lives on the board,
  // in the panel next to the columns, and a second copy of it over the map was
  // a second place to keep in step.
  useEffect(() => {
    if (highlightParam) {
      scrollToCard(highlightParam)
      if (openDetailParam) openIncidentDetail(highlightParam, tabParam, sectionParam)
      // Clear the URL param to prevent re-scroll on refresh
      router.replace('/', { scroll: false })
    }
  }, [highlightParam, openDetailParam, tabParam, sectionParam, scrollToCard, openIncidentDetail, router])

  // The highlight timer is cleaned up by its own scrollToCard effect; nothing else to do here.
  useEffect(() => {
    return () => {
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current)
      }
      if (spotlightTimeoutRef.current) {
        clearTimeout(spotlightTimeoutRef.current)
      }
    }
  }, [])

  // Use ref to track drag state more reliably
  const isDraggingOperationRef = useRef(false)

  // `tab`/`section` come from the card and say which BLOCK was clicked — the
  // card routes into the detail rather than always landing on one tab. Both
  // handlers just forward them; the card decides which of the two it calls
  // (modal below the side-panel breakpoint, selection above it).
  const handleCardClick = (operation: Operation, tab?: OperationDetailTab, section?: OperationDetailSection) => {
    // Don't open modal if we just finished dragging
    if (isDraggingOperationRef.current) {
      return
    }
    openIncidentDetail(operation.id, tab, section)
    broadcast("incident:selected", operation.id)
  }

  const handleCardSelect = (operation: Operation, tab?: OperationDetailTab, section?: OperationDetailSection) => {
    openIncidentDetail(operation.id, tab, section)
  }

  // The detail modal's update / vehicle / delete, on the selected card.
  const { handleOperationUpdate, handleVehicleAssign, handleOperationDelete } = useOperationHandlers({
    selectedOperation,
    updateOperation,
    assignVehicleToOperation,
    deleteOperation,
  })

  return {
    selectedOperationId,
    setSelectedOperationId,
    selectedOperation,
    hoveredOperationId,
    setHoveredOperationId,
    highlightedOperationId,
    spotlightActive,
    detailModalOpen,
    setDetailModalOpen,
    openDetailOnTab,
    mobileOpenRequest,
    openIncidentDetail,
    handleOpenIncidentFromNotification,
    scrollToCard,
    moveSelection,
    isDraggingOperationRef,
    handleCardClick,
    handleCardSelect,
    handleOperationUpdate,
    handleVehicleAssign,
    handleOperationDelete,
  }
}
