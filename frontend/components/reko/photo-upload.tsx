'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Camera, Check, Plus, Upload, X, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { translateOutsideReact } from '@/lib/i18n-messages'
import { getApiUrl } from '@/lib/env'
import { cn } from '@/lib/utils'

/**
 * The longest edge a photo is sent at.
 *
 * The server recompresses to exactly this (`backend/app/services/photo_storage.py`),
 * so the full-resolution pixels a phone camera produces are carried over LTE
 * and then thrown away at the other end. Doing it here turns a ~4 MB picture
 * into ~0.4 MB — on one bar of signal that is the difference between a photo
 * that arrives and a batch that times out.
 */
const MAX_EDGE_PX = 1920

/** Hard ceiling on what is sent, checked AFTER the downscale — the phone's own
 *  8 MB original is not what goes over the wire, so refusing it up front turned
 *  away photos that would have arrived comfortably. */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

/** Attempts per photo: the first plus two automatic retries. */
const MAX_ATTEMPTS = 3

/** Grows with the attempt — a Funkloch that swallowed the first try is rarely
 *  gone a second later. */
const RETRY_DELAY_MS = 2000

// Always convert image file to JPEG via canvas before upload.
// This handles HEIC (iPhone), WebP, and also normalizes JPEG/PNG files
// that iOS may misreport as image/jpeg when they're actually HEIC.
// The same pass downscales to MAX_EDGE_PX — one canvas, both jobs.
async function convertToJpeg(file: File): Promise<File> {
  // Try createImageBitmap first (more reliable for HEIC on iOS)
  // Falls back to <img> element if not available
  let bitmap: ImageBitmap | null = null
  let imgElement: HTMLImageElement | null = null
  let imgWidth: number
  let imgHeight: number

  try {
    bitmap = await createImageBitmap(file)
    imgWidth = bitmap.width
    imgHeight = bitmap.height
  } catch {
    // Fallback: load via <img> element
    const result = await new Promise<{ width: number; height: number; img: HTMLImageElement }>((resolve, reject) => {
      const img = new window.Image()
      const url = URL.createObjectURL(file)
      img.onload = () => {
        URL.revokeObjectURL(url)
        resolve({ width: img.naturalWidth, height: img.naturalHeight, img })
      }
      img.onerror = () => {
        URL.revokeObjectURL(url)
        reject(new Error(translateOutsideReact('reko.photoUpload.loadFailed')))
      }
      img.src = url
    })
    imgWidth = result.width
    imgHeight = result.height
    imgElement = result.img
  }

  // Never upscale: a small picture stays its own size.
  const scale = Math.min(1, MAX_EDGE_PX / Math.max(imgWidth, imgHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(imgWidth * scale))
  canvas.height = Math.max(1, Math.round(imgHeight * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error(translateOutsideReact('reko.photoUpload.canvasUnavailable'))
  }

  if (bitmap) {
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
  } else {
    ctx.drawImage(imgElement!, 0, 0, canvas.width, canvas.height)
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error(translateOutsideReact('reko.photoUpload.conversionFailed')))
          return
        }
        const converted = new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), {
          type: 'image/jpeg',
        })
        resolve(converted)
      },
      'image/jpeg',
      0.92
    )
  })
}

/**
 * The one thing that differs between the doors this component is mounted behind.
 *
 * Reko passes its form token, `/feld` passes the event token plus a personnel
 * id, the board passes nothing at all and rides on the session cookie — and the
 * component itself knows about none of it. Same reasoning as
 * `RapportTransport`: a component that branches on which door it is behind
 * grows an "if" that only one side ever tests.
 */
export interface PhotoTransport {
  /** Store the file; resolve with the server-side filename. `onProgress` is
   *  called with 0…1 while the bytes go out — the doors that can report it pass
   *  it on, the ones that cannot simply ignore the argument. */
  upload: (file: File, onProgress?: (fraction: number) => void) => Promise<string>
  remove: (filename: string) => Promise<void>
  /**
   * Where to READ a stored photo back from. Optional, and the default is the
   * session-authenticated board endpoint — which is right for every door that
   * has a session and wrong for the only one that doesn't.
   *
   * `/feld` overrides it: it holds an event token and a personnel id, not a
   * cookie, so `GET /api/photos/...` answered its `<img>` with a 401 and the
   * crew saw a broken-image icon where its own photo should be. The fix is a
   * read path behind the feld two-step, not a photo endpoint without a
   * credential — the picture can be a citizen's cellar.
   */
  url?: (filename: string) => string
}

/**
 * Where one photo of the current batch has got to.
 *
 * `waiting` and `uploading` are the honest halves of what used to be a single
 * «Wird hochgeladen …» for the whole batch: uploads run one at a time (four
 * parallel photos on one bar of signal is how all four time out), so at any
 * moment exactly one is moving and the rest are queued.
 */
type QueuedState =
  | { status: 'waiting' }
  | { status: 'uploading'; progress: number; attempt: number }
  | { status: 'done' }
  | { status: 'failed'; message: string; attempts: number }

interface QueuedPhoto {
  /** Local id — the server filename does not exist yet, and may never. */
  id: string
  /** The camera's own name, so a crew can tell four storm photos apart. */
  name: string
  /** Already converted and downscaled: a retry must not redo that work, and
   *  keeping the file is what makes «nicht nochmals fotografieren» true. */
  file: File
  previewUrl: string
  state: QueuedState
}

interface PhotoUploadProps {
  photos: string[]
  incidentId: string
  transport: PhotoTransport
  /**
   * Functional update against the parent's CURRENT photo list. Uploads finish
   * asynchronously, so merging against a captured `photos` prop would resurrect
   * photos removed while an upload was in flight.
   */
  onPhotosChange: (update: (current: string[]) => string[]) => void
  disabled?: boolean
  /**
   * The board's mount (KP), where this block is one `DetailField` row.
   *
   * Three things change, all of them because the machine is a desktop with a
   * mouse: there is no «Kamera» button (there is no camera), the pictures are
   * 40px marks in a wrapping line rather than half-column squares that push
   * the report off the screen, and the two ways a photo actually reaches the
   * KP — dragged in, or pasted out of WhatsApp Web — are wired up.
   */
  dense?: boolean
}

export default function PhotoUpload({
  photos,
  incidentId,
  transport,
  onPhotosChange,
  disabled = false,
  dense = false
}: PhotoUploadProps) {
  const t = useTranslations('reko.photoUpload')
  /** Converting and downscaling, before anything is queued. Short, but it is
   *  the one moment a second tap on «Kamera» would lose the first pick. */
  const [preparing, setPreparing] = useState(false)
  const [online, setOnline] = useState(true)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)

  // Store local blob URLs for immediate preview (mobile-friendly)
  const [localPreviews, setLocalPreviews] = useState<Map<string, string>>(new Map())

  /**
   * The batch in flight, mirrored into a ref.
   *
   * The ref is the source of truth for the sender loop: it reads and writes the
   * queue between awaits, where a captured `useState` value is already stale.
   * The state copy exists to render.
   */
  const [queue, setQueue] = useState<QueuedPhoto[]>([])
  const queueRef = useRef<QueuedPhoto[]>([])
  const sendingRef = useRef(false)
  /** Something is being dragged over the row (board mount only). */
  const [dragging, setDragging] = useState(false)

  const commitQueue = useCallback((next: QueuedPhoto[]) => {
    queueRef.current = next
    setQueue(next)
  }, [])

  const patchQueue = useCallback((id: string, state: QueuedState) => {
    commitQueue(queueRef.current.map(item => (item.id === id ? { ...item, state } : item)))
  }, [commitQueue])

  // Revoke all blob URLs on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      localPreviews.forEach(url => URL.revokeObjectURL(url))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Whether this phone has a network. Only used to word the waiting state: a
  // cellar is not a fault, and the queue behaves the same either way.
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine)
    sync()
    window.addEventListener('online', sync)
    window.addEventListener('offline', sync)
    return () => {
      window.removeEventListener('online', sync)
      window.removeEventListener('offline', sync)
    }
  }, [])

  /**
   * One photo, up to three attempts.
   *
   * Nothing is discarded on the way: the file stays in the queue until it is at
   * the KP or the crew gives up on it, which is what makes "nicht nochmals
   * fotografieren" a promise rather than a hope.
   */
  const sendOne = useCallback(async (item: QueuedPhoto) => {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      patchQueue(item.id, { status: 'uploading', progress: 0, attempt })
      try {
        const filename = await transport.upload(item.file, fraction =>
          patchQueue(item.id, { status: 'uploading', progress: fraction, attempt }),
        )
        // The local blob keeps serving the preview, now under the server name.
        setLocalPreviews(prev => {
          const next = new Map(prev)
          next.set(filename, item.previewUrl)
          return next
        })
        onPhotosChange(current => [...current, filename])
        patchQueue(item.id, { status: 'done' })
        return
      } catch (error) {
        console.error('Photo upload failed:', error)
        const message = error instanceof Error ? error.message : t('uploadFailed', { count: 1 })
        if (attempt >= MAX_ATTEMPTS) {
          patchQueue(item.id, { status: 'failed', message, attempts: attempt })
          return
        }
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * attempt))
      }
    }
  }, [transport, onPhotosChange, patchQueue, t])

  /** Drain the queue, one photo at a time. Re-entrant callers return at once,
   *  so a second batch joins the running loop instead of racing it. */
  const pump = useCallback(async () => {
    if (sendingRef.current) return
    sendingRef.current = true
    try {
      for (;;) {
        const next = queueRef.current.find(item => item.state.status === 'waiting')
        if (!next) break
        await sendOne(next)
      }
      // Everything arrived: the grid below is now the better record, so the
      // list of rows goes. A batch with a failure in it stays on screen —
      // that is where the «Nochmals senden» button lives.
      if (queueRef.current.every(item => item.state.status === 'done')) commitQueue([])
    } finally {
      sendingRef.current = false
    }
  }, [sendOne, commitQueue])

  /** Was there a stretch without a network to come back FROM? */
  const wasOffline = useRef(false)

  // The network coming back is the normal end of a stuck queue: retry what
  // failed rather than making somebody find each row and tap it. Strictly on
  // the transition — a photo the server itself refused (wrong type, quota) must
  // stay refused instead of being resent forever.
  useEffect(() => {
    if (!online) {
      wasOffline.current = true
      return
    }
    if (!wasOffline.current) return
    wasOffline.current = false
    const revived = queueRef.current.map(item =>
      item.state.status === 'failed' ? { ...item, state: { status: 'waiting' as const } } : item,
    )
    if (revived.some(item => item.state.status === 'waiting')) {
      commitQueue(revived)
      void pump()
    }
  }, [online, commitQueue, pump])

  async function handleFileUpload(files: FileList | File[] | null) {
    if (!files || files.length === 0) return

    setPreparing(true)
    try {
      const prepared: QueuedPhoto[] = []
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/')) {
          toast.error(t('notAnImage', { name: file.name }))
          continue
        }
        let uploadFile: File
        try {
          // Convert to JPEG via canvas (handles HEIC from iPhones, etc.) and
          // downscale in the same pass.
          uploadFile = await convertToJpeg(file)
        } catch (error) {
          console.error('Photo conversion failed:', error)
          toast.error(t('notAnImage', { name: file.name }))
          continue
        }
        // Size is checked HERE, on what is actually sent: a 12 MB camera
        // original is ~0.4 MB by now, and refusing it before the downscale
        // turned away photos that would have gone through fine.
        if (uploadFile.size > MAX_UPLOAD_BYTES) {
          toast.error(t('tooLarge', { name: file.name }))
          continue
        }
        prepared.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: file.name,
          file: uploadFile,
          previewUrl: URL.createObjectURL(uploadFile),
          state: { status: 'waiting' },
        })
      }
      if (prepared.length > 0) {
        commitQueue([...queueRef.current, ...prepared])
        void pump()
      }
    } finally {
      setPreparing(false)
      // Reset file inputs
      if (fileInputRef.current) fileInputRef.current.value = ''
      if (cameraInputRef.current) cameraInputRef.current.value = ''
    }
  }

  /**
   * Paste out of the clipboard — the real way a picture reaches the board.
   *
   * The crew has no signal in the cellar and sends it over WhatsApp; the
   * operator has WhatsApp Web open next to the incident and copies the image.
   * The listener is on the document because there is no one input to focus for
   * this, and it only ever claims the event when the clipboard actually
   * carries an image — a pasted address still lands in the field under the
   * cursor.
   */
  useEffect(() => {
    if (!dense || disabled) return
    const onPaste = (event: ClipboardEvent) => {
      const images = Array.from(event.clipboardData?.files ?? []).filter(file =>
        file.type.startsWith('image/'),
      )
      if (images.length === 0) return
      event.preventDefault()
      void handleFileUpload(images)
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
    // `handleFileUpload` is a plain function redeclared every render; it reads
    // only refs and stable callbacks, so re-subscribing on every render would
    // buy nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dense, disabled])

  /** «Nochmals senden» on the one photo that did not make it. */
  const retryOne = (id: string) => {
    patchQueue(id, { status: 'waiting' })
    void pump()
  }

  /** Give up on a photo. The file is dropped, so the sentence about nothing
   *  being lost stops applying — which is why this is a deliberate tap. */
  const discardOne = (id: string) => {
    const item = queueRef.current.find(entry => entry.id === id)
    if (item) URL.revokeObjectURL(item.previewUrl)
    const rest = queueRef.current.filter(entry => entry.id !== id)
    commitQueue(rest.every(entry => entry.state.status === 'done') ? [] : rest)
  }

  const queuedCount = queue.filter(item => item.state.status !== 'done').length
  const doneCount = queue.filter(item => item.state.status === 'done').length

  async function handleRemovePhoto(filename: string) {
    try {
      // Delete from backend first
      await transport.remove(filename)

      // Revoke local blob URL to free memory
      const localUrl = localPreviews.get(filename)
      if (localUrl) {
        URL.revokeObjectURL(localUrl)
        setLocalPreviews(prev => {
          const next = new Map(prev)
          next.delete(filename)
          return next
        })
      }

      onPhotosChange(current => current.filter(f => f !== filename))
    } catch (error) {
      console.error('Delete failed:', error)
      toast.error(t('deleteFailed'))
    }
  }

  // Get photo URL - prefer local blob URL for preview, fall back to server URL
  function getPhotoUrl(filename: string): string {
    // Use local blob URL if available (better for mobile preview)
    const localUrl = localPreviews.get(filename)
    if (localUrl) {
      return localUrl
    }
    // Fall back to the server URL the door supplies, else the board's.
    if (transport.url) {
      return transport.url(filename)
    }
    const apiUrl = getApiUrl()
    return `${apiUrl}/api/photos/${incidentId}/${filename}`
  }

  return (
    <div
      className={cn(
        dense ? "space-y-1.5 rounded-md" : "space-y-4",
        dense && dragging && "outline-2 outline-offset-2 outline-dashed outline-info",
      )}
      onDragOver={dense && !disabled ? (event) => {
        event.preventDefault()
        setDragging(true)
      } : undefined}
      // Only when the pointer leaves the row itself: dragging across a
      // thumbnail inside it fires `dragleave` too, and the outline would
      // blink off under the file being dropped.
      onDragLeave={dense ? (event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false)
      } : undefined}
      onDrop={dense && !disabled ? (event) => {
        event.preventDefault()
        setDragging(false)
        void handleFileUpload(event.dataTransfer.files)
      } : undefined}
    >
      {/* Upload Buttons. The board has no camera to offer, so it offers the two
          doors it does have — the strip below carries «ziehen, einfügen oder
          Datei wählen» and the `+` mark opens the picker. */}
      {!dense && (
        <div className="flex gap-2">
          {/* Enabled while the queue drains: sending happens in the background,
              and a crew that has four things to photograph should not be made to
              wait between them. */}
          <Button
            type="button"
            variant="outline"
            onClick={() => cameraInputRef.current?.click()}
            disabled={preparing || disabled}
            className="flex-1"
          >
            <Camera className="size-4" />
            {t('camera')}
          </Button>

          <Button
            type="button"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={preparing || disabled}
            className="flex-1"
          >
            <Upload className="size-4" />
            {t('gallery')}
          </Button>
        </div>
      )}

      {/* Hidden file inputs */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        onChange={(e) => handleFileUpload(e.target.files)}
        className="hidden"
      />

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => handleFileUpload(e.target.files)}
        className="hidden"
      />

      {/* No network and photos still in hand: not a fault, and the important
          sentence is the last one — the picture is on the phone, so nobody has
          to walk back and take it again. */}
      {!online && queuedCount > 0 && (
        <div className="rounded-lg border border-info/40 bg-info/10 p-3 text-sm">
          <p className="font-medium">{t('offlineTitle', { count: queuedCount })}</p>
          <p className="mt-0.5">{t('offlineBody')}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t('offlineHint')}</p>
        </div>
      )}

      {/* The batch, one row per photo. It replaces a single «Wird hochgeladen …»
          for all of them, which said nothing about WHICH photo was moving and
          left «4 Fotos konnten nicht hochgeladen werden» as the only outcome. */}
      {queue.length > 0 && (
        <div className="rounded-lg border border-border">
          {queue.map(item => (
            <div key={item.id} className="flex items-start gap-3 border-b border-border/50 p-2.5 last:border-b-0">
              {/* unoptimized: a local blob: URL, see the grid below. */}
              <Image
                src={item.previewUrl}
                alt={item.name}
                width={36}
                height={36}
                unoptimized
                className="size-9 shrink-0 rounded-md object-cover"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{item.name}</p>
                {item.state.status === 'uploading' ? (
                  <>
                    <p className="text-xs text-muted-foreground">
                      {item.state.attempt > 1
                        ? t('rowRetrying', {
                            percent: Math.round(item.state.progress * 100),
                            attempt: item.state.attempt,
                            total: MAX_ATTEMPTS,
                          })
                        : t('rowUploading', { percent: Math.round(item.state.progress * 100) })}
                    </p>
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full bg-info transition-[width]"
                        style={{ width: `${Math.max(2, Math.round(item.state.progress * 100))}%` }}
                      />
                    </div>
                  </>
                ) : item.state.status === 'waiting' ? (
                  <p className="text-xs text-muted-foreground">{t('rowWaiting')}</p>
                ) : item.state.status === 'done' ? (
                  <p className="text-xs text-muted-foreground">{t('rowSent')}</p>
                ) : (
                  <>
                    <p className="text-xs text-destructive">
                      {t('rowFailed', { count: item.state.attempts })}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{item.state.message}</p>
                    <div className="mt-1 flex gap-2">
                      <Button type="button" size="xs" variant="outline" onClick={() => retryOne(item.id)}>
                        {t('rowRetry')}
                      </Button>
                      <Button type="button" size="xs" variant="ghost" onClick={() => discardOne(item.id)}>
                        {t('rowDiscard')}
                      </Button>
                    </div>
                  </>
                )}
              </div>
              {item.state.status === 'done' && <Check className="size-4 shrink-0 text-success" />}
            </div>
          ))}
        </div>
      )}

      {/* How far the batch has got, and that leaving this screen alone is fine. */}
      {queuedCount > 0 && online && (
        <p className="text-center text-xs text-muted-foreground">
          {t('queueProgress', { done: doneCount, total: queue.length })}
        </p>
      )}

      {/* The photos themselves. On the board they wrap as 96px squares: 40px
          marks were unreadable, which made opening every one of them the only
          way to see what a crew had sent. Still a wrapping row rather than the
          two-column grid below, so a report with three photos costs one row. */}
      {dense ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {photos.map((filename, index) => (
            <span key={filename} className="group relative block size-24 shrink-0 overflow-hidden rounded-md bg-muted">
              {/* unoptimized: see the grid below. */}
              <Image
                src={getPhotoUrl(filename)}
                alt={t('photoNumber', { number: index + 1 })}
                title={filename}
                fill
                sizes="96px"
                unoptimized
                className="object-cover"
              />
              <button
                type="button"
                onClick={() => handleRemovePhoto(filename)}
                disabled={disabled}
                aria-label={t('removePhoto', { number: index + 1 })}
                className="absolute inset-0 flex cursor-pointer items-center justify-center bg-background/70 text-destructive opacity-0 transition-opacity group-hover:opacity-100 disabled:hidden"
              >
                <X className="size-4" />
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={preparing || disabled}
            aria-label={t('chooseFile')}
            className="flex size-24 shrink-0 cursor-pointer items-center justify-center rounded-md border border-dashed border-border text-muted-foreground transition-colors hover:bg-input/50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {preparing ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          </button>
          {/* Says the two ways that are actually used at the board, and stands
              in for the «Noch keine Fotos» line — an empty row that only says
              it is empty is a row spent on nothing. */}
          <span className="text-xs text-muted-foreground">{t('denseHint')}</span>
        </div>
      ) : (
        <>
          {photos.length > 0 && (
            <div className="grid grid-cols-2 gap-3">
              {photos.map((filename, index) => (
                <div key={filename} className="relative aspect-square rounded-lg overflow-hidden bg-muted">
                  {/* unoptimized: the source is either a local blob: preview or the
                      backend at a runtime-determined origin — neither can go through
                      Next's optimizer, which resolves hosts at build time. */}
                  <Image
                    src={getPhotoUrl(filename)}
                    alt={t('photoNumber', { number: index + 1 })}
                    fill
                    sizes="50vw"
                    unoptimized
                    className="object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => handleRemovePhoto(filename)}
                    disabled={disabled}
                    aria-label={t('removePhoto', { number: index + 1 })}
                    className="absolute top-1 right-1 cursor-pointer p-1 bg-destructive text-destructive-foreground rounded-full hover:bg-destructive/90 transition-colors shadow-md disabled:hidden"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Preparing: the canvas pass (HEIC → JPEG, downscale to 1920 px) before
              anything is queued. Everything after this has its own row above. */}
          {preparing && (
            <div className="flex items-center justify-center py-4 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t('uploading')}
            </div>
          )}

          {/* Info */}
          {photos.length === 0 && queue.length === 0 && !preparing && (
            <p className="text-sm text-muted-foreground text-center py-4">
              {t('noPhotos')}
            </p>
          )}
        </>
      )}
    </div>
  )
}
