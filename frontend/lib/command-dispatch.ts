/**
 * Type-to-dispatch for the ⌘K palette — the pure half.
 *
 * `14 tlf muster` assigns the TLF and Muster to Einsatz 14; `14 einsatz` moves it
 * to «Im Einsatz»; `14 hoch` sets the priority; `meier` alone jumps to the person,
 * `tlf` to the vehicle, `14` opens the Einsatz. Spaces only — no `+`, `>` or `!`:
 * a special character costs a second finger at 3am (owner, R4). They are still
 * accepted as separators, so a muscle memory from the first mockup does no harm.
 *
 * The rules, so the preview can be trusted:
 * - A leading number is the Einsatz. Everything after it, in any order, is a
 *   person, vehicle, Gerät, status word (de + fr) or priority word.
 * - Names match first name, last name or both (any order), by prefix, with one
 *   typo forgiven from four letters on, ignoring case and diacritics
 *   (`muller`, `mueller` and `Müller` are the same word).
 * - The best match wins only when it is the ONLY best match. Two equally good
 *   candidates make the token ambiguous: the preview lists them and nothing
 *   runs until one is picked (`picks`). It never guesses between people.
 *   The one exception is a Gerät: units of the same name are interchangeable,
 *   so «tauchpumpe» takes a free one.
 * - A token nothing matches is shown greyed and ignored.
 *
 * Nothing here touches the board. `parseDispatch` turns text into a plan; the
 * palette renders the plan; the board runs it on ↵ through the same assignment
 * paths a drag uses (`lib/hooks/use-command-dispatch.ts`).
 */

export type DispatchStatus = "incoming" | "reko" | "reko_done" | "enroute" | "active" | "returning" | "complete"
export type DispatchPriority = "low" | "medium" | "high"

export interface DispatchIncident {
  id: string
  number: number
  /** Short label for the chip («Bachweg 3»). */
  label: string
  status: DispatchStatus
  priority: DispatchPriority
}

interface ResourceEntry {
  id: string
  name: string
  /** Second line of a choice («Maschinist», «Depot Nord»). */
  detail?: string
  /** Einsätze the resource is on right now — for «schon da» / «auf 12». */
  incidentIds?: string[]
}

export interface DispatchVocabulary {
  incidents: DispatchIncident[]
  persons: ResourceEntry[]
  vehicles: (ResourceEntry & { type?: string; callSign?: string; outOfService?: boolean })[]
  materials: (ResourceEntry & { outOfService?: boolean; available?: boolean })[]
}

export type DispatchResource =
  | { kind: "person"; id: string; name: string; detail?: string; incidentIds: string[] }
  | { kind: "vehicle"; id: string; name: string; detail?: string; incidentIds: string[]; outOfService: boolean }
  | { kind: "material"; id: string; name: string; detail?: string; incidentIds: string[]; outOfService: boolean }

export type DispatchTarget =
  | DispatchResource
  | { kind: "status"; status: DispatchStatus }
  | { kind: "priority"; priority: DispatchPriority }

export type DispatchTokenState =
  /** The Einsatz number. */
  | "incident"
  | "match"
  | "ambiguous"
  | "unknown"
  /** Recognised, but not used: a second status word, a status without an Einsatz… */
  | "ignored"
  /** «im», «en» — words of a status phrase nobody needs to type. */
  | "filler"

export interface DispatchToken {
  /** As typed (one token, or the words of a multi-word name joined by a space). */
  text: string
  /** Offsets into the input. */
  start: number
  end: number
  state: DispatchTokenState
  target?: DispatchTarget
  incident?: DispatchIncident
  /** For `ambiguous`: the equally good candidates, best first. */
  choices?: DispatchTarget[]
  /** The key a pick for this token is stored under (`picks`). */
  pickKey: string
  /** For `match`: every word typed in full (no prefix, no typo). */
  exact?: boolean
}

export interface PlannedResource {
  target: DispatchResource
  /** Already on this Einsatz — ↵ leaves it alone. */
  alreadyHere: boolean
  /** Numbers of the OTHER Einsätze it is on now (the conflict prompt will ask). */
  elsewhere: number[]
}

export type DispatchPlan =
  /** Nothing recognisable — the palette's ordinary list does its job. */
  | { kind: "none" }
  | { kind: "open"; incident: DispatchIncident }
  | { kind: "jump"; target: DispatchResource; exact: boolean }
  | {
      kind: "dispatch"
      incident: DispatchIncident
      assign: PlannedResource[]
      /** Only when it differs from the current one. */
      status: DispatchStatus | null
      priority: DispatchPriority | null
      /** True when ↵ would change nothing (everything already so). */
      noop: boolean
    }
  | { kind: "blocked"; reason: "ambiguous"; incident: DispatchIncident | null }
  | { kind: "blocked"; reason: "unknown-incident"; number: number }
  /** Several things, or a status word, but no Einsatz number to apply them to. */
  | { kind: "blocked"; reason: "needs-incident" }

export interface ParsedDispatch {
  tokens: DispatchToken[]
  plan: DispatchPlan
}

/** `targetKey(target)` → the chosen candidate, per `DispatchToken.pickKey`. */
export type DispatchPicks = Record<string, string>

// ---------------------------------------------------------------------------
// Vocabulary of the board itself: status and priority words, de + fr.
// Both languages are accepted whatever the UI language is — the words cannot
// collide in a harmful way, and a bilingual KP should not have to switch.
// The column labels of both catalogues are covered (command-dispatch.test.ts).

const STATUS_PHRASES: Record<DispatchStatus, string[]> = {
  incoming: ["eingegangen", "eingang", "neu", "reçu", "nouveau"],
  reko: ["reko", "reconnaissance", "reco"],
  reko_done: [
    "reko abgeschlossen",
    "reko fertig",
    "rekofertig",
    "reko done",
    "reconnaissance terminée",
    "reco terminée",
  ],
  enroute: ["disponiert", "anfahrt", "unterwegs", "engagé", "en route"],
  active: ["im einsatz", "einsatz", "en intervention", "intervention"],
  returning: ["beendet", "rückfahrt", "terminé", "retour"],
  complete: ["abgeschlossen", "erledigt", "clôturé", "fermé"],
}

const PRIORITY_PHRASES: Record<DispatchPriority, string[]> = {
  high: ["hoch", "high", "dringend", "haute", "élevée", "urgent"],
  medium: ["mittel", "normal", "medium", "moyenne"],
  low: ["niedrig", "tief", "low", "basse", "faible"],
}

/** Words inside a phrase that nobody needs to type («im Einsatz», «en route»). */
const FILLER_WORDS = new Set(["im", "en", "in", "/"])

// ---------------------------------------------------------------------------
// Text folding

/** Lower case, no diacritics, ß → ss. «Müller» → «muller». */
export function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
}

/** The German transcription as a second spelling: «Müller» → «mueller». */
function foldTranscribed(text: string): string {
  return fold(text.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue"))
}

function splitWords(text: string): string[] {
  return text
    .split(/[\s\-./,()]+/)
    .map((word) => word.trim())
    .filter(Boolean)
}

/** One spelling set per word: plain fold plus the transcription when it differs. */
type Word = string[]

function toWords(text: string): Word[] {
  return splitWords(text).map((raw) => {
    const plain = fold(raw)
    const transcribed = foldTranscribed(raw)
    return plain === transcribed ? [plain] : [plain, transcribed]
  })
}

// ---------------------------------------------------------------------------
// Matching

/** 3 = the whole word, 2 = a prefix, 1 = a prefix with one typo, 0 = no. */
type Level = 0 | 1 | 2 | 3

/** Optimal string alignment distance, capped — small strings only. */
function editDistance(a: string, b: string): number {
  const rows = a.length + 1
  const cols = b.length + 1
  const d: number[][] = Array.from({ length: rows }, (_, i) => {
    const row = new Array<number>(cols).fill(0)
    row[0] = i
    return row
  })
  for (let j = 0; j < cols; j++) d[0][j] = j
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
      }
    }
  }
  return d[rows - 1][cols - 1]
}

function wordLevel(token: string, word: Word): Level {
  let best: Level = 0
  for (const spelling of word) {
    if (spelling === token) return 3
    if (token.length >= 2 && spelling.startsWith(token)) best = 2
    else if (best < 1 && token.length >= 4 && !/^\d+$/.test(token)) {
      // One slip, against the whole word or against its first letters
      // («mustr» → «muster», «tlff» → «tlf», «schnieder» → «schneider»).
      const whole = editDistance(token, spelling) <= 1
      const head =
        spelling.length > token.length && editDistance(token, spelling.slice(0, token.length)) <= 1
      if (whole || head) best = 1
    }
  }
  return best
}

interface AliasMatch {
  /** Lowest level over the span's tokens — one sloppy token makes a sloppy match. */
  min: Level
  sum: number
  /** Every (non-filler) word of the alias was matched: «reko» IS «Reko». */
  complete: boolean
}

/**
 * Match a span of tokens against one alias (a name split into words): every
 * token must land on a different word, in any order. Small sets, so the
 * assignment is found by plain search.
 */
function matchAlias(tokens: string[], alias: Word[]): AliasMatch | null {
  if (tokens.length > alias.length) return null
  const levels = tokens.map((token) => alias.map((word) => wordLevel(token, word)))
  let best: { min: number; sum: number; used: Set<number> } | null = null
  const used = new Set<number>()
  const walk = (index: number, min: number, sum: number) => {
    if (index === tokens.length) {
      if (!best || min > best.min || (min === best.min && sum > best.sum)) {
        best = { min, sum, used: new Set(used) }
      }
      return
    }
    for (let w = 0; w < alias.length; w++) {
      const level = levels[index][w]
      if (level === 0 || used.has(w)) continue
      used.add(w)
      walk(index + 1, Math.min(min, level), sum + level)
      used.delete(w)
    }
  }
  walk(0, 3, 0)
  if (!best) return null
  const found = best as { min: number; sum: number; used: Set<number> }
  const complete = alias.every((word, w) => found.used.has(w) || FILLER_WORDS.has(word[0]))
  return { min: found.min as Level, sum: found.sum, complete }
}

function better(a: AliasMatch, b: AliasMatch): number {
  if (a.min !== b.min) return a.min - b.min
  if (a.complete !== b.complete) return a.complete ? 1 : -1
  return a.sum - b.sum
}

// ---------------------------------------------------------------------------
// Candidates

interface Candidate {
  target: DispatchTarget
  aliases: Word[][]
  /** Gerät only: interchangeable units share this; a free one is preferred. */
  bundle?: string
  available?: boolean
}

export function targetKey(target: DispatchTarget): string {
  switch (target.kind) {
    case "status":
      return `status:${target.status}`
    case "priority":
      return `priority:${target.priority}`
    default:
      return `${target.kind}:${target.id}`
  }
}

function buildCandidates(vocabulary: DispatchVocabulary): Candidate[] {
  const candidates: Candidate[] = []
  for (const person of vocabulary.persons) {
    candidates.push({
      target: { kind: "person", id: person.id, name: person.name, detail: person.detail, incidentIds: person.incidentIds ?? [] },
      aliases: [toWords(person.name)],
    })
  }
  for (const vehicle of vocabulary.vehicles) {
    const aliases = [toWords(vehicle.name)]
    // «tlf1» for «TLF 1», the type («TLF») and the radio call sign («Omega 1»).
    const compact = vehicle.name.replace(/[\s\-./]+/g, "")
    if (compact !== vehicle.name) aliases.push(toWords(compact))
    if (vehicle.type && fold(vehicle.type) !== fold(vehicle.name)) aliases.push(toWords(vehicle.type))
    if (vehicle.callSign) aliases.push(toWords(vehicle.callSign))
    candidates.push({
      target: {
        kind: "vehicle",
        id: vehicle.id,
        name: vehicle.name,
        detail: vehicle.detail,
        incidentIds: vehicle.incidentIds ?? [],
        outOfService: !!vehicle.outOfService,
      },
      aliases,
    })
  }
  for (const material of vocabulary.materials) {
    candidates.push({
      target: {
        kind: "material",
        id: material.id,
        name: material.name,
        detail: material.detail,
        incidentIds: material.incidentIds ?? [],
        outOfService: !!material.outOfService,
      },
      aliases: [toWords(material.name)],
      bundle: fold(material.name),
      available: material.available !== false && !material.outOfService,
    })
  }
  for (const [status, phrases] of Object.entries(STATUS_PHRASES) as [DispatchStatus, string[]][]) {
    candidates.push({ target: { kind: "status", status }, aliases: phrases.map(toWords) })
  }
  for (const [priority, phrases] of Object.entries(PRIORITY_PHRASES) as [DispatchPriority, string[]][]) {
    candidates.push({ target: { kind: "priority", priority }, aliases: phrases.map(toWords) })
  }
  return candidates
}

interface Ranked {
  candidate: Candidate
  match: AliasMatch
}

function rank(tokens: string[], candidates: Candidate[]): Ranked[] {
  const ranked: Ranked[] = []
  for (const candidate of candidates) {
    let best: AliasMatch | null = null
    for (const alias of candidate.aliases) {
      const match = matchAlias(tokens, alias)
      if (match && (!best || better(match, best) > 0)) best = match
    }
    // A multi-word span must be clean: «meier tlf» never becomes one person
    // through a typo allowance on the second word.
    if (best && (tokens.length === 1 || best.min >= 2)) ranked.push({ candidate, match: best })
  }
  return ranked.sort((a, b) => better(b.match, a.match))
}

/** The equally best candidates — one means a match, several mean «which one?». */
function topTier(ranked: Ranked[]): Ranked[] {
  if (ranked.length === 0) return []
  const top = ranked.filter((entry) => better(entry.match, ranked[0].match) === 0)
  // Interchangeable Geräte: one tier of identically named units is ONE answer —
  // a free unit when there is one.
  const bundles = new Set(top.map((entry) => entry.candidate.bundle))
  if (top.length > 1 && bundles.size === 1 && top[0].candidate.bundle !== undefined) {
    return [top.find((entry) => entry.candidate.available) ?? top[0]]
  }
  return top
}

// ---------------------------------------------------------------------------
// Parsing

const SEPARATORS = /[\s+>!,;]+/g
const MAX_SPAN = 3

interface RawToken {
  text: string
  folded: string
  start: number
  end: number
}

function tokenize(input: string): RawToken[] {
  const tokens: RawToken[] = []
  let cursor = 0
  for (const part of input.split(SEPARATORS)) {
    if (!part) continue
    const start = input.indexOf(part, cursor)
    cursor = start + part.length
    tokens.push({ text: part, folded: fold(part), start, end: cursor })
  }
  return tokens
}

function incidentNumber(token: RawToken): number | null {
  const match = /^#?(\d{1,6})$/.exec(token.folded)
  return match ? Number(match[1]) : null
}

function isResource(target: DispatchTarget | undefined): target is DispatchResource {
  return !!target && (target.kind === "person" || target.kind === "vehicle" || target.kind === "material")
}

export function parseDispatch(
  input: string,
  vocabulary: DispatchVocabulary,
  picks: DispatchPicks = {},
): ParsedDispatch {
  const raw = tokenize(input)
  if (raw.length === 0) return { tokens: [], plan: { kind: "none" } }

  const candidates = buildCandidates(vocabulary)
  const byKey = new Map(candidates.map((candidate) => [targetKey(candidate.target), candidate]))
  const incidentsByNumber = new Map<number, DispatchIncident[]>()
  for (const incident of vocabulary.incidents) {
    incidentsByNumber.set(incident.number, [...(incidentsByNumber.get(incident.number) ?? []), incident])
  }

  const tokens: DispatchToken[] = []
  let incident: DispatchIncident | null = null
  let unknownNumber: number | null = null
  let index = 0

  const takeIncident = (token: RawToken, number: number): boolean => {
    const found = incidentsByNumber.get(number) ?? []
    if (found.length === 0) return false
    tokens.push({
      text: token.text,
      start: token.start,
      end: token.end,
      // Two Einsätze with one number cannot happen through the trigger; if a
      // restore ever produced it, the number is ambiguous rather than a guess.
      state: found.length === 1 ? "incident" : "ambiguous",
      incident: found.length === 1 ? found[0] : undefined,
      pickKey: `#${number}`,
    })
    if (found.length === 1) incident = found[0]
    return true
  }

  // A leading number is always the Einsatz — the documented grammar stays
  // predictable even where a vehicle is called «118».
  const leading = incidentNumber(raw[0])
  if (leading !== null) {
    if (!takeIncident(raw[0], leading)) {
      unknownNumber = leading
      tokens.push({ text: raw[0].text, start: raw[0].start, end: raw[0].end, state: "unknown", pickKey: `#${leading}` })
    }
    index = 1
  }

  while (index < raw.length) {
    let consumed = 0
    for (let span = Math.min(MAX_SPAN, raw.length - index); span >= 1; span--) {
      const slice = raw.slice(index, index + span)
      const words = slice.map((token) => token.folded)
      // «im» / «en» on their own are glue, not a (half) status word.
      if (span === 1 && FILLER_WORDS.has(words[0])) continue
      const ranked = rank(words, candidates)
      if (ranked.length === 0) continue

      const pickKey = words.join(" ")
      const token: DispatchToken = {
        text: slice.map((t) => t.text).join(" "),
        start: slice[0].start,
        end: slice[slice.length - 1].end,
        state: "match",
        pickKey,
      }
      const picked = picks[pickKey] ? byKey.get(picks[pickKey]) : undefined
      const tier = topTier(ranked)
      const pickedEntry = picked ? ranked.find((entry) => entry.candidate === picked) : undefined
      if (pickedEntry) {
        token.target = pickedEntry.candidate.target
        token.exact = pickedEntry.match.min === 3
      } else if (tier.length === 1) {
        token.target = tier[0].candidate.target
        token.exact = tier[0].match.min === 3
      } else {
        token.state = "ambiguous"
        token.choices = tier.slice(0, 8).map((entry) => entry.candidate.target)
      }
      tokens.push(token)
      consumed = span
      break
    }
    if (consumed === 0) {
      const token = raw[index]
      const number = incidentNumber(token)
      if (number !== null && !incident && takeIncident(token, number)) {
        // «tlf 14» — a number nothing else claimed is the Einsatz after all.
      } else if (FILLER_WORDS.has(token.folded)) {
        tokens.push({ text: token.text, start: token.start, end: token.end, state: "filler", pickKey: token.folded })
      } else {
        tokens.push({ text: token.text, start: token.start, end: token.end, state: "unknown", pickKey: token.folded })
      }
      consumed = 1
    }
    index += consumed
  }

  return { tokens, plan: plan(tokens, incident, unknownNumber, vocabulary) }
}

function plan(
  tokens: DispatchToken[],
  incident: DispatchIncident | null,
  unknownNumber: number | null,
  vocabulary: DispatchVocabulary,
): DispatchPlan {
  if (unknownNumber !== null) return { kind: "blocked", reason: "unknown-incident", number: unknownNumber }

  const recognised = tokens.filter((token) => token.state === "match" || token.state === "ambiguous")
  if (tokens.some((token) => token.state === "ambiguous")) {
    return { kind: "blocked", reason: "ambiguous", incident }
  }

  if (!incident) {
    if (recognised.length === 0) return { kind: "none" }
    const resources = recognised.filter((token) => isResource(token.target))
    if (recognised.length === 1 && resources.length === 1) {
      return { kind: "jump", target: resources[0].target as DispatchResource, exact: !!resources[0].exact }
    }
    return { kind: "blocked", reason: "needs-incident" }
  }

  if (recognised.length === 0) return { kind: "open", incident }

  const numbers = new Map(vocabulary.incidents.map((entry) => [entry.id, entry.number]))
  const assign: PlannedResource[] = []
  const seen = new Set<string>()
  let status: DispatchStatus | null = null
  let priority: DispatchPriority | null = null
  let statusToken: DispatchToken | null = null
  let priorityToken: DispatchToken | null = null

  for (const token of recognised) {
    const target = token.target
    if (!target) continue
    if (isResource(target)) {
      const key = targetKey(target)
      if (seen.has(key)) {
        token.state = "ignored"
        continue
      }
      seen.add(key)
      assign.push({
        target,
        alreadyHere: target.incidentIds.includes(incident.id),
        elsewhere: target.incidentIds
          .filter((id) => id !== incident!.id)
          .map((id) => numbers.get(id))
          .filter((n): n is number => typeof n === "number")
          .sort((a, b) => a - b),
      })
    } else if (target.kind === "status") {
      // One status per command: the last word counts, an earlier one is greyed.
      if (statusToken) statusToken.state = "ignored"
      statusToken = token
      status = target.status
    } else {
      if (priorityToken) priorityToken.state = "ignored"
      priorityToken = token
      priority = target.priority
    }
  }

  const statusChange = status !== null && status !== incident.status ? status : null
  const priorityChange = priority !== null && priority !== incident.priority ? priority : null
  const noop = statusChange === null && priorityChange === null && assign.every((entry) => entry.alreadyHere)
  return { kind: "dispatch", incident, assign, status: statusChange, priority: priorityChange, noop }
}

/** Exposed for the vocabulary coverage test. */
export const DISPATCH_STATUS_PHRASES = STATUS_PHRASES
export const DISPATCH_PRIORITY_PHRASES = PRIORITY_PHRASES
