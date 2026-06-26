"use client"

import { Satellite, AlertTriangle } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"

const MASTER_KEY = "gps.automation_enabled"
const ARRIVAL_KEY = "gps.rule_arrival_enabled"
const ARRIVAL_SILENT_KEY = "gps.rule_arrival_silent"
const RETURN_KEY = "gps.rule_return_enabled"
const STATION_LAT_KEY = "gps.station_lat"
const STATION_LNG_KEY = "gps.station_lng"
const STATION_RADIUS_KEY = "gps.station_radius_meters"
const ARRIVAL_RADIUS_KEY = "geofence_radius_meters"
const DEBOUNCE_KEY = "gps.debounce_count"
const FRESHNESS_KEY = "gps.freshness_seconds"
const SPEED_GATE_KEY = "gps.speed_gate_kmh"

interface Props {
  settings: Record<string, string>
  serverSettings: Record<string, string>
  setSettings: React.Dispatch<React.SetStateAction<Record<string, string>>>
  updateSetting: (key: string, value: string) => void | Promise<void>
  isEditor: boolean
  saving: string | null
}

/**
 * GPS-Statusautomatik (Plan 10). Two opt-in rules behind a master switch (default off):
 *
 * - **Ankunft (Regel A):** when an assigned vehicle is confirmed at the incident
 *   location, the operator is PROMPTED to confirm disponiert -> einsatz (default).
 *   Silent auto-advance is an explicit, risky opt-in (`gps.rule_arrival_silent`).
 * - **Rückkehr (Regel B):** only PROMPTS the operator to release a vehicle when it is
 *   back in the magazin — never silent.
 *
 * Disabled in training events and demo mode. The card warns that auto-advance acts on GPS.
 */
export function GpsSettingsCard({
  settings,
  serverSettings,
  setSettings,
  updateSetting,
  isEditor,
  saving,
}: Props) {
  const enabled = settings[MASTER_KEY] === "true"

  const arrivalEnabled = settings[ARRIVAL_KEY] === "true"

  // Default fallbacks for every numeric key (used when the setting is unset).
  const NUMBER_FALLBACKS: Record<string, string> = {
    [STATION_RADIUS_KEY]: "100",
    [ARRIVAL_RADIUS_KEY]: "200",
    [DEBOUNCE_KEY]: "3",
    [FRESHNESS_KEY]: "60",
    [SPEED_GATE_KEY]: "5",
  }

  const tuningFields = [
    {
      key: DEBOUNCE_KEY,
      label: "Bestätigende Messungen",
      hint: "Anzahl aufeinanderfolgender gültiger GPS-Messungen, bevor eine Regel auslöst (gegen GPS-Zittern). Empfohlen: 3.",
    },
    {
      key: FRESHNESS_KEY,
      label: "Aktualität (Sek.)",
      hint: "Ältere Messungen werden ignoriert und setzen den Zähler zurück. Gleichzeitig die Mindestdauer, die ein Fahrzeug vor Ort sein muss. Empfohlen: 60.",
    },
    {
      key: SPEED_GATE_KEY,
      label: "Geschwindigkeitsgrenze (km/h)",
      hint: "Nur unterhalb dieser Geschwindigkeit gilt ein Fahrzeug als stehend. Empfohlen: 5.",
    },
  ]

  const renderNumber = (key: string, fallback: string) => {
    const value = settings[key] !== undefined ? settings[key] : fallback
    const isCurrentlySaving = saving === key
    return (
      <Input
        type="number"
        value={value}
        className="w-32"
        onChange={(e) => setSettings((prev) => ({ ...prev, [key]: e.target.value }))}
        onBlur={(e) => {
          if (e.target.value !== (serverSettings[key] ?? fallback)) {
            updateSetting(key, e.target.value)
          }
        }}
        disabled={!isEditor || isCurrentlySaving}
      />
    )
  }

  const renderCoord = (key: string) => {
    const value = settings[key] ?? ""
    const isCurrentlySaving = saving === key
    return (
      <Input
        type="number"
        value={value}
        placeholder="z. B. 47.4983"
        className="w-44"
        step="any"
        onChange={(e) => setSettings((prev) => ({ ...prev, [key]: e.target.value }))}
        onBlur={(e) => {
          if (e.target.value !== (serverSettings[key] ?? "")) {
            updateSetting(key, e.target.value)
          }
        }}
        disabled={!isEditor || isCurrentlySaving}
      />
    )
  }

  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-medium flex items-center gap-2">
            <Satellite className="h-4 w-4 text-primary" />
            GPS-Statusautomatik
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            Schaltet zwei GPS-gestützte Regeln frei. <strong>Ankunft</strong> fragt nach, ob ein
            disponierter Einsatz auf <em>Einsatz</em> gesetzt werden soll, sobald ein zugewiesenes
            Fahrzeug am Einsatzort steht. <strong>Rückkehr</strong> fragt nach, ob ein Fahrzeug
            freigegeben werden soll, wenn es ins Magazin zurückkehrt – nie automatisch. In Übungen
            und im Demo-Modus inaktiv.
          </p>
        </div>
        <Switch
          checked={enabled}
          disabled={!isEditor || saving === MASTER_KEY}
          onCheckedChange={(v) => updateSetting(MASTER_KEY, v ? "true" : "false")}
        />
      </div>

      {enabled && (
        <div className="space-y-4">
          {/* Ankunft (Regel A) — confirm by default, silent is an opt-in */}
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <Label className="font-medium">Ankunft am Einsatzort</Label>
              <p className="text-xs text-muted-foreground">
                Fragt nach, ob ein disponierter Einsatz auf „Einsatz“ gesetzt werden soll, sobald
                ein zugewiesenes Fahrzeug am Einsatzort bestätigt ist.
              </p>
            </div>
            <Switch
              checked={arrivalEnabled}
              disabled={!isEditor || saving === ARRIVAL_KEY}
              onCheckedChange={(v) => updateSetting(ARRIVAL_KEY, v ? "true" : "false")}
            />
          </div>

          {arrivalEnabled && (
            <div className="ml-4 border-l pl-4 space-y-3">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <Label className="font-medium text-sm">Automatisch ohne Rückfrage</Label>
                  <p className="text-xs text-muted-foreground">
                    Setzt den Einsatz ohne Rückfrage automatisch auf „Einsatz“ – nur bei
                    zuverlässiger GPS-Abdeckung aktivieren.
                  </p>
                </div>
                <Switch
                  checked={settings[ARRIVAL_SILENT_KEY] === "true"}
                  disabled={!isEditor || saving === ARRIVAL_SILENT_KEY}
                  onCheckedChange={(v) => updateSetting(ARRIVAL_SILENT_KEY, v ? "true" : "false")}
                />
              </div>
              {settings[ARRIVAL_SILENT_KEY] === "true" && (
                <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                  <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                  <span>
                    Einsätze werden <strong>ohne Rückfrage</strong> anhand von GPS-Daten auf
                    „Einsatz“ gesetzt. GPS kann ungenau oder lückenhaft sein. Jede automatische
                    Statusänderung ist im Protokoll als „GPS-Automatik“ vermerkt und lässt sich
                    wie ein manueller Zug jederzeit rückgängig machen.
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Rückkehr (Regel B) — confirm only */}
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <Label className="font-medium">Magazin: Freigabe vorschlagen</Label>
              <p className="text-xs text-muted-foreground">
                Fragt nach, ob ein Fahrzeug freigegeben werden soll, wenn es ins Magazin
                zurückkehrt. Schliesst den Einsatz nie automatisch.
              </p>
            </div>
            <Switch
              checked={settings[RETURN_KEY] === "true"}
              disabled={!isEditor || saving === RETURN_KEY}
              onCheckedChange={(v) => updateSetting(RETURN_KEY, v ? "true" : "false")}
            />
          </div>

          {/* Magazin coordinates + radius */}
          <div className="border-t pt-4 space-y-3">
            <div>
              <Label className="font-medium">Magazin (Heimatbasis)</Label>
              <p className="text-xs text-muted-foreground">
                Koordinaten des Magazins für die Rückkehr-Regel (Dezimalgrad). Ohne Koordinaten
                ist die Rückkehr-Erkennung inaktiv.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Breite (lat)</Label>
                {renderCoord(STATION_LAT_KEY)}
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Länge (lng)</Label>
                {renderCoord(STATION_LNG_KEY)}
              </div>
            </div>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <Label className="font-medium text-sm">Magazinradius (m)</Label>
                <p className="text-xs text-muted-foreground">
                  Wie nah ein Fahrzeug dem Magazin sein muss, damit die Rückkehr erkannt wird. Eng
                  halten (z. B. 80–120 m), damit vorbeifahrende Fahrzeuge nicht auslösen.
                </p>
              </div>
              <div className="flex-shrink-0">
                {renderNumber(STATION_RADIUS_KEY, NUMBER_FALLBACKS[STATION_RADIUS_KEY])}
              </div>
            </div>
          </div>

          {/* Ankunftsradius (moved from Benachrichtigungen) — shared with Rule A */}
          <div className="border-t pt-4 space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <Label className="font-medium text-sm">Ankunftsradius (m)</Label>
                <p className="text-xs text-muted-foreground">
                  Entfernung zum Einsatzort, ab der ein Fahrzeug als angekommen gilt. Gilt für die
                  Ankunfts-Regel und die Geofence-Ankunftsmeldung.
                </p>
              </div>
              <div className="flex-shrink-0">
                {renderNumber(ARRIVAL_RADIUS_KEY, NUMBER_FALLBACKS[ARRIVAL_RADIUS_KEY])}
              </div>
            </div>
          </div>

          {/* Tuning constants */}
          <div className="border-t pt-4 space-y-3">
            <Label className="font-medium">Feineinstellungen</Label>
            {tuningFields.map((field) => (
              <div key={field.key} className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <Label className="font-medium text-sm">{field.label}</Label>
                  <p className="text-xs text-muted-foreground">{field.hint}</p>
                </div>
                <div className="flex-shrink-0">
                  {renderNumber(field.key, NUMBER_FALLBACKS[field.key])}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!isEditor && (
        <p className="text-xs text-muted-foreground">
          Nur Bearbeiter können diese Einstellungen ändern.
        </p>
      )}
    </Card>
  )
}
