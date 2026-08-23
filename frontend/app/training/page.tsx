"use client"

import { ProtectedRoute } from "@/components/protected-route"
import { PageNavigation } from "@/components/page-navigation"
import { MobileBottomNavigation } from "@/components/mobile-bottom-navigation"
import { TrainingControls } from "@/components/training-controls"
import { TrainingCheckinCard } from "@/components/training-checkin-card"
import { TrainingSimulationControls } from "@/components/training-simulation-controls"
import { TrainingGpsSimulation } from "@/components/training-gps-simulation"
import { TrainingBand } from "@/components/training-mode-chrome"
import { useEvent } from "@/lib/contexts/event-context"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AlertCircle } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect } from "react"
import { useTranslations } from "next-intl"
import { useGlobalNavigation } from "@/lib/hooks/use-global-navigation"

export default function TrainingPage() {
  useGlobalNavigation()
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
        <div className="text-muted-foreground">{t("page.loading")}</div>
      </div>
    )
  }

  if (!selectedEvent.training_flag) {
    return (
      <ProtectedRoute>
        <div className="flex h-full flex-col bg-background text-foreground">
          <header className="flex items-center justify-between border-b border-border/50 bg-card/50 backdrop-blur-sm px-6 py-2 min-h-14">
            <h1 className="text-2xl font-bold tracking-tight">{t("common.title")}</h1>
            <PageNavigation
              currentPage="training"
              hasSelectedEvent={!!selectedEvent}
            />
          </header>

          <main className="flex-1 flex items-center justify-center p-4 pb-20 md:pb-4">
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
      <div className="flex h-full flex-col bg-background text-foreground">
        {/* Same warning strip as the board and the wall display — this console
            only ever opens on a training Ereignis, and it says so the same way.
            Fixed and out of flow, like everywhere else, so the four surfaces
            cannot drift apart by 3px. */}
        <TrainingBand />
        <header className="flex items-center justify-between border-b border-border/50 bg-card/50 backdrop-blur-sm px-4 sm:px-6 py-2 min-h-14">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">{t("common.title")}</h1>
          <PageNavigation
            currentPage="training"
            hasSelectedEvent={!!selectedEvent}
          />
        </header>

        <main className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-8 pb-20 md:pb-8">
          {/* Desktop (xl+): two columns so the whole console fits with minimal
              scrolling — left is "prepare the exercise" (generation incl.
              Automatik + Personal einchecken), right is "run the field"
              (Nächste Aktionen + GPS drives), the pair a trainer actually works
              during a drill. Below xl everything stacks. */}
          <div className="mx-auto max-w-4xl xl:max-w-7xl">
            <div className="flex flex-col gap-4 xl:grid xl:grid-cols-2 xl:items-start xl:gap-6">
              <div className="flex flex-col gap-4">
                <TrainingControls />
                <TrainingCheckinCard />
              </div>
              <div className="flex flex-col gap-4">
                <TrainingSimulationControls />
                <TrainingGpsSimulation />
              </div>
            </div>
          </div>
        </main>

        <MobileBottomNavigation currentPage="training" />
      </div>
    </ProtectedRoute>
  )
}
