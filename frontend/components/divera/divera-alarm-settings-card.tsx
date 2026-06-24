"use client"

import { useEffect, useState } from "react"
import { Siren, Loader2 } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { apiClient } from "@/lib/api-client"
import type { ApiPersonnel } from "@/lib/api/types"
import { toast } from "sonner"

const ENABLED_KEY = "divera.alarm_enabled"
const TITLE_KEY = "divera.alarm_title_template"
const TEXT_KEY = "divera.alarm_text_template"
const DEFAULT_TITLE = "KP-Rück: {title}"
const DEFAULT_TEXT = "Alarm – {title} ({location})"

const CHANNEL_FIELDS = [
  { key: "divera.send_push", label: "Push" },
  { key: "divera.send_sms", label: "SMS" },
  { key: "divera.send_call", label: "Anruf" },
  { key: "divera.send_mail", label: "E-Mail" },
] as const

interface Props {
  settings: Record<string, string>
  setSettings: React.Dispatch<React.SetStateAction<Record<string, string>>>
  serverSettings: Record<string, string>
  updateSetting: (key: string, value: string) => void | Promise<void>
  isEditor: boolean
  saving: string | null
}

export function DiveraAlarmSettingsCard({
  settings,
  setSettings,
  serverSettings,
  updateSetting,
  isEditor,
  saving,
}: Props) {
  const enabled = settings[ENABLED_KEY] === "true"

  // Linked personnel for the test-alarm recipient picker.
  const [linkedPersonnel, setLinkedPersonnel] = useState<ApiPersonnel[]>([])
  const [testPersonId, setTestPersonId] = useState<string>("")
  const [isTesting, setIsTesting] = useState(false)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    apiClient
      .getAllPersonnel()
      .then((people) => {
        if (cancelled) return
        setLinkedPersonnel(people.filter((p) => p.divera_user_id))
      })
      .catch(() => {
        /* ignore — picker just stays empty */
      })
    return () => {
      cancelled = true
    }
  }, [enabled])

  const handleTest = async () => {
    if (!testPersonId) {
      toast.error("Bitte eine Person auswählen")
      return
    }
    setIsTesting(true)
    try {
      const result = await apiClient.sendDiveraTestAlarm(testPersonId)
      if (result.success) {
        toast.success(`Testalarm gesendet an ${result.sent[0]?.name ?? "Person"}`)
      } else {
        toast.error(result.error || "Testalarm fehlgeschlagen")
      }
    } catch {
      // request() surfaces gating/network errors itself.
    } finally {
      setIsTesting(false)
    }
  }

  const templateFields = [
    { key: TITLE_KEY, label: "Titel-Vorlage", fallback: DEFAULT_TITLE, rows: 1 },
    { key: TEXT_KEY, label: "Text-Vorlage", fallback: DEFAULT_TEXT, rows: 2 },
  ]

  return (
    <Card className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-medium flex items-center gap-2">
            <Siren className="h-4 w-4 text-primary" />
            Divera-Ausalarmierung
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            Sendet beim Disponieren einen Divera-Alarm an die zugewiesenen, mit Divera verknüpften
            Personen. Benötigt einen konfigurierten Divera-Zugangsschlüssel. Standardmässig aus.
          </p>
        </div>
        <Switch
          checked={enabled}
          disabled={!isEditor || saving === ENABLED_KEY}
          onCheckedChange={(v) => updateSetting(ENABLED_KEY, v ? "true" : "false")}
        />
      </div>

      {enabled && (
        <>
          {/* Message templates */}
          {templateFields.map((field) => {
            const value = settings[field.key] !== undefined ? settings[field.key] : field.fallback
            return (
              <div key={field.key} className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label className="font-medium">{field.label}</Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-muted-foreground"
                    disabled={!isEditor || saving === field.key || value === field.fallback}
                    onClick={() => updateSetting(field.key, field.fallback)}
                  >
                    Zurücksetzen
                  </Button>
                </div>
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
                  disabled={!isEditor || saving === field.key}
                />
              </div>
            )
          })}
          <p className="text-xs text-muted-foreground">
            Platzhalter: <code>{"{title}"}</code> <code>{"{type}"}</code>{" "}
            <code>{"{location}"}</code> <code>{"{priority}"}</code>
          </p>

          {/* Default channels */}
          <div className="space-y-1.5">
            <Label className="font-medium">Standard-Kanäle</Label>
            <div className="flex flex-wrap gap-3">
              {CHANNEL_FIELDS.map((c) => {
                // Push defaults to on; others off.
                const fallback = c.key === "divera.send_push"
                const checked =
                  settings[c.key] !== undefined ? settings[c.key] === "true" : fallback
                return (
                  <label key={c.key} className="flex items-center gap-1.5 text-sm">
                    <Checkbox
                      checked={checked}
                      disabled={!isEditor || saving === c.key}
                      onCheckedChange={(v) => updateSetting(c.key, v ? "true" : "false")}
                    />
                    {c.label}
                  </label>
                )
              })}
            </div>
          </div>

          {/* Test alarm to a single selectable person */}
          <div className="space-y-1.5 border-t pt-4">
            <Label className="font-medium">Testalarm</Label>
            <p className="text-xs text-muted-foreground">
              Sendet einen Push-Testalarm an eine einzelne, mit Divera verknüpfte Person.
            </p>
            <div className="flex items-center gap-2">
              <Select value={testPersonId} onValueChange={setTestPersonId} disabled={!isEditor}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Person wählen…" />
                </SelectTrigger>
                <SelectContent>
                  {linkedPersonnel.length === 0 ? (
                    <SelectItem value="__none" disabled>
                      Keine verknüpften Personen
                    </SelectItem>
                  ) : (
                    linkedPersonnel.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <Button onClick={handleTest} disabled={!isEditor || isTesting || !testPersonId}>
                {isTesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Siren className="h-4 w-4" />}
                Testalarm senden
              </Button>
            </div>
          </div>
        </>
      )}
    </Card>
  )
}
