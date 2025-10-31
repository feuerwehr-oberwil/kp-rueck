'use client'

import { useSearchParams, useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { CheckCircle2, ArrowLeft } from 'lucide-react'

export default function RekoSuccessPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const incidentId = searchParams.get('id')
  const token = searchParams.get('token')

  const handleGoBack = () => {
    if (incidentId && token) {
      router.push(`/reko?incident_id=${incidentId}&token=${token}`)
    } else {
      router.back()
    }
  }

  return (
    <div className="min-h-screen bg-background p-4 md:p-6 flex items-center justify-center">
      <Card className="max-w-md w-full">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
            <CheckCircle2 className="h-10 w-10 text-green-600" />
          </div>
          <CardTitle>Meldung übermittelt</CardTitle>
          <CardDescription>
            Ihre Rekognoszierungs-Meldung wurde erfolgreich an die Einsatzleitung übermittelt.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-center text-sm text-muted-foreground">
            <p>Sie können dieses Fenster nun schliessen oder zum Formular zurückkehren.</p>
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
            Zurück zum Formular
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
