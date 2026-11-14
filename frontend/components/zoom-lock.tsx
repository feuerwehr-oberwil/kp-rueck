'use client'

import { useEffect } from 'react'

import { lockChromeZoom } from '@/lib/zoom-lock'

/** The JS half of the app-wide zoom lock (lib/zoom-lock.ts), mounted once by the root layout. */
export function ZoomLock() {
  useEffect(() => lockChromeZoom(), [])
  return null
}
