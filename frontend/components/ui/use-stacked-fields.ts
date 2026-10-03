'use client'

import { useIsMobile } from '@/components/ui/use-mobile'

/**
 * Phone forms put the label ABOVE its field, never beside it (owner rule, 02.10.2026). The ONE
 * switch for that: `DetailField`, `DetailToggle`, `SettingRow` and `LocationInput`'s row ask this
 * hook, so a form built from them stacks below 768px without the caller doing anything. Pass
 * `explicit` only to force one layout (a 420px desktop panel that must keep its rows).
 *
 * The same breakpoint as `useIsMobile` on purpose: a form never stacks while the page around it
 * still has its desktop shape, or the other way round.
 */
export function useStackedFields(explicit?: boolean): boolean {
  const isMobile = useIsMobile()
  return explicit ?? isMobile
}
