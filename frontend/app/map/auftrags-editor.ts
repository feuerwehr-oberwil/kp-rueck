/**
 * The Lagekarte's Auftrags-Editor (desk only) as one value: closed, open without an Auftrag, or
 * open on one Auftrag's route. «Stopp hinzufügen» and the focused stop exist only on a route, so
 * an add mode without a route cannot be written. Closed keeps the last Auftrag: the editor opens
 * on it again. The page holds it with `useReducer(changeAuftragsEditor, AUFTRAGS_EDITOR_CLOSED)`.
 */
export type AuftragsEditor =
  | { kind: 'off'; groupId: string | null }
  /** Open, but there was no Auftrag to open on – the panel offers to create one. */
  | { kind: 'picking'; groupId: null }
  | {
      kind: 'route'
      groupId: string
      /** «Stopp hinzufügen»: a click on empty map adds a stop. */
      addMode: boolean
      /** The stop highlighted on the map and in the list. */
      focusStopId: string | null
    }

export type AuftragsEditorChange =
  /** Opens on the last Auftrag, else on `firstGroupId`. */
  | { type: 'open'; firstGroupId: string | null }
  | { type: 'close' }
  /** The panel's picker, or a new Auftrag – also while closed, when the create finishes late. */
  | { type: 'pickGroup'; groupId: string }
  | { type: 'addMode'; on: boolean }
  | { type: 'focusStop'; stopId: string | null }

export const AUFTRAGS_EDITOR_CLOSED: AuftragsEditor = { kind: 'off', groupId: null }

const onRoute = (groupId: string): AuftragsEditor => ({ kind: 'route', groupId, addMode: false, focusStopId: null })

/** The one way the Auftrags-Editor changes (pure – the page's reducer). */
export function changeAuftragsEditor(editor: AuftragsEditor, change: AuftragsEditorChange): AuftragsEditor {
  switch (change.type) {
    case 'open': {
      if (editor.kind === 'route') return editor
      const groupId = editor.groupId ?? change.firstGroupId
      return groupId ? onRoute(groupId) : { kind: 'picking', groupId: null }
    }
    case 'close':
      return editor.kind === 'off' ? editor : { kind: 'off', groupId: editor.groupId }
    case 'pickGroup':
      if (editor.kind === 'off') return { kind: 'off', groupId: change.groupId }
      // Another Auftrag keeps «Stopp hinzufügen» and the focus as they were.
      return editor.kind === 'route' ? { ...editor, groupId: change.groupId } : onRoute(change.groupId)
    case 'addMode':
      return editor.kind === 'route' ? { ...editor, addMode: change.on } : editor
    case 'focusStop':
      return editor.kind === 'route' ? { ...editor, focusStopId: change.stopId } : editor
  }
}
