"use client"

import Link from "next/link"
import { useEffect } from "react"
import { useTranslations } from "next-intl"
import { ArrowLeft, Check, LogOut, Map, LayoutGrid, BarChart3, type LucideIcon } from "lucide-react"

import { useEvent } from "@/lib/contexts/event-context"
import { useAuth } from "@/lib/contexts/auth-context"
import { cn } from "@/lib/utils"

/**
 * The display overview — the only place under `/display/*` that is a control
 * panel rather than a wall.
 *
 * It carries the **event picker**, and deliberately not the wall pages
 * themselves. A display is read-only, runs unattended and is operated maybe
 * twice a year; a control that switches which Ereignis a whole room is looking
 * at must not sit one stray click away on the board. Here it is two deliberate
 * steps from every wall page (← in the header, then the event), which is the
 * right price for something this consequential.
 *
 * Before this existed, `EventProvider` only ever restored a selection from
 * localStorage and `/events` bounces a viewer — so a kiosk on a fresh profile
 * showed empty columns with no path out of them at all.
 *
 * Logout lives here for the same reason: a wall screen needs a way to hand the
 * machine back, and the header of a screen nobody stands at is not the place
 * for it.
 */
export default function DisplayIndexPage() {
  const t = useTranslations('display.layout')
  const te = useTranslations('events.page')
  const tn = useTranslations('nav.userMenu')
  const { selectedEvent, setSelectedEvent, events, refreshEvents } = useEvent()
  const { isAuthenticated, logout } = useAuth()

  // The provider loads the list once on mount; a kiosk that has been up for
  // days is the case this page exists for, so re-read it on arrival.
  useEffect(() => {
    if (isAuthenticated) void refreshEvents()
  }, [isAuthenticated, refreshEvents])

  // Archived events are finished work — nothing a wall should be showing.
  const openEvents = events.filter((event) => event.archived_at === null)

  return (
    // `m-auto` rather than `justify-center`: a centred flex child that outgrows
    // its container gets clipped at the TOP, where the scrollbar cannot reach it
    // — and a station with a long list of Ereignisse is exactly the case this
    // page exists for.
    <div className="flex h-full overflow-y-auto p-6">
      <div className="m-auto flex w-full flex-col items-center gap-8">
        <nav className="flex gap-3">
          <DisplayLink href="/display/map" label={t('pageMap')} icon={Map} />
          <DisplayLink href="/display/board" label={t('pageBoard')} icon={LayoutGrid} />
          <DisplayLink href="/display/status" label={t('pageStatus')} icon={BarChart3} />
        </nav>

        {isAuthenticated && (
          <section className="w-full max-w-md space-y-2">
            <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {te('title')}
            </h2>
            {openEvents.length === 0 ? (
              <p className="rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
                {te('emptyNone')}
              </p>
            ) : (
              <ul className="space-y-1.5">
                {openEvents.map((event) => {
                  const isSelected = selectedEvent?.id === event.id
                  return (
                    <li key={event.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedEvent(event)}
                        aria-current={isSelected ? "true" : undefined}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-lg border px-4 py-3 text-left transition-colors",
                          isSelected
                            ? "border-primary bg-primary/10"
                            : "border-border bg-card hover:bg-muted",
                        )}
                      >
                        <Check
                          className={cn("h-4 w-4 shrink-0 text-primary", !isSelected && "invisible")}
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{event.name}</span>
                        {event.training_flag && (
                          <span className="shrink-0 rounded border border-warning/20 bg-warning/10 px-1.5 py-0.5 text-xs font-medium text-warning-foreground">
                            {t('training')}
                          </span>
                        )}
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                          {te('incidentCount', { count: event.incident_count })}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        )}

        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {t('backToEditor')}
          </Link>
          {isAuthenticated && (
            <button
              type="button"
              onClick={() => void logout()}
              className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-destructive"
            >
              <LogOut className="h-3.5 w-3.5" />
              {tn('logout')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function DisplayLink({ href, label, icon: Icon }: {
  href: string
  label: string
  icon: LucideIcon
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2 rounded-lg border border-border bg-card px-6 py-3 text-sm font-medium transition-colors hover:bg-muted"
    >
      <Icon className="h-4 w-4 text-muted-foreground" />
      {label}
    </Link>
  )
}
