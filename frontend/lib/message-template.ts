/**
 * Section-based message template engine.
 *
 * Shared by the WhatsApp and Divera incident-message formatters. A template is
 * plain multi-line text with `{token}` placeholders. The per-channel formatter
 * supplies the token *values* (a section's rendered content, e.g. the joined
 * vehicle list); the template controls the *order*, the surrounding emoji/labels,
 * and which sections appear. Reordering a message = moving token lines.
 *
 * Rendering rules:
 * - `{token}` is replaced by `values[token]` ("" when missing). Block tokens may
 *   themselves contain newlines, so one template line can expand to several.
 * - A line that contains at least one token and whose tokens ALL resolve empty is
 *   dropped — so "🚒 {vehicles}" disappears (emoji and all) when there are no
 *   vehicles, instead of leaving a dangling emoji.
 * - Token-less lines (static text, blank separators) are always kept.
 * - Runs of 2+ blank lines collapse to one; leading/trailing blanks are trimmed.
 */

const TOKEN_RE = /\{(\w+)\}/g

export function renderMessageTemplate(
  template: string,
  values: Record<string, string>,
): string {
  const out: string[] = []

  for (const line of template.split("\n")) {
    const tokens = [...line.matchAll(TOKEN_RE)]
    if (tokens.length === 0) {
      out.push(line)
      continue
    }
    // Drop the whole line when every token on it is empty.
    const allEmpty = tokens.every((m) => (values[m[1]] ?? "").length === 0)
    if (allEmpty) continue
    const replaced = line.replace(TOKEN_RE, (_, name) => values[name] ?? "")
    for (const expanded of replaced.split("\n")) out.push(expanded)
  }

  // Collapse consecutive blank lines, then trim leading/trailing blanks.
  const collapsed: string[] = []
  for (const line of out) {
    const blank = line.trim() === ""
    if (blank && (collapsed.length === 0 || collapsed[collapsed.length - 1].trim() === "")) {
      continue
    }
    collapsed.push(line)
  }
  while (collapsed.length && collapsed[collapsed.length - 1].trim() === "") collapsed.pop()

  return collapsed.join("\n")
}

// ── Template settings keys (stored in the settings DB so they sync) ──────────
// Keep the defaults below in sync with DEFAULT_SETTINGS in the backend
// (app/services/settings.py).
export const WHATSAPP_INCIDENT_TEMPLATE_KEY = "whatsapp.incident_template"
export const ALARM_TITLE_KEY = "alerting.title_template"
export const ALARM_TEXT_KEY = "alerting.text_template"

export const DEFAULT_WHATSAPP_INCIDENT_TEMPLATE = `🚨 *{type}*
📍 {location}
📝 {notes}
☎️ {contact}
📋 {internal_notes}

🚒 {vehicles}
👤 {crew}
🧰 {materials}

{reko}

_Erstellt: {timestamp}_`

export const DEFAULT_ALARM_TITLE_TEMPLATE = "KP: {type}"

export const DEFAULT_ALARM_TEXT_TEMPLATE = `📝 {notes}
☎️ {contact}
📋 {internal_notes}

🚒 {vehicles}
👤 {crew}
🧰 {materials}`

export interface MessageTemplates {
  whatsappIncident: string
  alarmTitle: string
  alarmText: string
}

/**
 * Fetch the (possibly customised) message templates from settings, falling back
 * to the defaults. One settings read per call — fine for user-triggered actions
 * (copy / send) and always fresh, so edits take effect immediately.
 */
export async function getMessageTemplates(): Promise<MessageTemplates> {
  let settings: Record<string, string> = {}
  try {
    const { apiClient } = await import("@/lib/api-client")
    settings = await apiClient.getAllSettings()
  } catch {
    // Offline / unauthorised — fall back to defaults below.
  }
  return {
    whatsappIncident: settings[WHATSAPP_INCIDENT_TEMPLATE_KEY] || DEFAULT_WHATSAPP_INCIDENT_TEMPLATE,
    alarmTitle: settings[ALARM_TITLE_KEY] || DEFAULT_ALARM_TITLE_TEMPLATE,
    alarmText: settings[ALARM_TEXT_KEY] || DEFAULT_ALARM_TEXT_TEMPLATE,
  }
}
