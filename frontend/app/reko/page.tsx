'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import RekoForm from '@/components/reko/reko-form'
import { Button } from '@/components/ui/button'
import { FeldIdentityBar, readFeldName } from '@/components/feld/feld-identity-bar'
import { Loader2, ArrowLeft } from 'lucide-react'

export default function RekoPage() {
  const router = useRouter()
  const t = useTranslations('reko.common')
  // Who is filing. Read from the cookie rather than the URL: the name belongs
  // to the device, and a URL gets pasted, shared and logged.
  const [name, setName] = useState<string | null>(null)
  useEffect(() => setName(readFeldName()), [])

  const handleBack = () => {
    if (window.history.length > 1) {
      router.back()
    } else {
      router.push('/')
    }
  }

  const back = (
    <Button variant="ghost" size="sm" onClick={handleBack} className="shrink-0 -ml-1">
      <ArrowLeft className="size-3.5" />
      {t('back')}
    </Button>
  )

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* A Reko auftrag opened from `/feld` navigates out of it, and the form
          used to arrive with nothing but a back button — a different app as far
          as the crew could tell. The same bar rides along when the device knows
          who it is; a Reko opened from the board's own link still gets the bare
          back button, because there nobody has named themselves. */}
      {name ? (
        <FeldIdentityBar name={name} subtitle={t('title')}>
          {back}
        </FeldIdentityBar>
      ) : null}

      <div className="max-w-md mx-auto px-4 pt-4">
        {!name && <div className="mb-4 -ml-3">{back}</div>}

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
