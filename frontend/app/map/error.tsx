'use client'

import { useEffect } from 'react'
import { MapPin, RefreshCw, Home } from 'lucide-react'
import { Button } from '@/components/ui/button'
import Link from 'next/link'

export default function MapError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Map error:', error)
  }, [error])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6 text-center">
        <div className="flex justify-center">
          <div className="rounded-full bg-destructive/10 p-4">
            <MapPin className="h-12 w-12 text-destructive" />
          </div>
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-foreground">
            Kartenfehler
          </h1>
          <p className="text-muted-foreground">
            Die Karte konnte nicht geladen werden. Dies kann an einem
            Netzwerkproblem oder fehlenden Kartendaten liegen.
          </p>
        </div>

        {process.env.NODE_ENV === 'development' && (
          <div className="rounded-lg bg-muted p-4 text-left">
            <p className="text-sm font-mono text-muted-foreground break-all">
              {error.message}
            </p>
          </div>
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Button onClick={reset} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Erneut versuchen
          </Button>
          <Button variant="outline" asChild>
            <Link href="/" className="gap-2">
              <Home className="h-4 w-4" />
              Zum Kanban
            </Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
