'use client'

import { useEffect, useState } from 'react'
import { apiClient } from '@/lib/api-client'
import type { ApiDeployment } from '@/lib/api/types'

/**
 * What this deployment is allowed to do to the outside world, learned from the backend
 * at runtime.
 *
 * Runtime and not a build-time variable on purpose: the same published image runs in
 * production and on staging, so a `NEXT_PUBLIC_*` value would tie the image to one of them
 * (the same reason `NEXT_PUBLIC_API_URL` stays unset — see docs/RAILWAY.md).
 *
 * Answered once per page load and shared by every caller: the band at the top of the app and
 * the controls that have to show themselves locked read the same object, so they can never
 * disagree. Until it resolves — and if the request fails — the answer is "production", which
 * shows no band and locks nothing. That is the honest default: a frontend that cannot reach
 * its backend knows nothing, and inventing a warning would train people to ignore it.
 */

export const PRODUCTION_DEPLOYMENT: ApiDeployment = {
  role: 'production',
  label: null,
  blocked_domains: [],
}

let cached: ApiDeployment | null = null
let inflight: Promise<ApiDeployment | null> | null = null

/** Test seam: drop the module-level cache. */
export function resetDeploymentCache() {
  cached = null
  inflight = null
}

export function useDeployment(): ApiDeployment {
  const [deployment, setDeployment] = useState<ApiDeployment>(cached ?? PRODUCTION_DEPLOYMENT)

  useEffect(() => {
    if (cached) {
      setDeployment(cached)
      return
    }
    let cancelled = false
    const request = (inflight ??= apiClient.getDeployment())
    request
      .then((result) => {
        if (!result) return
        cached = result
        if (!cancelled) setDeployment(result)
      })
      .catch(() => {})
      .finally(() => {
        inflight = null
      })
    return () => {
      cancelled = true
    }
  }, [])

  return deployment
}

/**
 * Whether the deployment role refuses an effect domain ("alerting", "sync"), plus the label
 * to name in the reason. A control that comes back blocked must be visibly disabled and say
 * why — an invisibly dead button is worse than a locked one.
 */
export function useDeploymentBlock(domain: string): { blocked: boolean; label: string | null } {
  const deployment = useDeployment()
  return {
    blocked: deployment.blocked_domains.includes(domain),
    label: deployment.label,
  }
}
