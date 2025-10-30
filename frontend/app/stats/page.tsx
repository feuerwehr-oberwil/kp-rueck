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
import { ArrowLeft, BarChart3, AlertCircle } from 'lucide-react'
import Link from 'next/link'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ProtectedRoute } from '@/components/protected-route'
import { PageNavigation } from '@/components/page-navigation'
import { Badge } from '@/components/ui/badge'

export default function StatsPage() {
  const { isAuthenticated, loading: authLoading } = useAuth()
  const { selectedEvent } = useEvent()
  const router = useRouter()

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login')
    }
  }, [authLoading, isAuthenticated, router])

  // Redirect to events page if no event is selected
  useEffect(() => {
    if (!authLoading && !selectedEvent) {
      router.push('/events')
    }
  }, [authLoading, selectedEvent, router])

  if (authLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-foreground">
        <div className="text-muted-foreground">Laden...</div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return null
  }

  return (
    <ProtectedRoute>
      <div className="flex h-screen flex-col bg-background text-foreground">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-border/50 bg-card/50 backdrop-blur-sm px-6 py-4">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-cyan-600 text-2xl shadow-lg">
                <BarChart3 className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight">Statistiken</h1>
                <p className="text-sm text-muted-foreground">
                  Echtzeit-Übersicht der Einsatzdaten
                  {selectedEvent && (
                    <>
                      {' für '}
                      <span className="font-medium">{selectedEvent.name}</span>
                      {selectedEvent.training_flag && (
                        <Badge variant="secondary" className="ml-2">Übung</Badge>
                      )}
                    </>
                  )}
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <PageNavigation currentPage="settings" />
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-auto p-6">
          {!selectedEvent ? (
            <div className="flex h-full items-center justify-center">
              <Alert className="max-w-md">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Bitte wählen Sie ein Event aus, um Statistiken anzuzeigen.
                </AlertDescription>
              </Alert>
            </div>
          ) : (
            <div className="max-w-7xl mx-auto">
              <StatsWidget eventId={selectedEvent.id} />
            </div>
          )}
        </main>
      </div>
    </ProtectedRoute>
  )
}
