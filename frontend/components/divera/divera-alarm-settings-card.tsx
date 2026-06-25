"use client"

import { useEffect, useState } from "react"
import { Siren, Loader2 } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { apiClient } from "@/lib/api-client"
import type { ApiDiveraMemberPreview } from "@/lib/api/types"
import { toast } from "sonner"

const ENABLED_KEY = "divera.alarm_enabled"
const TITLE_KEY = "divera.alarm_title_template"
const TEXT_KEY = "divera.alarm_text_template"
// Keep in sync with DEFAULT_SETTINGS (backend) / DEFAULT_ALARM_* in api/divera.py.
const DEFAULT_TITLE = "KP-Rück: {title}"
const DEFAULT_TEXT = "Alarm – {title} ({location})"

interface Props {
  settings: Record<string, string>
  serverSettings: Record<string, string>
  setSettings: React.Dispatch<React.SetStateAction<Record<string, string>>>
  updateSetting: (key: string, value: string) => void | Promise<void>
  isEditor: boolean
  saving: string | null
}

export function DiveraAlarmSettingsCard({
  settings,
  serverSettings,
  setSettings,
  updateSetting,
  isEditor,
  saving,
}: Props) {
  const enabled = settings[ENABLED_KEY] === "true"

  const templateFields = [
    {
      key: TITLE_KEY,
      label: "Stichwort (Titel)",
      hint: "Push-Titel. Kurz halten — erscheint als Stichwort.",
      fallback: DEFAULT_TITLE,
      rows: 2,
    },
    {
      key: TEXT_KEY,
      label: "Alarmtext",
      hint: "Push-Text mit den Einsatzdetails.",
      fallback: DEFAULT_TEXT,
      rows: 3,
    },
  ]

  // Divera members for the test-alarm recipient picker (live from Divera, so the
  // test works even before any local personnel are linked).
  const [members, setMembers] = useState<ApiDiveraMemberPreview[]>([])
  const [membersError, setMembersError] = useState(false)
  const [testId, setTestId] = useState<string>("")
  const [isTesting, setIsTesting] = useState(false)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    apiClient
      .getDiveraMembers()
      .then((list) => {
        if (!cancelled) setMembers(list)
      })
      .catch(() => {
        if (!cancelled) setMembersError(true)
      })
    return () => {
      cancelled = true
    }
  }, [enabled])

  const handleTest = async () => {
    const member = members.find((m) => String(m.divera_id) === testId)
    if (!member) {
      toast.error("Bitte eine Person auswählen")
      return
    }
    setIsTesting(true)
    try {
      const result = await apiClient.sendDiveraTestAlarm(member.divera_id, member.name)
      if (result.success) {
        toast.success(`Testalarm gesendet an ${member.name}`)
      } else {
        toast.error(result.error || "Testalarm fehlgeschlagen")
      }
    } catch {
      // request() surfaces gating/network errors itself.
    } finally {
      setIsTesting(false)
    }
  }

  return (
    <Card className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-medium flex items-center gap-2">
            <Siren className="h-4 w-4 text-primary" />
            Divera-Ausalarmierung
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            Schickt beim Disponieren einen Divera-Push-Alarm an die zugewiesenen, mit Divera
            verknüpften Personen. Die Nachricht wird aus dem Einsatz erzeugt (Typ als Stichwort,
            Details als Text). Benötigt einen Divera-Zugangsschlüssel; Personen werden über den
            Member-Sync verknüpft.
          </p>
        </div>
        <Switch
          checked={enabled}
          disabled={!isEditor || saving === ENABLED_KEY}
          onCheckedChange={(v) => updateSetting(ENABLED_KEY, v ? "true" : "false")}
        />
      </div>

      {enabled && (
        <div className="space-y-4">
          <div>
            <Label className="font-medium">Vorlagen</Label>
            <p className="text-xs text-muted-foreground mt-1">
              Titel und Text werden beim Disponieren aus dem Einsatz erzeugt. Platzhalter:{" "}
              <code className="font-mono">{"{title}"}</code>,{" "}
              <code className="font-mono">{"{type}"}</code>,{" "}
              <code className="font-mono">{"{location}"}</code>,{" "}
              <code className="font-mono">{"{priority}"}</code>.
            </p>
          </div>
          {templateFields.map((field) => {
            const value = settings[field.key] !== undefined ? settings[field.key] : field.fallback
            const isCurrentlySaving = saving === field.key
            return (
              <div key={field.key} className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label className="font-medium">{field.label}</Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-muted-foreground"
                    disabled={!isEditor || isCurrentlySaving || value === field.fallback}
                    onClick={() => updateSetting(field.key, field.fallback)}
                  >
                    Zurücksetzen
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">{field.hint}</p>
                <Textarea
                  value={value}
                  rows={field.rows}
                  className="font-mono text-xs"
                  onChange={(e) =>
                    setSettings((prev) => ({ ...prev, [field.key]: e.target.value }))
                  }
                  onBlur={(e) => {
                    if (e.target.value !== (serverSettings[field.key] ?? field.fallback)) {
                      updateSetting(field.key, e.target.value)
                    }
                  }}
                  disabled={!isEditor || isCurrentlySaving}
                />
              </div>
            )
          })}
        </div>
      )}

      {enabled && (
        <div className="space-y-1.5">
          <Label className="font-medium">Testalarm</Label>
          <p className="text-xs text-muted-foreground">
            Sendet einen Push-Testalarm an eine einzelne Divera-Person (zur Verbindungsprüfung).
          </p>
          {membersError ? (
            <p className="text-sm text-destructive">
              Divera-Mitglieder konnten nicht geladen werden (Zugangsschlüssel prüfen).
            </p>
          ) : (
            <div className="flex items-center gap-2">
              <Select value={testId} onValueChange={setTestId} disabled={!isEditor}>
                <SelectTrigger className="flex-1">
                  <SelectValue
                    placeholder={members.length ? "Person wählen…" : "Lade Divera-Mitglieder…"}
                  />
                </SelectTrigger>
                <SelectContent>
                  {members.map((m) => (
                    <SelectItem key={m.divera_id} value={String(m.divera_id)}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button onClick={handleTest} disabled={!isEditor || isTesting || !testId}>
                {isTesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Siren className="h-4 w-4" />}
                Testalarm senden
              </Button>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
