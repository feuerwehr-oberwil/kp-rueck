"use client"

/**
 * «Station einrichten» – what a freshly claimed board still needs, said on the board.
 *
 * Owner pick UX-06 A (10.11.2026): no wizard. The admin lands on the board and a strip
 * names the three things: the account (done – and it finally says the username is
 * `admin`), the Magazin's location (still the seed's «Musterstadt»), roster and fleet
 * (empty). Each open step has its one way out; the strip is gone once both are done,
 * or when the admin hides it on this device.
 *
 * Admin only: the steps are admin settings. What counts as done is `stationSetupState`.
 */

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { Check, Circle, X } from "lucide-react"
import { toast } from "sonner"
import { apiClient } from "@/lib/api-client"
import { useAuth } from "@/lib/contexts/auth-context"
import { stationSetupState, PLACEHOLDER_STATION, type StationSetupState } from "@/lib/station-setup"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { FormMessage, formMessageId, fieldMessageProps } from "@/components/ui/form-message"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LocationInput } from "@/components/location/location-input"
import { ShellLoader } from "@/components/ui/shell-loader"
import { cn } from "@/lib/utils"

/** Per device: an admin who knows and wants the room back. */
const DISMISSED_KEY = "kp-station-setup-dismissed"

const readDismissed = () => {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === "1"
  } catch {
    return false
  }
}

export function StationSetupStrip({ className }: { className?: string }) {
  const t = useTranslations("setup.station")
  const { isAdmin, user } = useAuth()
  const [state, setState] = useState<StationSetupState | null>(null)
  const [homeCity, setHomeCity] = useState("")
  const [dismissed, setDismissed] = useState(true)
  const [locationOpen, setLocationOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      const [settings, personnel, vehicles] = await Promise.all([
        apiClient.getAllSettings(),
        apiClient.getAllPersonnel(),
        apiClient.getVehicles(),
      ])
      setState(stationSetupState({ settings, personnelCount: personnel.length, vehicleCount: vehicles.length }))
      const city = settings.home_city ?? ""
      setHomeCity(city.startsWith(PLACEHOLDER_STATION.homeCity) ? "" : city)
    } catch {
      // Nothing to nag about when it cannot be read: the strip simply stays away.
      setState(null)
    }
  }, [])

  useEffect(() => {
    if (!isAdmin) return
    setDismissed(readDismissed())
    void load()
  }, [isAdmin, load])

  if (!isAdmin || !state || state.done || dismissed) return null

  const done = 1 + Number(state.locationSet) + Number(state.inventorySet)
  const dismiss = () => {
    try {
      window.localStorage.setItem(DISMISSED_KEY, "1")
    } catch {
      /* storage disabled: hidden for this visit only */
    }
    setDismissed(true)
  }

  return (
    <section
      aria-label={t("title")}
      className={cn("rounded-lg border border-border bg-card px-4 py-3 text-sm", className)}
      data-testid="station-setup"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">{t("title")}</h2>
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground tabular-nums">{t("progress", { done })}</span>
          <Button variant="ghost" size="icon-xs" onClick={dismiss} aria-label={t("dismiss")} title={t("dismiss")}>
            <X className="size-3.5" />
          </Button>
        </div>
      </div>
      {/* Done steps are one quiet line; only what is still open gets a row and a button –
          on the board the strip must not cost more height than it has to. */}
      <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
        <Done>{t.rich("signedInAs", { name: () => <b className="font-mono font-semibold text-foreground">{user?.username}</b> })}</Done>
        {state.locationSet && <Done>{t("location")}</Done>}
        {state.inventorySet && <Done>{t("inventory")}</Done>}
      </p>
      <ul className="mt-1.5 divide-y divide-border/60 border-t border-border/60">
        {!state.locationSet && (
          <Open label={t("location")} hint={t("locationHint")}>
            <Button size="sm" variant="outline" onClick={() => setLocationOpen(true)}>
              {t("locationAction")}
            </Button>
          </Open>
        )}
        {!state.inventorySet && (
          <Open label={t("inventory")} hint={t("inventoryHint")}>
            <Button size="sm" variant="outline" asChild>
              <Link href="/settings?section=import">{t("inventoryAction")}</Link>
            </Button>
          </Open>
        )}
      </ul>
      {locationOpen && (
        <StationLocationDialog
          initialHomeCity={homeCity}
          cancelLabel={t("cancel")}
          onClose={() => setLocationOpen(false)}
          onSaved={() => {
            setLocationOpen(false)
            void load()
          }}
        />
      )}
    </section>
  )
}

/** A finished step, inline in the strip's quiet first line. */
function Done({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Check className="size-3.5 shrink-0 text-success" aria-hidden />
      <span>{children}</span>
    </span>
  )
}

/** An open step: what it is, why it matters, and its one way out. */
function Open({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2">
      <Circle className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <div>{label}</div>
        <div className="text-xs text-muted-foreground">{hint}</div>
      </div>
      {children}
    </li>
  )
}

/**
 * The Magazin by address search (or the map / coordinates behind the field's buttons) plus
 * the Einsatzgebiet – the three settings the placeholder stands in for. Saved together;
 * coordinates with the six decimals Einstellungen › Allgemein keeps.
 */
function StationLocationDialog({
  initialHomeCity,
  cancelLabel,
  onClose,
  onSaved,
}: {
  initialHomeCity: string
  cancelLabel: string
  onClose: () => void
  onSaved: () => void
}) {
  const t = useTranslations("setup.station")
  const [address, setAddress] = useState<string | null>(null)
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [homeCity, setHomeCity] = useState(initialHomeCity)
  const [tried, setTried] = useState(false)
  const [saving, setSaving] = useState(false)

  const locationMissing = tried && !coords
  const cityMissing = tried && !homeCity.trim()

  const save = async () => {
    setTried(true)
    if (!coords || !homeCity.trim()) return
    setSaving(true)
    try {
      await apiClient.updateSetting("firestation_latitude", coords.lat.toFixed(6))
      await apiClient.updateSetting("firestation_longitude", coords.lng.toFixed(6))
      await apiClient.updateSetting("home_city", homeCity.trim())
      toast.success(t("saved"))
      onSaved()
    } catch {
      toast.error(t("saveFailed"))
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("dialogTitle")}</DialogTitle>
          <DialogDescription>{t("dialogDescription")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <LocationInput
              label={t("addressLabel")}
              address={address}
              latitude={coords?.lat ?? null}
              longitude={coords?.lng ?? null}
              onAddressChange={setAddress}
              onCoordinatesChange={(lat, lng) => setCoords(lat !== null && lng !== null ? { lat, lng } : null)}
              disabled={saving}
              error={locationMissing}
              describedBy={locationMissing ? formMessageId("station-location") : undefined}
            />
            {locationMissing && <FormMessage id={formMessageId("station-location")}>{t("locationMissing")}</FormMessage>}
          </div>
          <div>
            <Label htmlFor="station-home-city" className="mb-1.5">
              {t("homeCityLabel")}
            </Label>
            <Input
              id="station-home-city"
              value={homeCity}
              placeholder={t("homeCityPlaceholder")}
              autoComplete="off"
              onChange={(e) => setHomeCity(e.target.value)}
              disabled={saving}
              {...(cityMissing ? fieldMessageProps("station-home-city", "error") : {})}
            />
            {cityMissing && <FormMessage id={formMessageId("station-home-city")}>{t("homeCityMissing")}</FormMessage>}
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {cancelLabel}
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving && <ShellLoader className="size-4" />}
            {t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
