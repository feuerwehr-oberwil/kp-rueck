'use client'

import { useTranslations } from 'next-intl'

import type { ApiFeldOwnReport } from '@/lib/api-client'
import { formatTime } from '@/lib/format-time'
import { getIncidentTypeLabel } from '@/lib/incident-types'
import { asIncidentType } from '@/lib/types/incidents'
import { formatLocationForDisplay, getGlobalHomeCity } from '@/lib/utils'

/**
 * Section: what I reported.
 * The third group of the one list, under «Früher» — same card shape,
 * no chevron, because these are not Schadenplätze anybody sent this
 * person to. Without it a Meldung disappears the second it is sent and
 * a wrong house number is a radio call. `onEdit` opens the correction sheet.
 */
export function FeldReportsList({
  reports,
  onEdit,
}: {
  reports: ApiFeldOwnReport[]
  onEdit: (report: ApiFeldOwnReport) => void
}) {
  const tReports = useTranslations('feld.reports')
  if (reports.length === 0) return null
  return (
    <>
      <p className="mb-2 mt-6 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {tReports('title')}
      </p>
      {reports.map(report => {
        const address = report.location_display
          ?? formatLocationForDisplay(report.location_address ?? '', getGlobalHomeCity())
        // Three states, and `editable` is the server's own answer rather
        // than the phone re-deriving it from a status vocabulary it should
        // not have to know.
        // A Meldung the KP merged into an open card says where it went —
        // «zusammengeführt in Hauptstrasse 6» — instead of vanishing.
        const state = report.merged_into_id
          ? tReports('stateMerged', { label: report.merged_into_label ?? '' })
          : report.editable
          ? tReports('stateOpen')
          : report.status === 'complete'
            ? tReports('stateDone')
            : report.vehicles.length > 0
              ? tReports('stateDispatchedWith', { vehicles: report.vehicles.join(', ') })
              : tReports('stateDispatched')
        return (
          <div
            key={report.incident_id}
            className={`rounded-xl p-4 ${report.editable ? 'bg-secondary/50' : 'bg-muted/30 opacity-70'}`}
          >
            <h3 className="font-medium leading-tight">{address || report.title}</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {[formatTime(report.created_at), getIncidentTypeLabel(asIncidentType(report.type)), report.description]
                .filter(Boolean)
                .join(' · ')}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                {state}
              </span>
              {/* Only while it is still the reporter's to change — once the
                  KP has sent somebody, the vehicle name stands here
                  instead and the correction goes over the radio. */}
              {report.editable && (
                <button
                  type="button"
                  onClick={() => onEdit(report)}
                  className="text-xs underline underline-offset-2 hover:text-foreground"
                >
                  {tReports('edit')}
                </button>
              )}
            </div>
          </div>
        )
      })}
    </>
  )
}
