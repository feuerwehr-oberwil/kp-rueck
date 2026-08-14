'use client'

import { useState, useRef, useEffect } from 'react'
import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Camera, Upload, X, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { translateOutsideReact } from '@/lib/i18n-messages'
import { getApiUrl } from '@/lib/env'

// Always convert image file to JPEG via canvas before upload.
// This handles HEIC (iPhone), WebP, and also normalizes JPEG/PNG files
// that iOS may misreport as image/jpeg when they're actually HEIC.
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

  const canvas = document.createElement('canvas')
  canvas.width = imgWidth
  canvas.height = imgHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error(translateOutsideReact('reko.photoUpload.canvasUnavailable'))
  }

  if (bitmap) {
    ctx.drawImage(bitmap, 0, 0)
    bitmap.close()
  } else {
    ctx.drawImage(imgElement!, 0, 0)
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
  /** Store the file; resolve with the server-side filename. */
  upload: (file: File) => Promise<string>
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
}

export default function PhotoUpload({
  photos,
  incidentId,
  transport,
  onPhotosChange,
  disabled = false
}: PhotoUploadProps) {
  const t = useTranslations('reko.photoUpload')
  const [isUploading, setIsUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)

  // Store local blob URLs for immediate preview (mobile-friendly)
  const [localPreviews, setLocalPreviews] = useState<Map<string, string>>(new Map())

  // Revoke all blob URLs on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      localPreviews.forEach(url => URL.revokeObjectURL(url))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleFileUpload(files: FileList | null) {
    if (!files || files.length === 0) return

    setIsUploading(true)

    try {
      const uploadPromises = Array.from(files).map(async (file) => {
        // Validate file type
        if (!file.type.startsWith('image/')) {
          toast.error(t('notAnImage', { name: file.name }))
          return null
        }

        // Validate file size (max 10MB, before conversion)
        if (file.size > 10 * 1024 * 1024) {
          toast.error(t('tooLarge', { name: file.name }))
          return null
        }

        // Convert to JPEG via canvas (handles HEIC from iPhones, etc.)
        const uploadFile = await convertToJpeg(file)

        // Create local blob URL for immediate preview (works better on mobile)
        const localUrl = URL.createObjectURL(uploadFile)

        // Upload photo
        const filename = await transport.upload(uploadFile)

        // Store local preview URL mapped to the server filename
        setLocalPreviews(prev => {
          const next = new Map(prev)
          next.set(filename, localUrl)
          return next
        })

        return filename
      })

      // allSettled so one failed file doesn't discard the uploads that succeeded
      const results = await Promise.allSettled(uploadPromises)

      const uploadedFilenames = results
        .filter((result): result is PromiseFulfilledResult<string | null> => result.status === 'fulfilled')
        .map((result) => result.value)
        .filter((filename): filename is string => filename !== null)

      if (uploadedFilenames.length > 0) {
        onPhotosChange(current => [...current, ...uploadedFilenames])
      }

      const failed = results.filter((result) => result.status === 'rejected')
      if (failed.length > 0) {
        failed.forEach((result) => console.error('Upload failed:', result.reason))
        toast.error(t('uploadFailed', { count: failed.length }))
      }
    } finally {
      setIsUploading(false)
      // Reset file inputs
      if (fileInputRef.current) fileInputRef.current.value = ''
      if (cameraInputRef.current) cameraInputRef.current.value = ''
    }
  }

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
    <div className="space-y-4">
      {/* Upload Buttons */}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => cameraInputRef.current?.click()}
          disabled={isUploading || disabled}
          className="flex-1"
        >
          <Camera className="size-4" />
          {t('camera')}
        </Button>

        <Button
          type="button"
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading || disabled}
          className="flex-1"
        >
          <Upload className="size-4" />
          {t('gallery')}
        </Button>
      </div>

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

      {/* Photo Grid */}
      {photos.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          {photos.map((filename, index) => (
            <div key={filename} className="relative aspect-square rounded-lg overflow-hidden bg-muted">
              {/* unoptimized: the source is either a local blob: preview or the
                  backend at a runtime-determined origin — neither can go through
                  Next's optimizer, which resolves hosts at build time. */}
              <Image
                src={getPhotoUrl(filename)}
                alt={`Photo ${index + 1}`}
                fill
                sizes="50vw"
                unoptimized
                className="object-cover"
              />
              <button
                type="button"
                onClick={() => handleRemovePhoto(filename)}
                disabled={disabled}
                className="absolute top-1 right-1 cursor-pointer p-1 bg-destructive text-destructive-foreground rounded-full hover:bg-destructive/90 transition-colors shadow-md disabled:hidden"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Loading State */}
      {isUploading && (
        <div className="flex items-center justify-center py-4 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          {t('uploading')}
        </div>
      )}

      {/* Info */}
      {photos.length === 0 && !isUploading && (
        <p className="text-sm text-muted-foreground text-center py-4">
          {t('noPhotos')}
        </p>
      )}
    </div>
  )
}
