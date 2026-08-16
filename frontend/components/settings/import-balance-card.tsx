'use client'

/**
 * The balance sheet an Excel import gets judged on.
 *
 * The preview used to only list what it had parsed, so the operator saw two new
 * recruits and pressed «Jetzt importieren» — and in `replace` mode that deleted a
 * roster of 18, a fleet of 5 and 26 pieces of material, with `success: true`. The
 * numbers that mattered were never on screen.
 *
 * So the card is a balance, not a warning: one row per resource,
 * `Bestand heute → aus Datei → wird gelöscht → Bestand nachher`, plus the figure
 * nobody can guess — assignments left pointing at a deleted resource, and how
 * many of those are on an incident that is still running (the ones the backend
 * refuses the import over).
 *
 * The deletion column is dropped entirely in `append` rather than filled with
 * zeroes: an operator scanning a column of noughts learns nothing, an operator
 * reading «Es wird nichts gelöscht» is done.
 *
 * The fallout below the table is split into two blocks on purpose, because it is
 * two different kinds of damage: rows the import LEAVES BEHIND pointing at
 * nothing (repairable on the board afterwards) and rows it TAKES WITH IT through
 * a cascading foreign key (gone – only a backup brings them back). Listed
 * together they would read as one pile of numbers to work through.
 *
 * The columns are not equally certain and the card says so instead of averaging
 * the difference away: «wird gelöscht» is counted by the backend, «nachher» is
 * arithmetic that in `append` mode leans on a separately fetched stock. An
 * unknown or estimated `nachher` is labelled – and never suppresses the deletion
 * figures, which are the half the operator is here for.
 */

import { useTranslations } from 'next-intl'
import {
  AlertTriangle,
  CheckCircle,
  Info,
  Package,
  ShieldAlert,
  Star,
  Trash2,
  Truck,
  Unlink,
  Unplug,
  UserCheck,
  Users,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import type { CascadeKey, DanglingGroupKey, ImportBalance, ImportResource } from './import-balance'

const RESOURCE_ICONS = {
  personnel: Users,
  vehicles: Truck,
  materials: Package,
} as const satisfies Record<ImportResource, typeof Users>

/** One line in a consequences block: an icon, a label key, and whether it is the blocking kind. */
interface ConsequenceMeta {
  icon: typeof Users
  label: string
  critical?: boolean
}

/**
 * Aufträge carry the same dangling hazard as incidents, so they are shown in the
 * same block – and the active count is `critical` for the same reason: the
 * backend sums BOTH active figures for its refusal.
 */
const DANGLING_GROUP_META = {
  incident_group_assignments: { icon: Unlink, label: 'groupOrphanedLabel', critical: false },
  active_incident_group_assignments: {
    icon: ShieldAlert,
    label: 'groupOrphanedActiveLabel',
    critical: true,
  },
} as const satisfies Record<DanglingGroupKey, ConsequenceMeta>

/** The rows that vanish rather than dangle – a separate block, never mixed into the one above. */
const CASCADE_META = {
  cascade_event_attendance: { icon: UserCheck, label: 'cascadeAttendanceLabel' },
  cascade_event_special_functions: { icon: Star, label: 'cascadeFunctionsLabel' },
  cascade_personnel_identities: { icon: Unplug, label: 'cascadeIdentitiesLabel' },
} as const satisfies Record<CascadeKey, ConsequenceMeta>

interface Props {
  balance: ImportBalance
}

export function ImportBalanceCard({ balance }: Props) {
  const t = useTranslations('settings.page.import.balance')
  const tSections = useTranslations('settings.page.sections')
  const isReplace = balance.mode === 'replace'

  /** A figure nobody can vouch for. Named, not just dashed – a bare «–» reads as zero. */
  const unknown = (
    <span className="text-muted-foreground" title={t('unknownValue')}>
      – <span className="text-[11px]">{t('unknownValue')}</span>
    </span>
  )

  return (
    <Card className={cn('p-5 space-y-4', isReplace && 'border-destructive/40')}>
      <div className="flex items-center gap-3">
        <p className="font-medium">{t('title')}</p>
        {isReplace ? (
          <Badge variant="destructive">
            <Trash2 aria-hidden="true" />
            {t('modeBadgeReplace')}
          </Badge>
        ) : (
          <Badge variant="outline" className="border-success/40 text-success">
            <CheckCircle aria-hidden="true" />
            {t('modeBadgeAppend')}
          </Badge>
        )}
      </div>

      <Table className="tabular-nums">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[34%]">{t('columnResource')}</TableHead>
            <TableHead className="text-right">{t('columnBefore')}</TableHead>
            <TableHead className="text-right">{t('columnFromFile')}</TableHead>
            {isReplace && (
              <TableHead className="text-right text-destructive">
                {t('columnDeleted')}
                <span className="block text-[11px] font-normal text-muted-foreground">
                  {t('columnDeletedNote')}
                </span>
              </TableHead>
            )}
            <TableHead className="text-right">
              {t('columnAfter')}
              {balance.afterIsEstimate && (
                <span className="block text-[11px] font-normal text-muted-foreground">
                  {t('columnAfterEstimate')}
                </span>
              )}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {balance.rows.map((row) => {
            const Icon = RESOURCE_ICONS[row.resource]
            return (
              <TableRow key={row.resource}>
                <TableCell>
                  <span className="flex items-center gap-2">
                    <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
                    {tSections(row.resource)}
                  </span>
                </TableCell>
                <TableCell className="text-right text-muted-foreground">{row.before ?? unknown}</TableCell>
                <TableCell className={cn('text-right', row.fromFile === 0 && 'text-muted-foreground')}>
                  {row.fromFile > 0 ? `+${row.fromFile}` : 0}
                </TableCell>
                {isReplace && (
                  <TableCell className="text-right font-semibold text-destructive bg-destructive/10">
                    {row.deleted > 0 ? `−${row.deleted}` : 0}
                  </TableCell>
                )}
                <TableCell className={cn('text-right font-semibold', row.after === 0 && 'text-destructive')}>
                  {row.after ?? unknown}
                  {row.after === 0 && (
                    <span className="ml-1 text-[11px] font-medium">{t('afterEmpty')}</span>
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
        <TableFooter className="bg-transparent">
          <TableRow>
            <TableCell className="font-medium">{t('totalRow')}</TableCell>
            <TableCell className="text-right text-muted-foreground">{balance.totals.before ?? unknown}</TableCell>
            <TableCell className={cn('text-right', balance.totals.fromFile === 0 && 'text-muted-foreground')}>
              {balance.totals.fromFile > 0 ? `+${balance.totals.fromFile}` : 0}
            </TableCell>
            {isReplace && (
              <TableCell className="text-right font-semibold text-destructive bg-destructive/10">
                {balance.totals.deleted > 0 ? `−${balance.totals.deleted}` : 0}
              </TableCell>
            )}
            <TableCell className={cn('text-right font-semibold', balance.totals.after === 0 && 'text-destructive')}>
              {balance.totals.after ?? unknown}
            </TableCell>
          </TableRow>
        </TableFooter>
      </Table>

      <ProvenanceNote balance={balance} />

      {balance.deletesNothing ? (
        <div className="flex items-start gap-3 rounded-lg border border-success/30 bg-success/10 p-3">
          <CheckCircle className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
          <p className="text-sm">
            <span className="font-medium">{t('nothingDeletedTitle')}</span>{' '}
            <span className="text-muted-foreground">{t('nothingDeletedHint')}</span>
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <ConsequencesBlock balance={balance} />
          {balance.cascadeDeletions.length > 0 && <CascadeBlock balance={balance} />}
        </div>
      )}
    </Card>
  )
}

interface ConsequenceRowProps {
  icon: typeof Users
  /** The translated text, not the key – the meta tables hold keys, this holds copy. */
  label: string
  count: number
  /** The blocking kind. Carried by the icon as well as the colour, never by colour alone. */
  critical?: boolean
}

/** One `dt`/`dd` pair of the consequence grids. */
function ConsequenceRow({ icon: Icon, label, count, critical }: ConsequenceRowProps) {
  return (
    <>
      <dt className="flex items-center gap-2">
        <Icon
          className={cn('size-3.5 shrink-0', critical ? 'text-destructive' : 'text-muted-foreground')}
          aria-hidden="true"
        />
        {label}
      </dt>
      <dd className={cn('text-right font-semibold tabular-nums', critical && 'text-destructive')}>
        {count}
      </dd>
    </>
  )
}

/**
 * Where the numbers come from, in one line under the table.
 *
 * Not decoration: `Bestand nachher` is exact in `replace` (backend counted the
 * stock and the file in one answer) and a guess in `append` (the stock is a
 * second fetch on its own clock). An operator who cannot tell those two apart
 * is being asked to trust both equally, and one of them has not earned it.
 */
function ProvenanceNote({ balance }: Props) {
  const t = useTranslations('settings.page.import.balance')
  const note = {
    preview: t('sourcePreviewNote'),
    stock: t('sourceStockNote'),
    unknown: t('sourceUnknownNote'),
  }[balance.beforeSource]

  return (
    <div className="flex items-start gap-2 text-xs text-muted-foreground">
      <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <p>
        {note}
        {balance.stockOutdated && <span className="block mt-1">{t('stockOutdatedNote')}</span>}
      </p>
    </div>
  )
}

/**
 * Everything the import leaves BEHIND: assignment rows that keep pointing at a
 * resource that is gone – on incidents, and on Aufträge, which hold their squad
 * on the route rather than on any of its stops.
 *
 * Warning-toned while it is only bookkeeping; destructive once an active count
 * is above zero, because at that point the import is not risky, it is refused.
 *
 * The badge is the point of the block, not decoration: these rows survive the
 * import and can be cleaned up on the board afterwards, which is exactly what
 * the cascaded rows below cannot. Said as a label so it does not depend on a
 * reader telling amber from red.
 */
function ConsequencesBlock({ balance }: Props) {
  const t = useTranslations('settings.page.import.balance')
  const blocked = balance.replaceBlocked

  return (
    <div
      className={cn(
        'rounded-lg border p-3',
        blocked ? 'border-destructive/40 bg-destructive/10' : 'border-warning/30 bg-warning/10',
      )}
    >
      <div className="flex items-center gap-2">
        {blocked ? (
          <ShieldAlert className="size-4 shrink-0 text-destructive" aria-hidden="true" />
        ) : (
          <AlertTriangle className="size-4 shrink-0 text-warning-foreground" aria-hidden="true" />
        )}
        <p className={cn('text-sm font-medium', blocked ? 'text-destructive' : 'text-warning-foreground')}>
          {blocked ? t('consequencesBlockedTitle') : t('consequencesTitle')}
        </p>
        <Badge variant="outline" className="ml-auto">
          <Unlink aria-hidden="true" />
          {t('repairableBadge')}
        </Badge>
      </div>
      <dl className="mt-2.5 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-sm">
        <ConsequenceRow icon={Unlink} label={t('orphanedLabel')} count={balance.orphanedAssignments} />
        <ConsequenceRow
          icon={ShieldAlert}
          label={t('orphanedActiveLabel')}
          count={balance.activeOrphanedAssignments}
          critical
        />
        {balance.danglingGroupAssignments.map(({ key, count }) => (
          <ConsequenceRow
            key={key}
            icon={DANGLING_GROUP_META[key].icon}
            label={t(DANGLING_GROUP_META[key].label)}
            count={count}
            critical={DANGLING_GROUP_META[key].critical}
          />
        ))}
      </dl>
      <p className={cn('mt-2.5 text-xs', blocked ? 'text-destructive' : 'text-muted-foreground')}>
        {blocked ? t('consequencesBlockedHint') : t('consequencesHint')}
      </p>
    </div>
  )
}

/**
 * Everything the import TAKES WITH IT. The other block lists rows that survive
 * badly; these do not survive at all – `personnel.id` is a real foreign key with
 * ON DELETE CASCADE, so the check-ins of a running event, the assigned
 * Spezialfunktionen and the links to the alerting accounts are deleted along
 * with the roster. There is nothing to repair afterwards, which is why this is
 * destructive-toned even when the import is not blocked, and why it is a block
 * of its own rather than three more lines above.
 *
 * Rendered only for the figures this backend actually reported and only above
 * zero, so an older backend – or a station with no running event – sees nothing
 * here instead of a column of noughts.
 */
function CascadeBlock({ balance }: Props) {
  const t = useTranslations('settings.page.import.balance')

  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3">
      <div className="flex items-center gap-2">
        <Trash2 className="size-4 shrink-0 text-destructive" aria-hidden="true" />
        <p className="text-sm font-medium text-destructive">{t('cascadeTitle')}</p>
        <Badge variant="destructive" className="ml-auto">
          {t('cascadeBadge')}
        </Badge>
      </div>
      <dl className="mt-2.5 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-sm">
        {balance.cascadeDeletions.map(({ key, count }) => (
          <ConsequenceRow
            key={key}
            icon={CASCADE_META[key].icon}
            label={t(CASCADE_META[key].label)}
            count={count}
            critical
          />
        ))}
      </dl>
      <p className="mt-2.5 text-xs text-destructive">{t('cascadeHint')}</p>
    </div>
  )
}
