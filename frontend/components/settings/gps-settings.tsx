"use client"

import { Satellite, AlertTriangle } from "lucide-react"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { useIntegrationCapability } from "@/lib/hooks/use-integrations"
import { SettingUnavailableNote } from "@/components/settings/setting-unavailable"
import {
  SettingCard,
  SettingGroup,
  SettingRow,
} from "@/components/settings/setting-row"

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
const MIN_DWELL_KEY = "gps.min_dwell_seconds"
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
 *   back in the magazin — never silent. Needs the Magazin coordinates to measure against,
 *   so the switch is locked (with the reason) until they are set further down this card.
 *
 * Also active in training events; disabled in demo mode. The card warns that auto-advance acts on GPS.
 */
export function GpsSettingsCard({
  settings,
  serverSettings,
  setSettings,
  updateSetting,
  isEditor,
  saving,
}: Props) {
  const t = useTranslations("settings")
  const enabled = settings[MASTER_KEY] === "true"

  const arrivalEnabled = settings[ARRIVAL_KEY] === "true"

  // Die ganze Automatik läuft im Takt des Traccar-Abrufs: `gps_automation.py` wird aus
  // `traccar_poller` gerufen. Ohne hinterlegten Ortungsdienst kommt nie ein Vorschlag –
  // der Hauptschalter liess sich trotzdem umlegen und schwieg dann. Die Antwort kommt aus
  // der Fähigkeiten-Registratur (`GET /api/integrations`, Bereich `vehicles`); `null` heisst
  // «noch nicht beantwortet» und sperrt nichts, denn ein Schalter, der eine halbe Sekunde
  // nach dem Laden von selbst zufällt, ist schlimmer als einer, der eine Sekunde wartet.
  const trackerProvider = useIntegrationCapability("vehicles")
  const trackerMissing =
    trackerProvider !== null && !trackerProvider.configured ? t("gps.trackerUnavailable") : null

  // Regel B misst gegen die Magazin-Koordinaten. Fehlen sie, kehrt die Rückkehr-Prüfung
  // im Backend sofort um (`_check_return` in backend/app/services/gps_automation.py) –
  // der Schalter stünde auf «an» und es käme nie ein Vorschlag. Die Koordinaten wohnen in
  // **Allgemein** (firestation_*): dieselbe Frage stand hier ein zweites Mal als
  // gps.station_* und lief auseinander – wer die eine Hälfte ausfüllte, sah hier weiter
  // die Warnung. Der Abschnitt fragt nicht mehr selbst; ein Altbestand in gps.station_*
  // wird weiterhin gelesen (er gewinnt sogar, damit kein Geofence stillschweigend
  // umzieht – siehe get_station_coordinates im Backend).
  const legacyLat = Number.parseFloat(settings[STATION_LAT_KEY] ?? "")
  const legacyLng = Number.parseFloat(settings[STATION_LNG_KEY] ?? "")
  const generalLat = Number.parseFloat(settings.firestation_latitude ?? "")
  const generalLng = Number.parseFloat(settings.firestation_longitude ?? "")
  const effectiveCoords =
    Number.isFinite(legacyLat) && Number.isFinite(legacyLng)
      ? ([legacyLat, legacyLng] as const)
      : Number.isFinite(generalLat) && Number.isFinite(generalLng)
        ? ([generalLat, generalLng] as const)
        : null
  const stationConfigured = effectiveCoords !== null

  // Default fallbacks for every numeric key (used when the setting is unset).
  const NUMBER_FALLBACKS: Record<string, string> = {
    [STATION_RADIUS_KEY]: "100",
    [ARRIVAL_RADIUS_KEY]: "200",
    [DEBOUNCE_KEY]: "2",
    [FRESHNESS_KEY]: "180",
    [MIN_DWELL_KEY]: "10",
    [SPEED_GATE_KEY]: "10",
  }

  const tuningFields = [
    {
      key: DEBOUNCE_KEY,
      label: t("gps.tuning.debounce.label"),
      hint: t("gps.tuning.debounce.hint"),
    },
    {
      key: MIN_DWELL_KEY,
      label: t("gps.tuning.dwell.label"),
      hint: t("gps.tuning.dwell.hint"),
    },
    {
      key: FRESHNESS_KEY,
      label: t("gps.tuning.freshness.label"),
      hint: t("gps.tuning.freshness.hint"),
    },
    {
      key: SPEED_GATE_KEY,
      label: t("gps.tuning.speedGate.label"),
      hint: t("gps.tuning.speedGate.hint"),
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

  return (
    // Rules, radii and tuning constants are all rows in the shared settings table – the
    // automation runs in the backend, once, for everybody. Der Hauptschalter sitzt im
    // Kartenkopf, weil er die Karte selbst ein- und ausschaltet, nicht eine Zeile darin.
    <SettingCard
      title={
        <span className="flex items-center gap-2">
          <Satellite className="size-4 text-primary" />
          {t("gps.title")}
        </span>
      }
      subtitle={t.rich("gps.intro", {
        strong: (chunks) => <strong>{chunks}</strong>,
        em: (chunks) => <em>{chunks}</em>,
      })}
      action={
        <Switch
          aria-label={t("gps.title")}
          checked={enabled}
          title={trackerMissing ?? undefined}
          disabled={!isEditor || Boolean(trackerMissing) || saving === MASTER_KEY}
          onCheckedChange={(v) => updateSetting(MASTER_KEY, v ? "true" : "false")}
        />
      }
    >
      {/* Der Grund steht ganz oben, nicht an einer einzelnen Zeile: es fehlt nicht einer
          Regel etwas, sondern allen. Ein gespeichertes «an» bleibt gespeichert und wirkt
          wieder, sobald ein Ortungsdienst eingerichtet ist. */}
      {trackerMissing && (
        <SettingUnavailableNote className="mb-3">{trackerMissing}</SettingUnavailableNote>
      )}

      {enabled && (
        <>
          {/* Ankunft (Regel A) — confirm by default, silent is an opt-in */}
          <SettingRow
            label={t("gps.arrivalLabel")}
            htmlFor="gps-rule-arrival"
            hint={t("gps.arrivalHint")}
          >
            <Switch
              id="gps-rule-arrival"
              checked={arrivalEnabled}
              disabled={!isEditor || saving === ARRIVAL_KEY}
              onCheckedChange={(v) => updateSetting(ARRIVAL_KEY, v ? "true" : "false")}
            />
          </SettingRow>

          {arrivalEnabled && (
            <SettingRow
              className="ml-6"
              label={t("gps.silentLabel")}
              htmlFor="gps-rule-arrival-silent"
              hint={t("gps.silentHint")}
              footer={
                settings[ARRIVAL_SILENT_KEY] === "true" ? (
                  <div className="mt-2 flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
                    <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                    <span>
                      {t.rich("gps.silentWarning", {
                        strong: (chunks) => <strong>{chunks}</strong>,
                      })}
                    </span>
                  </div>
                ) : null
              }
            >
              <Switch
                id="gps-rule-arrival-silent"
                checked={settings[ARRIVAL_SILENT_KEY] === "true"}
                disabled={!isEditor || saving === ARRIVAL_SILENT_KEY}
                onCheckedChange={(v) => updateSetting(ARRIVAL_SILENT_KEY, v ? "true" : "false")}
              />
            </SettingRow>
          )}

          {/* Rückkehr (Regel B) — confirm only */}
          <SettingRow
            label={t("gps.returnLabel")}
            htmlFor="gps-rule-return"
            hint={t("gps.returnHint")}
            unavailable={stationConfigured ? null : t("gps.returnUnavailable")}
            unavailableBadge={t("common.notConfiguredBadge")}
          >
            <Switch
              id="gps-rule-return"
              checked={settings[RETURN_KEY] === "true"}
              title={!stationConfigured ? t("gps.returnUnavailable") : undefined}
              disabled={!isEditor || !stationConfigured || saving === RETURN_KEY}
              onCheckedChange={(v) => updateSetting(RETURN_KEY, v ? "true" : "false")}
            />
          </SettingRow>

          {/* Magazin position: read-only here — the value lives in Allgemein.
              One grey underlined cross-link, the house idiom for «woanders
              ändern»; colour stays reserved for status. */}
          <SettingGroup title={t("gps.stationLabel")} hint={t("gps.stationMergedHint")}>
            <SettingRow label={t("gps.stationCoordsLabel")}>
              <span className="flex items-center gap-3 text-sm">
                <span className={effectiveCoords ? "tabular-nums" : "text-muted-foreground"}>
                  {effectiveCoords
                    ? `${effectiveCoords[0].toFixed(5)} · ${effectiveCoords[1].toFixed(5)}`
                    : t("gps.stationCoordsUnset")}
                </span>
                <Link
                  href="/settings?section=general"
                  className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
                >
                  {t("gps.stationCoordsEditInGeneral")}
                </Link>
              </span>
            </SettingRow>
            <SettingRow label={t("gps.stationRadiusLabel")} hint={t("gps.stationRadiusHint")}>
              {renderNumber(STATION_RADIUS_KEY, NUMBER_FALLBACKS[STATION_RADIUS_KEY])}
            </SettingRow>
          </SettingGroup>

          {/* Ankunftsradius (moved from Benachrichtigungen) — shared with Rule A */}
          <SettingRow
            className="mt-6"
            label={t("gps.arrivalRadiusLabel")}
            hint={t("gps.arrivalRadiusHint")}
          >
            {renderNumber(ARRIVAL_RADIUS_KEY, NUMBER_FALLBACKS[ARRIVAL_RADIUS_KEY])}
          </SettingRow>

          {/* Tuning constants */}
          <SettingGroup title={t("gps.tuningTitle")}>
            {tuningFields.map((field) => (
              <SettingRow key={field.key} label={field.label} hint={field.hint}>
                {renderNumber(field.key, NUMBER_FALLBACKS[field.key])}
              </SettingRow>
            ))}
          </SettingGroup>
        </>
      )}

      {!isEditor && (
        <p className="pt-3 text-xs text-muted-foreground">{t("gps.editorsOnly")}</p>
      )}
    </SettingCard>
  )
}
