'use client'

/**
 * The incident photo viewer's two doors for the parts that show thumbnails – the provider
 * and the viewer itself are `components/photos/photo-viewer.tsx`.
 *
 *   const open = usePhotoViewer()               // null where no viewer is mounted
 *   useRegisterPhotos('reko', photos)           // the photos this part shows
 *   <button onClick={() => open?.('reko', filename)} />
 *
 * Tested through the provider (`components/photos/photo-viewer.test.tsx`).
 */

import { createContext, useContext, useEffect } from 'react'

import { useEffectEvent } from '@/lib/hooks/use-effect-event'
import type { PhotoGroup, ViewerPhoto } from '@/lib/photo-lightbox'

export interface PhotoViewerApi {
  open: (group: PhotoGroup, filename: string) => void
  register: (group: PhotoGroup, photos: ViewerPhoto[] | null) => void
}

/** Provided by `PhotoViewerProvider`; nothing else writes it. */
export const PhotoViewerContext = createContext<PhotoViewerApi | null>(null)

/** «Open this photo» for a thumbnail, or null where no viewer is mounted. */
export function usePhotoViewer(): PhotoViewerApi['open'] | null {
  return useContext(PhotoViewerContext)?.open ?? null
}

/**
 * Hand the viewer the photos a part shows – the Reko report's, the Rapport's – for as long as
 * it is mounted. The latest list wins; unmounting takes it back (a `fallback` of the
 * provider stands in again). A fresh array per render re-registers only when what the
 * viewer shows changed.
 */
export function useRegisterPhotos(group: PhotoGroup, photos: ViewerPhoto[]): void {
  const register = useContext(PhotoViewerContext)?.register
  const key = JSON.stringify(photos.map(photo => [photo.filename, photo.src, photo.by, photo.at]))
  const registerLatest = useEffectEvent(() => register?.(group, photos))
  useEffect(() => {
    registerLatest()
  }, [register, group, key])
  useEffect(() => {
    if (!register) return
    return () => register(group, null)
  }, [register, group])
}
