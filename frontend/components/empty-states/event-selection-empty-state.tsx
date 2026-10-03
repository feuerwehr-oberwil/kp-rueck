"use client"

import { Calendar, ChevronRight } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useRouter } from 'next/navigation'

export function EventSelectionEmptyState() {
  const t = useTranslations('events')
  const router = useRouter()

  return (
    // `min-h-full` of the shell's <main>, never `h-screen`: the shell is `h-dvh`, and on iOS
    // Safari 100vh is the LARGE viewport (toolbar collapsed) — taller than the dvh <main> it sits
    // in while the toolbar shows, so a screen that fits scrolled by the difference (owner,
    // iPhone, 02.10.2026). `min-` so a short landscape phone can still scroll to the buttons.
    <div className="flex min-h-full items-center justify-center bg-background p-4">
      <Card className="max-w-2xl w-full animate-fade-in-up">
        <CardContent className="p-6 md:p-12 text-center space-y-5">
          {/* A neutral tile, standing still: red means priority and danger here, and a pulse
              says «something is happening» — neither is true of an empty start screen. */}
          <div className="flex justify-center">
            <div className="rounded-full bg-muted p-4 md:p-5">
              <Calendar className="h-10 w-10 md:h-14 md:w-14 text-muted-foreground" aria-hidden="true" />
            </div>
          </div>

          <div className="space-y-3">
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
              {t('emptyState.title')}
            </h1>
            <p className="text-base text-muted-foreground max-w-md mx-auto">
              {t('emptyState.description')}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
            <Button
              size="lg"
              className="min-h-[52px] hover-delight"
              onClick={() => router.push('/events?action=create')}
            >
              <Calendar className="size-4" />
              {t('emptyState.createButton')}
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="min-h-[52px] hover-delight"
              onClick={() => router.push('/events')}
            >
              {t('emptyState.viewButton')}
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
