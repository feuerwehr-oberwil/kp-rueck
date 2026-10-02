'use client'

import { useEffect, useLayoutEffect, useState } from 'react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { SnailLoader } from '@/components/snail-loader'
import { topLoading } from '@/components/ui/top-loading-bar'

/** How long a start may run quietly before the screen admits something is wrong (KP
 *  Front's Splash uses the same 9 s). Past a few seconds «alive and starting» stops
 *  reassuring and becomes a dead end, so the screen names the likely cause and offers the
 *  one action that helps. The session probe itself gives up at 10 s (auth-client.ts);
 *  reaching this means the server, the connection or a stalled chunk is the problem. */
export const BOOT_STUCK_MS = 9_000

/**
 * The full-screen start: snail, «KP RÜCK», and the phase in words. No percentage — the
 * old bar crept up at random and stopped at 85 %, a number that measured nothing. The
 * snail and the phase say «alive and starting»; there is no artificial minimum wait.
 *
 * The stuck block is positioned below the card rather than in its flow, so the snail and
 * the wordmark do not jump when it appears (one geometry for the whole start, as in Front).
 * `restartHref` is for a screen where reloading cannot help (the Microsoft callback: its
 * single-use code is already gone from the URL) — there «Neu starten» starts the sign-in
 * over instead.
 */
export function BootScreen({ phase, restartHref }: { phase: string; restartHref?: string }) {
  const t = useTranslations('common.bootScreen')
  const [stuck, setStuck] = useState(false)

  // The snail IS the loading signal here: the route bar at the top stays hidden while this
  // screen is up (the session probe and the board's first loads would otherwise run it
  // above the snail). Layout effect, so it is hidden before the first paint; the bar works
  // as before once the screen is gone.
  useLayoutEffect(() => topLoading.suppress(), [])

  useEffect(() => {
    const timer = setTimeout(() => setStuck(true), BOOT_STUCK_MS)
    return () => clearTimeout(timer)
  }, [])

  const restart = () => {
    if (restartHref) window.location.assign(restartHref)
    else window.location.reload()
  }

  return (
    <div className="relative flex min-h-svh items-center justify-center bg-background p-4">
      <div className="relative flex flex-col items-center gap-[18px]">
        <SnailLoader className="dark:drop-shadow-[0_0_5px_rgb(255_240_207/0.12)]" />
        {/* The wordmark and the phase are one live region: a changed phase is read out. */}
        <div role="status" className="flex flex-col items-center gap-[18px] text-center">
          <div className="text-base font-bold uppercase tracking-[0.14em] text-foreground">KP Rück</div>
          <div className="min-h-[1.3em] text-[13px] text-muted-foreground">{phase}</div>
        </div>
        {stuck && (
          <div className="absolute top-full left-1/2 mt-3.5 flex w-max max-w-[30ch] -translate-x-1/2 flex-col items-center gap-2.5 border-t border-border pt-3.5 text-center">
            <div role="status" className="flex flex-col items-center gap-2.5">
              <p className="text-[13.5px] font-semibold text-foreground">{t('stuckTitle')}</p>
              <p className="text-[12.5px] leading-snug text-muted-foreground">{t('stuckHint')}</p>
            </div>
            <Button type="button" onClick={restart}>
              {t('restart')}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
