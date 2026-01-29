"use client"

import { Calendar, ChevronRight, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useRouter } from 'next/navigation'

export function EventSelectionEmptyState() {
  const router = useRouter()

  return (
    <div className="flex h-screen items-center justify-center bg-background p-4">
      <Card className="max-w-2xl w-full animate-fade-in-up">
        <CardContent className="p-8 md:p-12 text-center space-y-5">
          {/* Icon with gentle pulse */}
          <div className="flex justify-center">
            <div className="rounded-full bg-primary/10 p-5 animate-gentle-pulse">
              <Calendar className="h-14 w-14 text-primary" />
            </div>
          </div>

          {/* Heading with friendlier copy */}
          <div className="space-y-3">
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
              Noch kein Ereignis ausgewählt?
            </h1>
            <p className="text-base text-muted-foreground max-w-md mx-auto">
              Kein Problem! Erstellen Sie ein neues Ereignis oder wählen Sie ein
              bestehendes aus, um loszulegen.
            </p>
            <div className="flex items-center justify-center gap-2 text-sm text-primary/80">
              <Sparkles className="h-4 w-4" />
              <span>Bereit für Ihren ersten Einsatz</span>
            </div>
          </div>

          {/* Primary Actions with hover delight */}
          <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
            <Button
              size="lg"
              className="gap-2 min-h-[52px] hover-delight"
              onClick={() => router.push('/events?action=create')}
            >
              <Calendar className="h-5 w-5" />
              Neues Ereignis erstellen
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="gap-2 min-h-[52px] hover-delight"
              onClick={() => router.push('/events')}
            >
              Ereignisse anzeigen
              <ChevronRight className="h-5 w-5" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
