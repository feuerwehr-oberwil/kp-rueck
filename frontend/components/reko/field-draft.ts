import { randomUuid } from '@/lib/utils/validation'
import type { ApiDangersAssessment, ApiEffortEstimation } from '@/lib/api/types'
import { EMPTY_REKO_FORM, type RekoFormData } from './reko-report-form'

// Photos already have their own upload/delete transactions.
const scalarKeys = ['is_relevant', 'power_supply', 'summary_text', 'additional_notes'] as const
const dangerKeys = Object.keys(EMPTY_REKO_FORM.dangers_json) as (keyof ApiDangersAssessment)[]
const effortKeys = Object.keys(EMPTY_REKO_FORM.effort_json) as (keyof ApiEffortEstimation)[]

export type DraftChanges = Partial<Pick<RekoFormData, typeof scalarKeys[number]>> & {
  dangers_json?: Partial<ApiDangersAssessment>
  effort_json?: Partial<ApiEffortEstimation>
}

export interface FieldDraft {
  previous: DraftChanges
  changes: DraftChanges
  // Values sent without a confirmed acknowledgement. Even a change back to
  // the old value must be written when the remote may have accepted an interim one.
  attempts?: DraftChanges[]
}

function changedKeys<T extends object>(base: T, form: T, keys: readonly (keyof T)[], attempted: object): Partial<T> {
  const changed = keys.filter(key =>
    Object.hasOwn(attempted, key) || JSON.stringify(base[key]) !== JSON.stringify(form[key]))
  return Object.fromEntries(changed.map(key => [key, form[key]])) as Partial<T>
}

export function changedFields(base: RekoFormData, form: RekoFormData, attempted: DraftChanges = {}): DraftChanges {
  const dangers = changedKeys(base.dangers_json, form.dangers_json, dangerKeys, attempted.dangers_json ?? {})
  const effort = changedKeys(base.effort_json, form.effort_json, effortKeys, attempted.effort_json ?? {})
  return {
    ...changedKeys(base, form, scalarKeys, attempted),
    ...(Object.keys(dangers).length > 0 && { dangers_json: dangers }),
    ...(Object.keys(effort).length > 0 && { effort_json: effort }),
  }
}

export function applyDraft(server: RekoFormData, changes: DraftChanges): RekoFormData {
  return {
    ...server, ...changes,
    dangers_json: { ...server.dangers_json, ...changes.dangers_json },
    effort_json: { ...server.effort_json, ...changes.effort_json },
  }
}

export function draftFields(changes: DraftChanges): [string, unknown][] {
  return [
    ...scalarKeys.filter(key => Object.hasOwn(changes, key)).map(key => [key, changes[key]] as [string, unknown]),
    ...Object.entries(changes.dangers_json ?? {}),
    ...Object.entries(changes.effort_json ?? {}),
  ]
}

export function conflictsWithServer(server: RekoFormData, draft: FieldDraft): boolean {
  const remote = new Map(draftFields(server))
  const previous = new Map(draftFields(draft.previous))
  const attempts = (draft.attempts ?? []).map(fields => new Map(draftFields(fields)))
  return draftFields(draft.changes).some(([key, desired]) => {
    const value = JSON.stringify(remote.get(key))
    return [desired, previous.get(key)].every(known => JSON.stringify(known) !== value) &&
      attempts.every(fields => !fields.has(key) || JSON.stringify(fields.get(key)) !== value)
  })
}

export interface StoredRevision {
  key: string
  raw: string
}

export interface RecoverableDraft {
  draft: FieldDraft
  savedAt: number
  revisions: StoredRevision[]
}

// Each write gets a fresh key, including repeated edits in a single tab. Acknowledging a
// revision can therefore never delete a newer one.
//
// Keyed by report AND by the person the link names (`personnel_id`; `link` for a link that
// names nobody). Since one report serves the whole incident, a phone handed to the next crew
// member must not restore – and send under their name – what the previous one left unsent
// (Sol review G round 2, S1). Older keys (per report only, or incident-wide) cannot say whose
// they are and are not read.
export class ReportDrafts {
  private readonly prefix: string
  private own: StoredRevision | null = null
  private currentData: string | null = null

  constructor(reportId: string, personnelId: string | null) {
    this.prefix = `reko-report-draft-${reportId}@${personnelId ?? 'link'}`
  }

  read(): RecoverableDraft[] {
    const versions = new Map<string, RecoverableDraft>()
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key?.startsWith(this.prefix + '/')) continue
      const raw = localStorage.getItem(key)
      if (!raw) continue
      try {
        const { changes, previous, attempts, savedAt } = JSON.parse(raw)
        if (!changes || !previous) continue
        const draft: FieldDraft = { changes, previous, attempts }
        const signature = JSON.stringify(draft)
        const version: RecoverableDraft = versions.get(signature) ?? { draft, savedAt: savedAt ?? 0, revisions: [] }
        version.revisions.push({ key, raw })
        versions.set(signature, version)
      } catch {
        // A damaged revision must not hide a healthy draft from another tab.
      }
    }
    return [...versions.values()].sort((a, b) => b.savedAt - a.savedAt)
  }

  write(draft: FieldDraft | null) {
    const data = draft && JSON.stringify(draft)
    if (this.currentData === data) return this.own
    const old = this.own
    if (draft) {
      const key = `${this.prefix}/${randomUuid()}`
      const raw = JSON.stringify({ ...draft, savedAt: Date.now() })
      localStorage.setItem(key, raw)
      this.own = { key, raw }
    } else {
      this.own = null
    }
    this.currentData = data
    if (old) this.remove(old)
    return this.own
  }

  acknowledge(revision: StoredRevision) {
    this.remove(revision)
    if (this.own?.key === revision.key) {
      this.own = null
      this.currentData = null
    }
  }

  retire(version: RecoverableDraft) {
    for (const revision of version.revisions) this.remove(revision)
  }

  private remove(revision: StoredRevision) {
    // Only the revision as it was read: a key rewritten since is left alone.
    if (localStorage.getItem(revision.key) === revision.raw) localStorage.removeItem(revision.key)
  }
}
