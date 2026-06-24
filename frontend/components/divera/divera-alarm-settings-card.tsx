"use client"

import { useEffect, useState } from "react"
import { Siren, Loader2 } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
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

interface Props {
  settings: Record<string, string>
  updateSetting: (key: string, value: string) => void | Promise<void>
  isEditor: boolean
  saving: string | null
}

export function DiveraAlarmSettingsCard({ settings, updateSetting, isEditor, saving }: Props) {
  const enabled = settings[ENABLED_KEY] === "true"

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
        <div className="space-y-1.5 border-t pt-4">
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
