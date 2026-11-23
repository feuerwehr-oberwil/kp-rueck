'use client'

/**
 * The incident's photos in the app, full screen (owner pick 23.11.2026, #5 → mock 5A + its
 * phone form). Photos used to open in a new tab – the Reko ones – or not at all – the Rapport
 * ones.
 *
 * One viewer per incident surface: `PhotoViewerProvider` wraps the board detail, the phone
 * sheet and the /display modal. The parts that show thumbnails hand it their photos
 * (`useRegisterPhotos`) and open it on a tap (`usePhotoViewer`, both `lib/hooks/use-photo-viewer.ts`). It lines them up Reko first,
 * then Rapport (`lib/photo-lightbox.ts`), so the arrows run through every photo of the
 * incident, and the desktop strip groups them «Reko · 3 | Rapport · 2».
 *
 * Desktop: dark scrim, «2 / 5» + the incident, ✕, arrows and ← → (Home/End), Esc closes.
 * Phone: swipe left/right, page dots, pull down to close. The image loads from the same URL
 * the thumbnail used (unoptimized), so the photo endpoint still logs every view (`view_photo`).
 * Without a provider (the /feld and /reko forms) nothing opens and the thumbnails stay as
 * they were.
 */

import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { Camera, ChevronLeft, ChevronRight, X } from 'lucide-react'

import { cn } from '@/lib/utils'
import { formatTime } from '@/lib/format-time'
import { PhotoViewerContext, type PhotoViewerApi } from '@/lib/hooks/use-photo-viewer'
import {
  groupRuns,
  lightboxKeyAction,
  lineUp,
  releaseIntent,
  stepIndex,
  type PhotoGroup,
  type ViewerPhoto,
} from '@/lib/photo-lightbox'

export function PhotoViewerProvider({
  incidentLabel,
  fallback,
  children,
}: {
  /** «10 · Rebbergstrasse 5» – the header names the incident the photos are of. */
  incidentLabel: string
  /** Photos a group shows until a mounted part registers its own – the board's Reko
   *  summary while the Reko tab is not open. Memoize it. */
  fallback?: Partial<Record<PhotoGroup, ViewerPhoto[]>>
  children: ReactNode
}) {
  const [registered, setRegistered] = useState<Partial<Record<PhotoGroup, ViewerPhoto[]>>>({})
  const [current, setCurrent] = useState<{ group: PhotoGroup; filename: string } | null>(null)
  const photos = useMemo(() => lineUp({ ...fallback, ...registered }), [fallback, registered])
  const index = current
    ? photos.findIndex(photo => photo.group === current.group && photo.filename === current.filename)
    : -1

  const api = useMemo<PhotoViewerApi>(() => ({
    open: (group, filename) => setCurrent({ group, filename }),
    register: (group, list) =>
      setRegistered(prev => {
        const next = { ...prev }
        if (list) next[group] = list
        else delete next[group]
        return next
      }),
  }), [])

  const show = useCallback((next: number) => {
    const photo = photos[next]
    if (photo) setCurrent({ group: photo.group, filename: photo.filename })
  }, [photos])

  return (
    <PhotoViewerContext.Provider value={api}>
      {children}
      <PhotoLightbox
        photos={photos}
        // A photo removed while it is shown closes the viewer.
        index={index}
        incidentLabel={incidentLabel}
        onShow={show}
        onClose={() => setCurrent(null)}
      />
    </PhotoViewerContext.Provider>
  )
}

/** The full-screen viewer itself. Open while `index` points at a photo. */
function PhotoLightbox({
  photos,
  index,
  incidentLabel,
  onShow,
  onClose,
}: {
  photos: ViewerPhoto[]
  index: number
  incidentLabel: string
  onShow: (index: number) => void
  onClose: () => void
}) {
  const t = useTranslations('photoViewer')
  const open = index >= 0
  const photo = open ? photos[index] : undefined
  const count = photos.length

  /** The finger on the photo: travel so far, and the last two samples for the release speed. */
  const drag = useRef<{ id: number; x0: number; y0: number; x: number; y: number; t: number; vx: number; vy: number } | null>(null)
  const [offset, setOffset] = useState<{ dx: number; dy: number } | null>(null)

  const go = (action: 'prev' | 'next' | 'first' | 'last') => onShow(stepIndex(index, action, count))

  function onKeyDown(event: React.KeyboardEvent) {
    const action = lightboxKeyAction(event.key)
    // Esc is Radix's: it closes through `onOpenChange`.
    if (!action || action === 'close') return
    event.preventDefault()
    go(action)
  }

  function onPointerDown(event: React.PointerEvent) {
    if (event.pointerType === 'mouse') return
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { id: event.pointerId, x0: event.clientX, y0: event.clientY, x: event.clientX, y: event.clientY, t: event.timeStamp, vx: 0, vy: 0 }
    setOffset({ dx: 0, dy: 0 })
  }

  function onPointerMove(event: React.PointerEvent) {
    const d = drag.current
    if (!d || d.id !== event.pointerId) return
    const dt = Math.max(1, event.timeStamp - d.t)
    d.vx = (event.clientX - d.x) / dt
    d.vy = (event.clientY - d.y) / dt
    d.x = event.clientX
    d.y = event.clientY
    d.t = event.timeStamp
    // 1:1 under the finger; a pull down only goes down.
    const dx = d.x - d.x0
    const dy = d.y - d.y0
    setOffset(Math.abs(dy) > Math.abs(dx) ? { dx: 0, dy: Math.max(0, dy) } : { dx, dy: 0 })
  }

  function onPointerEnd(event: React.PointerEvent) {
    const d = drag.current
    if (!d || d.id !== event.pointerId) return
    drag.current = null
    setOffset(null)
    const intent = releaseIntent(
      { dx: d.x - d.x0, dy: d.y - d.y0, vx: d.vx, vy: d.vy },
      event.currentTarget.getBoundingClientRect().width,
    )
    if (intent === 'close') onClose()
    else if (intent !== 'none') go(intent)
  }

  const pulled = offset ? Math.min(1, offset.dy / 300) : 0

  return (
    <DialogPrimitive.Root open={open} onOpenChange={next => { if (!next) onClose() }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="fixed inset-0 z-elevated bg-black/95"
          style={pulled ? { opacity: 1 - pulled * 0.6 } : undefined}
        />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onKeyDown={onKeyDown}
          className="fixed inset-0 z-elevated flex flex-col text-white outline-none pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
          data-testid="photo-viewer"
        >
          <DialogPrimitive.Title className="sr-only">{t('title', { incident: incidentLabel })}</DialogPrimitive.Title>

          {/* Head: phone ✕ left (thumb), desktop ✕ right (where every dialog has it). */}
          <div className="flex h-14 shrink-0 items-center gap-3 px-3 sm:h-16 sm:gap-4 sm:px-5">
            <DialogPrimitive.Close
              className="order-first grid size-11 shrink-0 place-items-center rounded-full bg-white/10 hover:bg-white/20 sm:order-last sm:ml-auto"
              aria-label={t('close')}
              title={t('closeHint')}
            >
              <X className="size-5" />
            </DialogPrimitive.Close>
            <span className="font-mono text-sm font-semibold tabular-nums sm:text-base" aria-live="polite">
              {t('counter', { index: index + 1, count })}
            </span>
            <span className="min-w-0 truncate text-sm opacity-70" title={incidentLabel}>{incidentLabel}</span>
          </div>

          {/* The photo. Touch drags it; a mouse uses the arrows and the keys. */}
          <div
            className="relative min-h-0 flex-1 touch-none select-none"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerEnd}
          >
            {photo && (
              <div
                className={cn('absolute inset-0', !offset && 'transition-transform duration-200 ease-out')}
                style={offset ? { transform: `translate3d(${offset.dx}px, ${offset.dy}px, 0)` } : undefined}
              >
                {/* unoptimized: the browser fetches the photo itself, with the credential
                    it carries (session cookie or the share token in the URL) – which is
                    also what logs the view (`view_photo`). */}
                <Image
                  key={`${photo.group}:${photo.filename}`}
                  src={photo.src}
                  alt={t('alt', { index: index + 1, count })}
                  fill
                  sizes="100vw"
                  unoptimized
                  draggable={false}
                  className="object-contain"
                />
              </div>
            )}
            <LightboxArrow side="prev" disabled={index <= 0} label={t('previous')} onClick={() => go('prev')} />
            <LightboxArrow side="next" disabled={index >= count - 1} label={t('next')} onClick={() => go('next')} />
          </div>

          {/* Foot: what this photo is, how to move on, and where it sits in the set. */}
          <div className="flex shrink-0 flex-col gap-1.5 px-4 pb-4 pt-3 sm:items-center sm:pb-5">
            {photo && <PhotoCaption photo={photo} />}
            <p className="text-xs opacity-50 max-sm:hidden">{t('hintDesktop')}</p>
            <p className="text-xs opacity-50 sm:hidden">{t('hintPhone')}</p>
            <PageDots count={count} index={index} />
            <ThumbStrip photos={photos} index={index} onShow={onShow} />
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function LightboxArrow({ side, disabled, label, onClick }: { side: 'prev' | 'next'; disabled: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      // Hidden, not greyed, at the end of the set: there is nowhere to go.
      className={cn(
        'absolute top-1/2 grid size-13 -translate-y-1/2 place-items-center rounded-full bg-white/10 hover:bg-white/20 max-sm:hidden',
        side === 'prev' ? 'left-6' : 'right-6',
        disabled && 'invisible',
      )}
      tabIndex={disabled ? -1 : 0}
    >
      {side === 'prev' ? <ChevronLeft className="size-5" /> : <ChevronRight className="size-5" />}
    </button>
  )
}

/** «Reko · Suter Beat · 18:13» – the group, the report's author and time when known. */
function PhotoCaption({ photo }: { photo: ViewerPhoto }) {
  const t = useTranslations('photoViewer')
  const group = photo.group === 'reko' ? t('groupReko') : t('groupRapport')
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-sm sm:text-base">
      <Camera className="size-4 shrink-0" aria-hidden="true" />
      <span className="font-semibold">{group}</span>
      {photo.by && (
        <>
          <span className="opacity-60" aria-hidden="true">·</span>
          <span className="min-w-0 break-words">{photo.by}</span>
        </>
      )}
      {photo.at && (
        <>
          <span className="opacity-60" aria-hidden="true">·</span>
          <span className="font-mono tabular-nums">{formatTime(photo.at)}</span>
        </>
      )}
    </div>
  )
}

/** The phone's position marks. More than a dozen read as a line, so the counter carries it. */
function PageDots({ count, index }: { count: number; index: number }) {
  if (count < 2 || count > 12) return null
  return (
    <div className="flex justify-center gap-1.5 pt-1 sm:hidden" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className={cn('size-1.5 rounded-full bg-white', i === index ? 'opacity-100' : 'opacity-35')} />
      ))}
    </div>
  )
}

/** Desktop: every photo of the incident, grouped «Reko · 3 | Rapport · 2»; a click jumps. */
function ThumbStrip({ photos, index, onShow }: { photos: ViewerPhoto[]; index: number; onShow: (index: number) => void }) {
  const t = useTranslations('photoViewer')
  if (photos.length < 2) return null
  return (
    <div className="flex max-w-full gap-4 overflow-x-auto pt-2 max-sm:hidden">
      {groupRuns(photos).map((run, runIndex) => (
        <div key={run.group} className={cn('shrink-0', runIndex > 0 && 'border-l border-white/20 pl-4')}>
          <div className="mb-1.5 text-xs opacity-60">
            {run.group === 'reko' ? t('groupReko') : t('groupRapport')} · {run.items.length}
          </div>
          <div className="flex gap-2">
            {run.items.map(({ photo, index: at }) => (
              <button
                key={photo.filename}
                type="button"
                onClick={() => onShow(at)}
                aria-label={t('alt', { index: at + 1, count: photos.length })}
                aria-current={at === index ? 'true' : undefined}
                className={cn(
                  'block h-12 w-16 shrink-0 overflow-hidden rounded-sm',
                  at === index ? 'outline-2 outline-offset-2 outline-sel-line' : 'opacity-70 hover:opacity-100',
                )}
              >
                <Image src={photo.src} alt="" width={64} height={48} unoptimized draggable={false} className="size-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
