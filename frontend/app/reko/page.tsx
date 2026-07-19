'use client'

import { Suspense } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import RekoForm from '@/components/reko/reko-form'
import { Button } from '@/components/ui/button'
import { Loader2, ArrowLeft } from 'lucide-react'

export default function RekoPage() {
  const router = useRouter()
  const t = useTranslations('reko.common')

  const handleBack = () => {
    if (window.history.length > 1) {
      router.back()
    } else {
      router.push('/')
    }
  }

  return (
    <div className="min-h-screen bg-background px-4 pt-6 pb-24">
      <div className="max-w-md mx-auto">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleBack}
          className="mb-4 -ml-3"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          {t('back')}
        </Button>

        <Suspense fallback={<RekoFormSkeleton />}>
          <RekoFormContent />
        </Suspense>
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
