'use client'

import { useTranslations } from 'next-intl'

import { LeaderGlyph } from '@/components/kanban/leader-badge'
import type { ApiFeldAssignment } from '@/lib/api-client'

/**
 * The EL briefing (decision 22): the list row names the Einsatzleiter of that
 * Schadenplatz BEFORE the form opens, so a crew knows who is normally expected
 * to file. The detail repeats it only when its «Mannschaft» does not mark the
 * EL already (`leaderInCrew`, 6C, phone sweep 24.11.2026). Briefed, never enforced — anybody assigned may still file.
 * The empty case reads "kein EL erfasst"; it is never a blank line. Marked with
 * the board's «EL» sign (LeaderGlyph), never a star – leader-badge.tsx says why.
 * 13px, under the 18px address: the briefing must not outweigh where to go
 * (hill climb r8); yours = 500 in ink, somebody else's = muted.
 */
export function LeaderLine({
  assignment,
  selfId,
  className,
}: {
  assignment: ApiFeldAssignment
  selfId: string | undefined
  className?: string
}) {
  const t = useTranslations('feld.leader')
  const tLeader = useTranslations('kanban.leader')
  const isSelf = Boolean(assignment.leader_personnel_id && assignment.leader_personnel_id === selfId)

  if (isSelf) {
    return (
      <p data-slot="feld-leader-line" className={`flex items-baseline gap-1.5 text-[13px] leading-snug font-medium text-foreground ${className ?? ''}`}>
        <LeaderGlyph />
        <span>{t('self')}</span>
      </p>
    )
  }

  return (
    <p data-slot="feld-leader-line" className={`flex items-baseline gap-1.5 text-[13px] leading-snug text-muted-foreground ${className ?? ''}`}>
      <LeaderGlyph />
      {assignment.leader_name ? (
        <>
          {/* The sign says «EL»; a screen reader hears the role. */}
          <span className="sr-only">{tLeader('is')}:</span>
          <span className="min-w-0 break-words">{assignment.leader_name}</span>
        </>
      ) : (
        <span>{t('none')}</span>
      )}
    </p>
  )
}
