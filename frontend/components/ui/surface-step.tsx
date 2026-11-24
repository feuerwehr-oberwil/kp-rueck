'use client'

import { Fragment, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslations } from 'next-intl'
import { ArrowLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { useIsMobile } from '@/components/ui/use-mobile'

/**
 * No window on a window (owner pick 5A, 19.11.2026). A picker opened FROM a work surface (the
 * L dialogs, a footer sheet, the Neuer-Einsatz form) does not open a second, narrower dialog
 * over it: it replaces the surface's content as a STEP – same window, same size, a breadcrumb
 * «Fahrzeuge zuweisen › Fahrer für Trawa», «← Zurück», and Esc goes back instead of closing
 * the surface. Its answers (Abbrechen, Übernehmen) end the step the same way.
 *
 * Two halves:
 * - A surface declares itself with `surface="<its name>"` on `DialogContent` / `SheetContent`
 *   (`useSurfaceStepHost` underneath): it renders an empty slot as its last child and
 *   registers it while it is open. The newest open surface is the one on top.
 * - A window that can be a step (`PickerDialog`, the map picker, the enlarged QR) asks
 *   `useOpenSurface()`; while one is open it renders `<SurfaceStep>` into that slot instead of
 *   its own dialog. That is how a picker mounted somewhere else entirely – the driver prompt in
 *   the root layout – still lands inside «Fahrzeuge zuweisen».
 *
 * While the slot has content the surface's own children are `inert` and unseen (globals.css –
 * their state, scroll position and size stay) and the step lies over them. A real yes/no
 * question (ConfirmDialog) may still open on top – it is S, never wider than what is under it.
 *
 * Desk only: on a phone every one of these is a bottom sheet and keeps its own behaviour. The
 * one exception is the map picker (`phone: true`): over the phone's «Neuer Einsatz» sheet it is
 * the same step, not a centred desk card over the sheet (phone sweep 24.11.2026).
 */
export interface SurfaceHost {
  readonly slot: HTMLElement
  /** The surface's name – what «Esc zurück zu …» names. */
  readonly name: string
  /** The breadcrumb up to and including this surface: the window's name, then the name of
   *  every step that is a surface itself («Bottmingerstrasse 75 › Fahrzeuge zuweisen»). */
  readonly trail: readonly string[]
  /** An L window (or a step inside one): only there does a work surface of its own – the
   *  assignment dialog – open as a step instead of its own L window. */
  readonly wide: boolean
}

let hosts: readonly SurfaceHost[] = []
const listeners = new Set<() => void>()
/** The open step's «go back», per surface slot – what Esc on the surface calls. */
const stepBacks = new WeakMap<HTMLElement, () => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
const topHost = () => hosts.at(-1) ?? null
const setHosts = (next: readonly SurfaceHost[]) => {
  hosts = next
  listeners.forEach((listener) => listener())
}

/**
 * The host half, for the `DialogContent` / `SheetContent` primitives: the slot to render as the
 * content's LAST child, and the Esc / outside-click guards to compose into the content's own.
 * `name` undefined = not a surface (no slot, guards pass through). `parent` = the surface this
 * one is a step of (a step that is a surface itself, `SurfaceStep surface`); `wide` = an L window.
 */
export function useSurfaceStepHost(name: string | undefined, { parent, wide = false }: { parent?: SurfaceHost; wide?: boolean } = {}) {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => {
    if (!slot || !name) return
    const host: SurfaceHost = {
      slot,
      name,
      trail: parent ? [...parent.trail, name] : [name],
      wide: parent ? parent.wide : wide,
    }
    setHosts([...hosts, host])
    return () => setHosts(hosts.filter((h) => h !== host))
  }, [slot, name, parent, wide])

  /** Ends the step open in this surface, if there is one. */
  const back = () => {
    const end = slot ? stepBacks.get(slot) : undefined
    end?.()
    return Boolean(end)
  }

  return {
    slot: name ? <div ref={setSlot} data-surface-step="" className={SLOT_CLASS} /> : null,
    back,
    /** Esc while a step is open goes back to the surface instead of closing it. */
    onEscapeKeyDown: (event: KeyboardEvent) => {
      if (!back()) return false
      event.preventDefault()
      return true
    },
    /** A click beside the window while a step is open closes nothing: the step is answered
     *  with its own buttons, and the surface under it must not vanish with the half-made pick. */
    stepOpen: () => Boolean(slot && stepBacks.has(slot)),
  }
}

/** Does this surface element (a footer sheet's content) show a step right now? For a surface
 *  that closes on outside clicks by its own listener (footer-sheet.tsx). */
export function surfaceShowsStep(content: Element): boolean {
  return content.querySelector(':scope > [data-surface-step]:not(:empty)') !== null
}

// Lies over the surface's (hidden) children; the empty slot is `display: none` (globals.css).
const SLOT_CLASS = 'absolute inset-0 z-raised flex flex-col overflow-hidden rounded-[inherit] bg-background'

/** The surface a step-capable window opens into right now, or null (no surface, or a phone).
 *  `wideOnly`: only an L window counts – for a work surface that would be cramped in a sheet.
 *  `phone`: a phone counts too – for a window that is a step in a phone sheet as well. */
export function useOpenSurface({ wideOnly = false, phone = false }: { wideOnly?: boolean; phone?: boolean } = {}): SurfaceHost | null {
  const isMobile = useIsMobile()
  const host = useSyncExternalStore(subscribe, topHost, () => null)
  if ((isMobile && !phone) || (wideOnly && !host?.wide)) return null
  return host
}

const NO_HOSTS: readonly SurfaceHost[] = []

/**
 * `useOpenSurface` for a window that is a surface ITSELF (the assignment dialog): the surface it
 * opened into is read on the render that opens it and held while it stays open – once its own
 * L window is up, that window would otherwise be «the open surface». Null again if that surface
 * closes meanwhile, so the window falls back to being its own.
 */
export function useOpeningSurface(open: boolean, options?: { wideOnly?: boolean }): SurfaceHost | null {
  const current = useOpenSurface(options)
  const registered = useSyncExternalStore(subscribe, () => hosts, () => NO_HOSTS)
  const [latch, setLatch] = useState<{ open: boolean; host: SurfaceHost | null }>({ open: false, host: null })
  const opening = latch.open !== open
  if (opening) setLatch({ open, host: open ? current : null })
  const host = opening ? (open ? current : null) : latch.host
  return host && registered.includes(host) ? host : null
}

/**
 * One step inside a surface: the breadcrumb, «← Zurück» and the step's title over the step's
 * own body and footer (`children` – the caller lays them out, the frame is a flex column that
 * fills the surface). `onBack` is Zurück and Esc; the caller's Abbrechen calls the same.
 * Focus moves into the step (an `autoFocus` field inside wins, else Zurück) and back to where
 * it was on the surface when the step ends.
 *
 * `surface` makes the step a surface itself (the assignment step inside the Einsatz-Detail): a
 * picker opened from it becomes its step in turn, with the whole trail in the breadcrumb, and
 * Esc ends the innermost step first.
 */
export function SurfaceStep({
  host,
  title,
  description,
  onBack,
  children,
  testId,
  surface,
}: {
  host: SurfaceHost
  title: ReactNode
  description?: ReactNode
  onBack: () => void
  children: ReactNode
  testId?: string
  surface?: string
}) {
  const t = useTranslations('common.surfaceStep')
  const frameRef = useRef<HTMLDivElement>(null)
  const backRef = useRef<HTMLButtonElement>(null)
  const onBackRef = useRef(onBack)
  onBackRef.current = onBack
  // The surface's control that opened the step, read on the first render: by the layout
  // effect an `autoFocus` field inside the step has already taken the focus.
  const [returnTo] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null))
  const inner = useSurfaceStepHost(surface, { parent: host })
  const innerBackRef = useRef(inner.back)
  innerBackRef.current = inner.back

  useLayoutEffect(() => {
    const { slot } = host
    // The innermost step goes first: Esc on the window walks the trail back one crumb.
    stepBacks.set(slot, () => {
      if (!innerBackRef.current()) onBackRef.current()
    })
    // The surface's own children leave the Tab order and the accessibility tree meanwhile.
    const under = [...(slot.parentElement?.children ?? [])].filter(
      (el): el is HTMLElement => el !== slot && el instanceof HTMLElement && !el.inert,
    )
    under.forEach((el) => (el.inert = true))
    if (!frameRef.current?.contains(document.activeElement)) backRef.current?.focus({ preventScroll: true })
    return () => {
      stepBacks.delete(slot)
      under.forEach((el) => (el.inert = false))
      // After the commit, once the step's nodes are gone. Only if focus fell to nowhere –
      // a question the step opened keeps its focus.
      queueMicrotask(() => {
        const active = document.activeElement
        // Radix parks a lost focus on the surface's content element itself.
        const lost = !active || active === document.body || active === slot.parentElement || !active.isConnected
        if (lost && returnTo?.isConnected) returnTo.focus({ preventScroll: true })
      })
    }
  }, [host, returnTo])

  const fullDescription = typeof description === 'string' ? description : undefined

  return createPortal(
    <section
      ref={frameRef}
      data-testid={testId}
      data-surface-frame=""
      aria-label={typeof title === 'string' ? title : undefined}
      className="relative flex min-h-0 flex-1 flex-col"
    >
      <header className="shrink-0 px-5 pt-4 pb-3">
        <p className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
          {host.trail.map((crumb, i) => (
            <Fragment key={i}>
              <span className="min-w-0 truncate" title={crumb}>{crumb}</span>
              <ChevronRight className="size-3.5 shrink-0" aria-hidden />
            </Fragment>
          ))}
          <span className="min-w-0 truncate text-foreground">{title}</span>
        </p>
        <div className="mt-2 flex min-w-0 items-center gap-2">
          <Button ref={backRef} type="button" variant="outline" size="sm" onClick={() => onBackRef.current()} aria-keyshortcuts="Escape">
            <ArrowLeft aria-hidden />
            {t('back')}
          </Button>
          <h2 className="min-w-0 truncate text-lg leading-none font-semibold">{title}</h2>
        </div>
        {description && (
          // A phone has no hover to read a cut line by: there it wraps.
          <p className="mt-1.5 truncate text-sm text-muted-foreground max-md:whitespace-normal" title={fullDescription}>{description}</p>
        )}
      </header>
      {children}
      {inner.slot}
    </section>,
    host.slot,
  )
}

/** The «Esc zurück zu …» hint at the start of a step's footer row. */
export function SurfaceStepEscHint({ host }: { host: SurfaceHost }) {
  const t = useTranslations('common.surfaceStep')
  return (
    <span className="mr-auto hidden items-center gap-1.5 self-center text-xs text-muted-foreground sm:inline-flex">
      <Kbd>Esc</Kbd>
      {t('escBack', { surface: host.name })}
    </span>
  )
}
