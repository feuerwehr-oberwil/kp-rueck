'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { usePathname } from 'next/navigation'
import { apiClient } from '@/lib/api-client'
import { useAuth } from '@/lib/contexts/auth-context'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Check, Info, Users } from 'lucide-react'

const DEMO_WELCOME_KEY = 'kp-rueck.demo-welcome.v1'
const WELCOME_EXCLUDED_ROUTES = ['/login', '/auth', '/reko', '/reko-dashboard', '/alarm', '/check-in']

interface DemoStatus {
  demo: boolean
  next_reset: string | null
  seconds_until_reset: number
  reset_interval_hours: number
}

export function DemoBanner() {
  const t = useTranslations('common.demoBanner')
  const pathname = usePathname()
  const { isAuthenticated, loading: authLoading } = useAuth()
  const [demoStatus, setDemoStatus] = useState<DemoStatus | null>(null)
  const [showWelcome, setShowWelcome] = useState(false)
  const [showResetOverlay, setShowResetOverlay] = useState(false)
  const secondsLeftRef = useRef(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const reloadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const welcomeDismissedRef = useRef(false)

  const fetchStatus = useCallback(async () => {
    const status = await apiClient.getDemoStatus()
    if (status) {
      setDemoStatus(status)
      secondsLeftRef.current = status.seconds_until_reset
    }
  }, [])

  // Initial fetch + periodic refresh
  useEffect(() => {
    fetchStatus()
    const statusInterval = setInterval(fetchStatus, 30000) // every 30s
    return () => clearInterval(statusInterval)
  }, [fetchStatus])

  // Client-side countdown
  useEffect(() => {
    if (!demoStatus) return

    intervalRef.current = setInterval(() => {
      if (secondsLeftRef.current <= 1) {
        if (intervalRef.current) clearInterval(intervalRef.current)
        secondsLeftRef.current = 0
        setShowResetOverlay(true)
        reloadTimeoutRef.current = setTimeout(() => window.location.reload(), 5000)
        return
      }
      secondsLeftRef.current -= 1
    }, 1000)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      if (reloadTimeoutRef.current) clearTimeout(reloadTimeoutRef.current)
    }
  }, [demoStatus])

  // Greet authenticated demo visitors once per browser, after they leave login.
  useEffect(() => {
    if (!demoStatus || authLoading || !isAuthenticated || welcomeDismissedRef.current) return
    if (WELCOME_EXCLUDED_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`))) return

    try {
      if (localStorage.getItem(DEMO_WELCOME_KEY) !== '1') setShowWelcome(true)
    } catch {
      setShowWelcome(true)
    }
  }, [authLoading, demoStatus, isAuthenticated, pathname])

  const closeWelcome = () => {
    welcomeDismissedRef.current = true
    try {
      localStorage.setItem(DEMO_WELCOME_KEY, '1')
    } catch {
      // Storage can be unavailable in private browsing; closing still works for this mount.
    }
    setShowWelcome(false)
  }

  // Don't render if not in demo mode
  if (!demoStatus) return null

  // Reset overlay
  if (showResetOverlay) {
    return (
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-background/90 backdrop-blur-sm">
        <div className="text-center space-y-4">
          <div className="animate-spin h-8 w-8 border-4 border-amber-500 border-t-transparent rounded-full mx-auto" />
          <h2 className="text-xl font-semibold text-foreground">{t('resettingTitle')}</h2>
          <p className="text-muted-foreground text-sm">{t('resettingDescription')}</p>
        </div>
      </div>
    )
  }

  return (
    <>
      <div
        className="pointer-events-none fixed top-[calc(15px+env(safe-area-inset-top))] -left-9 z-[150] w-[132px] -rotate-45 bg-amber-500 py-[3px] text-center text-[11px] font-extrabold tracking-[2px] text-amber-950 shadow-[0_1px_5px_rgba(20,28,40,0.35)]"
        role="note"
        aria-label={t('ariaLabel')}
      >
        {t('ribbon')}
      </div>

      <Dialog open={showWelcome} onOpenChange={(open) => { if (!open) closeWelcome() }}>
        <DialogContent
          className="z-[160] max-h-[88dvh] overflow-y-auto sm:max-w-md"
          overlayClassName="z-[160]"
        >
          <DialogHeader className="pr-8">
            <div className="flex items-center gap-3">
              <span className="rounded-full bg-amber-500 px-2.5 py-1 text-[10px] font-extrabold tracking-[1.5px] text-amber-950">
                {t('ribbon')}
              </span>
              <DialogTitle>{t('welcome.title')}</DialogTitle>
            </div>
            <DialogDescription className="pt-2 text-left leading-relaxed">
              {t('welcome.intro')}
            </DialogDescription>
          </DialogHeader>

          <div className="flex gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4" role="note">
            <Users className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
            <div className="space-y-1.5">
              <h3 className="text-sm font-semibold">{t('welcome.sharedTitle')}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{t('welcome.sharedDescription')}</p>
              <p className="text-sm font-medium leading-relaxed">{t('welcome.resetDescription')}</p>
            </div>
          </div>

          <section className="space-y-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Check className="h-4 w-4 text-emerald-500" />
              {t('welcome.canTitle')}
            </h3>
            <ul className="space-y-1.5 pl-6 text-sm leading-relaxed text-muted-foreground">
              <li className="list-disc">{t('welcome.canIncidents')}</li>
              <li className="list-disc">{t('welcome.canResources')}</li>
              <li className="list-disc">{t('welcome.canMap')}</li>
              <li className="list-disc">{t('welcome.canWorkflows')}</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Info className="h-4 w-4 text-muted-foreground" />
              {t('welcome.knowTitle')}
            </h3>
            <p className="pl-6 text-sm leading-relaxed text-muted-foreground">{t('welcome.knowDescription')}</p>
          </section>

          <DialogFooter>
            <Button className="w-full" onClick={closeWelcome}>{t('welcome.cta')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
