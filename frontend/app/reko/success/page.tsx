'use client'

import { useSearchParams, useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { CheckCircle2, ArrowLeft } from 'lucide-react'

export default function RekoSuccessPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const incidentId = searchParams.get('id')
  const returnTo = searchParams.get('return_to')

  const handleGoBack = () => {
    // If we have a return URL (from reko-dashboard), use it
    if (returnTo) {
      router.push(decodeURIComponent(returnTo))
      return
    }

    // Fallback: go back in history or navigate to root
    if (window.history.length > 1) {
      router.back()
    } else {
      router.push('/')
    }
  }

  return (
    <div className="min-h-screen bg-background p-4 md:p-6 flex items-center justify-center">
      <Card className="max-w-md w-full">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-blue-100">
            <CheckCircle2 className="h-10 w-10 text-blue-600" />
          </div>
          <CardTitle>Meldung übermittelt</CardTitle>
          <CardDescription>
            Ihre Rekognoszierungs-Meldung wurde erfolgreich an die Einsatzleitung übermittelt.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-center text-sm text-muted-foreground">
            <p>Sie können dieses Fenster nun schliessen oder zur Übersicht zurückkehren.</p>
            {incidentId && (
              <p className="mt-2">
                Einsatz-ID: <code className="text-xs">{incidentId}</code>
              </p>
            )}
          </div>
          <Button
            onClick={handleGoBack}
            variant="outline"
            className="w-full"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Zurück zur Übersicht
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
