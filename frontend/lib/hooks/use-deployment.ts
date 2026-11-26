'use client'

import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'
import type { ApiDeployment } from '@/lib/api/types'
import { queryKeys } from '@/lib/query/keys'

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

export function useDeployment(): ApiDeployment {
  const query = useQuery({
    queryKey: queryKeys.deployment,
    queryFn: () => apiClient.getDeployment(),
    // An answer holds for the page's life; «no answer» (null) is asked again on the next mount.
    staleTime: (q) => (q.state.data ? Infinity : 0),
  })
  return query.data ?? PRODUCTION_DEPLOYMENT
}

/**
 * Whether the deployment role refuses an effect domain (today only "alerting"), plus the label
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
