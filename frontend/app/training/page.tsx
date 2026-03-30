"use client"

import { ProtectedRoute } from "@/components/protected-route"
import { PageNavigation } from "@/components/page-navigation"
import { MobileBottomNavigation } from "@/components/mobile-bottom-navigation"
import { TrainingControls } from "@/components/training-controls"
import { TrainingSimulationControls } from "@/components/training-simulation-controls"
import { useEvent } from "@/lib/contexts/event-context"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AlertCircle } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect } from "react"
import { useGlobalNavigation } from "@/lib/hooks/use-global-navigation"

export default function TrainingPage() {
  useGlobalNavigation()
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
        <div className="text-muted-foreground">Laden...</div>
      </div>
    )
  }

  if (!selectedEvent.training_flag) {
    return (
      <ProtectedRoute>
        <div className="flex h-full flex-col bg-background text-foreground">
          <header className="flex items-center justify-between border-b border-border/50 bg-card/50 backdrop-blur-sm px-6 py-2 min-h-14">
            <h1 className="text-2xl font-bold tracking-tight">Übungs-Steuerung</h1>
            <PageNavigation
              currentPage="training"
              hasSelectedEvent={!!selectedEvent}
            />
          </header>

          <main className="flex-1 flex items-center justify-center p-4 pb-20 md:pb-4">
            <Alert variant="destructive" className="max-w-md">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Die Übungs-Steuerung ist nur für Trainingsereignisse verfügbar.
                Das aktuelle Ereignis ist kein Training.
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
        <header className="flex items-center justify-between border-b border-border/50 bg-card/50 backdrop-blur-sm px-4 sm:px-6 py-2 min-h-14">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Übungs-Steuerung</h1>
          <PageNavigation
            currentPage="training"
            hasSelectedEvent={!!selectedEvent}
          />
        </header>

        <main className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-8 pb-20 md:pb-8">
          <div className="max-w-4xl mx-auto">
            <TrainingControls />
            <TrainingSimulationControls />
          </div>
        </main>

        <MobileBottomNavigation currentPage="training" />
      </div>
    </ProtectedRoute>
  )
}
