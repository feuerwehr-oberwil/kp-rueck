'use client'

import { Suspense } from 'react'
import RekoForm from '@/components/reko/reko-form'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2 } from 'lucide-react'

export default function RekoPage() {
  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      <div className="max-w-2xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle>Rekognoszierungs-Formular</CardTitle>
            <CardDescription>
              Einsatzrelevante Informationen erfassen
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Suspense fallback={<RekoFormSkeleton />}>
              <RekoFormContent />
            </Suspense>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function RekoFormContent() {
  return <RekoForm />
}

function RekoFormSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    </div>
  )
}
