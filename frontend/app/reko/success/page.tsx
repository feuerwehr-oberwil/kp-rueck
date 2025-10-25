'use client'

import { useSearchParams } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { CheckCircle2 } from 'lucide-react'

export default function RekoSuccessPage() {
  const searchParams = useSearchParams()
  const incidentId = searchParams.get('id')

  return (
    <div className="min-h-screen bg-background p-4 md:p-6 flex items-center justify-center">
      <Card className="max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
            <CheckCircle2 className="h-10 w-10 text-green-600" />
          </div>
          <CardTitle>Meldung übermittelt</CardTitle>
          <CardDescription>
            Ihre Rekognoszierungs-Meldung wurde erfolgreich an die Einsatzleitung übermittelt.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center text-sm text-muted-foreground">
          <p>Sie können dieses Fenster nun schliessen.</p>
          {incidentId && (
            <p className="mt-2">
              Einsatz-ID: <code className="text-xs">{incidentId}</code>
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
