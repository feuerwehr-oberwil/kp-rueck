"use client"

import { ProtectedRoute } from "@/components/protected-route"
import { PageNavigation } from "@/components/page-navigation"
import { MobileBottomNavigation } from "@/components/mobile-bottom-navigation"
import { TrainingBand } from "@/components/training-mode-chrome"
import { RegieIncidents } from "@/components/training/regie-incidents"
import { RegiePrepare } from "@/components/training/regie-prepare"
import { RegieProvider, useRegie } from "@/components/training/regie-provider"
import { RegieStoerung } from "@/components/training/regie-stoerung"
import { RegieSwitches } from "@/components/training/regie-switches"
import { PausedNote, RegieRunStrip, RegieTimeline } from "@/components/training/regie-timeline"
import { useEvent } from "@/lib/contexts/event-context"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { AlertCircle } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect } from "react"
import { useTranslations } from "next-intl"
import { LoadingStatus } from "@/components/ui/shell-loader"

/** The Regie's body once its state is in: two columns on a desk (xl), one on the phone. */
function RegieBody() {
  const t = useTranslations("training")
  const { state, failed, reload } = useRegie()

  if (!state) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-3 p-4">
        {failed ? (
          <>
            <p className="text-sm text-muted-foreground">{t("regie.loadFailed")}</p>
            <Button variant="outline" onClick={() => void reload().catch(() => {})}>
              {t("regie.retry")}
            </Button>
          </>
        ) : (
          <LoadingStatus size="surface" className="text-sm">{t("page.loading")}</LoadingStatus>
        )}
      </main>
    )
  }

  return (
    <>
      {/* Desktop (xl): left = run the drill (switches, timeline, Störung), right = the incidents
          and the preparation. Below xl one column in that order; the Störung button stands in
          the footer above the bottom nav, in flow, so it never covers the last row. */}
      <main className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6 md:p-8">
        {/* Clock + Pause stay in view while the page scrolls (sticky in this scroll container). */}
        <div className="mx-auto mb-4 max-w-2xl xl:mb-6 xl:max-w-7xl">
          <RegieRunStrip />
        </div>
        <div className="mx-auto flex max-w-2xl flex-col gap-4 xl:grid xl:max-w-7xl xl:grid-cols-2 xl:items-start xl:gap-6">
          <div className="flex min-w-0 flex-col gap-4">
            <RegieSwitches />
            <PausedNote />
            <RegieTimeline />
            <RegieStoerung className="hidden xl:flex" />
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            <RegieIncidents />
            <RegiePrepare />
          </div>
        </div>
      </main>
      <div className="shrink-0 border-t border-border/60 bg-background px-4 py-2 xl:hidden">
        <RegieStoerung />
      </div>
    </>
  )
}

/**
 * Übungs-Steuerung «Regie» (`/training`): the trainer runs the drill from here – from a
 * phone during the Übung, from a desk too. Only for a training Ereignis.
 */
export default function TrainingPage() {
  const t = useTranslations("training")
  const { selectedEvent, isEventLoaded } = useEvent()
  const router = useRouter()

  // Redirect if no event selected or not a training event
  useEffect(() => {
    if (isEventLoaded && !selectedEvent) {
      router.push('/events')
    }
  }, [isEventLoaded, selectedEvent, router])

  if (!selectedEvent) {
    return (
      <div className="flex h-full items-center justify-center bg-background text-foreground">
        <LoadingStatus size="surface" className="text-sm">{t("page.loading")}</LoadingStatus>
      </div>
    )
  }

  if (!selectedEvent.training_flag) {
    return (
      <ProtectedRoute>
        <div className="flex h-full flex-col bg-background text-foreground">
          <header className="flex items-center justify-between border-b border-border/50 bg-header px-6 py-2 min-h-14">
            <h1 className="text-2xl font-bold tracking-tight">{t("common.title")}</h1>
            <PageNavigation
              currentPage="training"
              hasSelectedEvent={!!selectedEvent}
            />
          </header>

          <main className="flex-1 flex items-center justify-center p-4 pb-nav-reserve md:pb-4">
            <Alert variant="destructive" className="max-w-md">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {t("page.notTraining")}
              </AlertDescription>
            </Alert>
          </main>

          <MobileBottomNavigation currentPage="training" />
        </div>
      </ProtectedRoute>
    )
  }

  return (
    <ProtectedRoute>
      <RegieProvider eventId={selectedEvent.id}>
        {/* The page ends at the bottom nav (its measured height), so the footer stands on it. */}
        <div className="flex h-full flex-col bg-background pb-[var(--nav-reserve,0px)] text-foreground">
          {/* Same warning strip as the board and the wall display: this console only ever
              opens on a training Ereignis, and it says so the same way. */}
          <TrainingBand />
          <header className="flex items-center justify-between gap-2 border-b border-border/50 bg-header px-4 sm:px-6 py-2 min-h-14">
            <h1 className="min-w-0 truncate text-xl font-bold tracking-tight sm:text-2xl">{t("common.title")}</h1>
            <PageNavigation
              currentPage="training"
              hasSelectedEvent={!!selectedEvent}
            />
          </header>
          <RegieBody />
          <MobileBottomNavigation currentPage="training" />
        </div>
      </RegieProvider>
    </ProtectedRoute>
  )
}
