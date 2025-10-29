'use client'

/**
 * Stats Dashboard Page
 * Displays event statistics and metrics
 */

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/contexts/auth-context'
import { useEvent } from '@/lib/contexts/event-context'
import { StatsWidget } from '@/components/stats-widget'
import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { Alert, AlertDescription } from '@/components/ui/alert'

export default function StatsPage() {
  const { isAuthenticated, loading: authLoading } = useAuth()
  const { selectedEvent, isEventLoaded } = useEvent()
  const router = useRouter()

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login')
    }
  }, [authLoading, isAuthenticated, router])

  if (authLoading || !isEventLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Laden...</p>
      </div>
    )
  }

  if (!isAuthenticated) {
    return null
  }

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h1 className="text-3xl font-bold tracking-tight">Statistiken</h1>
            <p className="text-muted-foreground">
              Echtzeit-Übersicht der Einsatzdaten
              {selectedEvent && ` für ${selectedEvent.name}`}
            </p>
          </div>
          <Button asChild variant="outline">
            <Link href="/">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Zurück
            </Link>
          </Button>
        </div>

        {!selectedEvent ? (
          <Alert>
            <AlertDescription>
              Bitte wählen Sie ein Event aus, um Statistiken anzuzeigen.
            </AlertDescription>
          </Alert>
        ) : (
          <StatsWidget eventId={selectedEvent.id} />
        )}
      </div>
    </div>
  )
}
