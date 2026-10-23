'use client'

/**
 * The door of `/feld` (plan 26): the Feld-Code screen and the device token it earns.
 *
 * `useFeldDoor` holds the token this device uses, the four digits, why the door
 * said no, the proof of place and the lockout countdown, and talks to the unlock
 * and logout endpoints. The page keeps who and where (person, Schadenplätze,
 * view mode) and renders what the door yields: `codeScreen` while it is at the
 * door, `notMeDialog` on the assignments view, `askNotMe` behind «Nicht ich».
 *
 *   const { deviceToken, admit, refuse, forget, askNotMe, codeScreen, notMeDialog } =
 *     useFeldDoor({ linkToken, atDoor: viewMode === 'code', onUnlocked, onForget })
 */

import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import {
  apiClient,
  FeldUnlockError,
  type FeldUnlockFailure,
  type ApiFeldContextResponse,
  type ApiFeldUnlockResponse,
} from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { ShellLoader } from '@/components/ui/shell-loader'
import { clearCookie, readCookie, writeCookie } from '@/lib/cookie'
import { decodeFeldCredential } from '@/lib/feld-assignment'

/** Where every `/feld` cookie lives: path-scoped to `/feld`, seven days — the
 *  page's person and Schadenplatz memory and the device token below. (The name
 *  cookie in `feld-identity-bar` is the one on `/`.) */
export const FELD_COOKIE_SCOPE = { path: '/feld', days: 7 }

/** The device's own token, earned by entering the Feld-Code and naming yourself
 *  (plan 26, decisions 13 and 18). From here on this is the credential the page
 *  uses — the token in the URL is spent and never sent again. Storing it is what
 *  stops the crew re-typing the code every time the tab is dropped. */
const TOKEN_COOKIE = 'feld-device-token'

/** The token a device stored when it last went through the door, if any. */
export function readDeviceToken(): string | null {
  return readCookie(TOKEN_COOKIE)
}

/** A lockout countdown as «4:12» — minutes and seconds, because "noch 252
 *  Sekunden" is a number nobody converts while standing in the rain. */
function formatCountdown(seconds: number): string {
  const safe = Math.max(0, Math.ceil(seconds))
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`
}

export function useFeldDoor({
  linkToken,
  atDoor,
  onUnlocked,
  onForget,
}: {
  /** The token from the URL: the poster's, the slip's, or a person-bound link. */
  linkToken: string | null
  /** Whether the page shows the door now — the proof of place and the
   *  auto-submit only run there. */
  atDoor: boolean
  /** The code was right; the unlock brings the picker. Keep it stable. */
  onUnlocked: (unlock: ApiFeldUnlockResponse) => void
  /** `forget` was called: drop what the page holds about person and place. Keep it stable. */
  onForget: () => void
}) {
  const t = useTranslations('feld')
  /**
   * The token this device actually uses.
   *
   * Starts as null and becomes, in turn, the unlocked token (the code was
   * right) and then the bound one (a person was named). The link token from the
   * URL is never used again after the exchange — that is the whole point of
   * decision 13: holding the link stops being enough.
   */
  const [deviceToken, setDeviceToken] = useState<string | null>(null)
  const [codeInput, setCodeInput] = useState('')
  /**
   * WHY the code screen said no — four causes, four different things to do.
   *
   * It used to be a boolean, so «Falscher Code» was also the answer to a
   * lockout somebody else's typing had earned, to a poster that expired three
   * weeks ago, and to a cellar with no reception. Three of those are not fixed
   * by typing more carefully, and the screen said nothing else.
   */
  const [codeError, setCodeError] = useState<FeldUnlockFailure | null>(null)
  /** The door's proof of place (station + Ereignis), fetched with the LINK
   *  token before the code. Null while loading or when the fetch failed — the
   *  door renders without the proof rather than blocking on it. */
  const [doorContext, setDoorContext] = useState<ApiFeldContextResponse | null>(null)
  /** Whether the (invisible) code input owns the focus — drives the active
   *  cell's ring in the four-box rendering. */
  const [codeFocused, setCodeFocused] = useState(false)
  const codeInputRef = useRef<HTMLInputElement>(null)
  /** Seconds left on a lockout, counted down locally so «4:12» actually moves. */
  const [lockRemaining, setLockRemaining] = useState(0)
  const [unlocking, setUnlocking] = useState(false)
  // "Nicht ich" is not just a name change any more: it throws away the device's
  // bound token, so the next person types the code. Worth asking first — on a
  // wet phone it sits one thumb-width from the rest of the header.
  const [confirmNotMe, setConfirmNotMe] = useState(false)

  /** Let this device in with `token`; `remember` stores it for the next visit. */
  const admit = useCallback((token: string, options?: { remember?: boolean }) => {
    setDeviceToken(token)
    if (options?.remember) writeCookie(TOKEN_COOKIE, token, FELD_COOKIE_SCOPE)
  }, [])

  /** Keep the door shut and say why (an expired link, a refused session unlock). */
  const refuse = useCallback((failure: FeldUnlockFailure | null) => {
    setCodeError(failure)
  }, [])

  /**
   * Back to the door: forget the device token, the person and the place.
   *
   * Two callers, and they are the same event from opposite ends — the crew
   * handing the phone on ("nicht ich"), and the KP logging every device out
   * from the board. A poster can start a new code exchange; a bound link or
   * one-use picker credential cannot, so those require a fresh QR/link.
   */
  const forget = useCallback(() => {
    setDeviceToken(null)
    setCodeInput('')
    setCodeError(linkToken && decodeFeldCredential(linkToken) ? { kind: 'expired' } : null)
    clearCookie(TOKEN_COOKIE, FELD_COOKIE_SCOPE)
    onForget()
  }, [linkToken, onForget])

  /**
   * Step 2 of the door: trade the link token plus the four digits for an
   * unlocked one, and get the picker back in the same response.
   *
   * Every failure is named (`FeldUnlockFailure`), because the four of them ask
   * for four different moves. Only the wrong-code case clears the field: after
   * a lockout or a dropped connection the digits are probably right, and making
   * somebody type them again in the rain to find that out is a punishment for
   * the network's mistake.
   */
  const submitCode = useCallback(async () => {
    if (!linkToken || codeInput.length < 4 || unlocking) return
    setUnlocking(true)
    setCodeError(null)
    try {
      const data = await apiClient.unlockFeld(linkToken, codeInput)
      setDeviceToken(data.token)
      onUnlocked(data)
      setCodeInput('')
    } catch (err) {
      console.error('Feld unlock failed:', err)
      const failure: FeldUnlockFailure =
        err instanceof FeldUnlockError ? err.failure : { kind: 'wrong', attemptsLeft: null }
      setCodeError(failure)
      if (failure.kind === 'locked') setLockRemaining(failure.retryAfterSeconds)
      if (failure.kind === 'wrong') setCodeInput('')
    } finally {
      setUnlocking(false)
    }
  }, [linkToken, codeInput, unlocking, onUnlocked])

  // The proof of place, as soon as the door is on screen: station + Ereignis
  // above the digits, so the person in the rain knows they reached the right
  // brigade before typing anything.
  useEffect(() => {
    if (!atDoor || !linkToken || doorContext) return
    let alive = true
    apiClient.getFeldContext(linkToken).then((ctx) => {
      if (alive && ctx) setDoorContext(ctx)
    })
    return () => {
      alive = false
    }
  }, [atDoor, linkToken, doorContext])

  // The fourth digit submits by itself — no button that can look dead. Only in
  // the clean state: after a lockout or a dropped connection the digits stay
  // put and the retry is a deliberate tap (see the offline block below).
  useEffect(() => {
    if (atDoor && codeInput.length === 4 && !unlocking && !codeError) {
      submitCode()
    }
  }, [atDoor, codeInput, unlocking, codeError, submitCode])

  // The lockout counts itself down and lets go on its own: a screen that says
  // «Wieder frei in 0:00» and stays dead is the same dead end one line later.
  useEffect(() => {
    if (codeError?.kind !== 'locked') return
    if (lockRemaining <= 0) {
      setCodeError(null)
      return
    }
    const timer = setTimeout(() => setLockRemaining(seconds => seconds - 1), 1000)
    return () => clearTimeout(timer)
  }, [codeError, lockRemaining])

  /** Revoke on the server first; a lost connection must not leave a silently live credential. */
  const handleNotMe = async () => {
    if (!deviceToken) return
    try {
      await apiClient.logoutFeld(deviceToken)
      forget()
    } catch {
      toast.error(t('access.failed'))
    }
  }

  return {
    deviceToken,
    admit,
    refuse,
    forget,
    /** «Nicht ich» — opens `notMeDialog`. */
    askNotMe: () => setConfirmNotMe(true),
    codeScreen: (
      <FeldCodeScreen
        codeError={codeError}
        setCodeError={setCodeError}
        codeInput={codeInput}
        setCodeInput={setCodeInput}
        codeInputRef={codeInputRef}
        codeFocused={codeFocused}
        setCodeFocused={setCodeFocused}
        doorContext={doorContext}
        lockRemaining={lockRemaining}
        unlocking={unlocking}
        submitCode={submitCode}
      />
    ),
    notMeDialog: (
      <ConfirmDialog
        open={confirmNotMe}
        onOpenChange={setConfirmNotMe}
        title={t('assignments.notMeTitle')}
        description={t('assignments.notMeDescription')}
        confirmText={t('assignments.notMeConfirm')}
        onConfirm={handleNotMe}
      />
    ),
  }
}

/**
 * The code screen, drawn from `useFeldDoor`'s state — the page renders it as
 * `codeScreen` and never builds one itself.
 *
 * Four boxes and one button. No explanation of where the code lives while
 * nothing has gone wrong: whoever is standing here scanned the poster it is
 * printed under two seconds ago, and the one screen somebody reads in the
 * rain is not the place for a paragraph. What appears when it DOES go wrong
 * is the whole point of this block — each of the four failures says what
 * happened and what to do about it.
 */
function FeldCodeScreen({
  codeError,
  setCodeError,
  codeInput,
  setCodeInput,
  codeInputRef,
  codeFocused,
  setCodeFocused,
  doorContext,
  lockRemaining,
  unlocking,
  submitCode,
}: {
  codeError: FeldUnlockFailure | null
  setCodeError: Dispatch<SetStateAction<FeldUnlockFailure | null>>
  codeInput: string
  setCodeInput: Dispatch<SetStateAction<string>>
  codeInputRef: RefObject<HTMLInputElement | null>
  codeFocused: boolean
  setCodeFocused: Dispatch<SetStateAction<boolean>>
  doorContext: ApiFeldContextResponse | null
  lockRemaining: number
  unlocking: boolean
  submitCode: () => void
}) {
  const t = useTranslations('feld')
  // An expired link is its own screen: no field, no button. The four digits
  // cannot fix a token that ran out, so asking for them again is the one
  // thing this page must stop doing.
  // Same for an address that is not the poster's link (`reopen`): scan again.
  if (codeError?.kind === 'expired' || codeError?.kind === 'reopen') {
    const reopen = codeError.kind === 'reopen'
    return (
      <div className="min-h-screen bg-background flex flex-col justify-center p-6">
        <div className="mx-auto w-full max-w-xs">
          <h1 className="mb-6 text-center text-2xl font-semibold">
            {t(reopen ? 'code.reopenTitle' : 'code.expiredTitle')}
          </h1>
          <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning-foreground">
            <p className="font-medium">{t(reopen ? 'code.reopenHeading' : 'code.expiredHeading')}</p>
            <p className="mt-0.5">{t(reopen ? 'code.reopenBody' : 'code.expiredBody')}</p>
          </div>
          <p className="mt-3 rounded-lg border border-border bg-card px-3 py-2.5 text-xs text-muted-foreground">
            {t('code.expiredFoot')}
          </p>
        </div>
      </div>
    )
  }

  const locked = codeError?.kind === 'locked'
  const countdown = formatCountdown(lockRemaining)
  return (
    <div className="min-h-screen bg-background flex flex-col justify-center p-6">
      <div className="mx-auto w-full max-w-xs">
        {/* The proof of place: station and Ereignis, fetched with the link
            token before any digit. Whoever scanned a poster must see they
            reached the right brigade — the heading falls back to the bare
            prompt only while the proof has not arrived. */}
        <div className="mb-8">
          {doorContext?.station_name && (
            <p className="text-[13px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              {doorContext.station_name}
            </p>
          )}
          <h1 id="feld-code-title" className="mt-1 text-3xl font-semibold">
            {doorContext?.event_name ?? t('code.title')}
          </h1>
          {doorContext?.training_flag && (
            <span className="mt-2 inline-flex items-center rounded border border-warning/40 bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning-foreground">
              {t('code.training')}
            </span>
          )}
        </div>

        {/* Four cells over ONE invisible input: the input keeps the number
            pad, paste and the accessible name; the cells are the rendering.
            Labelled BY the heading — one accessible name, not two. */}
        <div className="relative" onClick={() => codeInputRef.current?.focus()}>
          <input
            id="feld-code"
            ref={codeInputRef}
            aria-labelledby="feld-code-title"
            // A phone must open the number pad for this, and a browser must
            // not offer to remember it like a password.
            inputMode="numeric"
            autoComplete="off"
            pattern="[0-9]*"
            maxLength={4}
            value={codeInput}
            autoFocus
            disabled={locked}
            onFocus={() => setCodeFocused(true)}
            onBlur={() => setCodeFocused(false)}
            onChange={event => {
              setCodeInput(event.target.value.replace(/\D/g, '').slice(0, 4))
              // Typing clears a verdict about the digits, not one about the
              // network or the lockout — those are still true.
              setCodeError(current => (current?.kind === 'wrong' ? null : current))
            }}
            onKeyDown={event => {
              if (event.key === 'Enter') submitCode()
            }}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
          <div aria-hidden className="pointer-events-none flex justify-between gap-3">
            {[0, 1, 2, 3].map(index => (
              <div
                key={index}
                className={`flex h-20 flex-1 items-center justify-center rounded-xl border-2 bg-muted text-4xl font-semibold tabular-nums transition-colors ${
                  codeError?.kind === 'wrong'
                    ? 'border-destructive'
                    : codeFocused && Math.min(codeInput.length, 3) === index && !locked
                      ? 'border-ring ring-2 ring-ring/25'
                      : 'border-border'
                } ${locked ? 'opacity-60' : ''}`}
              >
                {unlocking && index === 3 && codeInput.length === 4 ? (
                  <ShellLoader className="size-6 text-muted-foreground" />
                ) : (
                  codeInput[index] ?? ''
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Always visible, not withheld until a failure: the reasoning that a
            scanner "just saw the poster" does not survive a gloved hand and a
            borrowed phone. */}
        <p className="mt-4 text-sm text-muted-foreground">{t('code.whereHint')}</p>

        {/* Wrong: the only failure the typing can fix — so it is also the only
            one that says where the code is written. Since the slip carries it
            (see `links-qr-sheet`), that sentence is now true. */}
        {codeError?.kind === 'wrong' && (
          <div className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-foreground">
            <p className="font-medium text-destructive">{t('code.wrong')}</p>
            {codeError.attemptsLeft !== null && (
              <p className="mt-0.5">{t('code.attemptsLeft', { count: codeError.attemptsLeft })}</p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">{t('code.whereHint')}</p>
          </div>
        )}

        {/* Locked: the one message where the crew's own typing may not be to
            blame at all — the station NATs every phone behind one address. */}
        {locked && (
          <div className="mt-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning-foreground">
            <p className="font-medium">{t('code.lockedTitle', { time: countdown })}</p>
            <p className="mt-0.5">{t('code.lockedBody')}</p>
          </div>
        )}

        {/* Offline: nothing was checked, so nothing is known about the code. */}
        {codeError?.kind === 'offline' && (
          <div className="mt-3 rounded-lg border border-info/40 bg-info/10 p-3 text-sm text-foreground">
            <p className="font-medium">{t('code.offlineTitle')}</p>
            <p className="mt-0.5">{t('code.offlineBody')}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t('code.offlineHint')}</p>
          </div>
        )}

        {/* No standing submit button: the fourth digit submits by itself, so
            the happy path never shows a control that could look dead. The one
            deliberate tap left is the offline retry — the digits are kept and
            probably right, so retrying must not mean retyping. */}
        {codeError?.kind === 'offline' && (
          <Button
            size="lg"
            className="mt-6 w-full"
            disabled={codeInput.length < 4 || unlocking}
            onClick={submitCode}
          >
            {t('code.retry')}
          </Button>
        )}
      </div>
    </div>
  )
}
