"use client"

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import {
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet"
import { FooterSheet } from "@/components/ui/footer-sheet"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import Link from "next/link"
import { ClipboardList, FileSpreadsheet, FileText, LifeBuoy, Loader2, Printer, ReceiptText } from "lucide-react"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { PrintView, type PrintAuftrag, type PrintOptions } from "./print-view"
import { downloadEventExport, type EventExportKind } from "./event-export"
import { useOperations } from "@/lib/contexts/operations-context"
import { useEvent } from "@/lib/contexts/event-context"
import { useAuth } from "@/lib/contexts/auth-context"
import { useGroups } from "@/lib/contexts/groups-context"
import { findAuftragForStop } from "@/lib/kanban-utils"
import { apiClient, type ApiPersonnelListItem, type ApiVehicle } from "@/lib/api-client"

/** What the thermal board snapshot contains. Sent to `POST /print/board`. */
export interface ThermoPrintOptions {
  includeIncidents: boolean
  includeCompleted: boolean
  includeVehicles: boolean
  includePersonnel: boolean
}

interface PrintHubSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Thermal board print. Owned by the board so the print-job toast keeps tracking it. */
  onThermoPrint: (options: ThermoPrintOptions) => void
  isThermoPrinting: boolean
  /** No configured thermal printer means no thermal column – same rule the footer pill used. */
  printerEnabled: boolean
}

/** One labelled checkbox row. Ids are namespaced per column so the two option
 *  sets can carry the same label without colliding. */
function OptionRow({
  id,
  label,
  checked,
  onChange,
}: {
  id: string
  label: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <div className="flex items-center gap-2">
      <Checkbox id={id} checked={checked} onCheckedChange={(value) => onChange(value === true)} />
      <Label htmlFor={id} className="cursor-pointer text-sm font-normal">
        {label}
      </Label>
    </div>
  )
}

/** One output of the hub: heading, one-line hint, its own options and its own
 *  action. `action` is pinned to the bottom of the column so the print buttons
 *  of the option-carrying columns line up; a column without options (Export)
 *  just puts its buttons in `children` and stays top-aligned. */
function OutputColumn({
  icon: Icon,
  heading,
  hint,
  children,
  action,
}: {
  icon: typeof Printer
  heading: string
  hint: string
  children?: ReactNode
  action?: ReactNode
}) {
  return (
    <section className="flex min-w-0 flex-1 flex-col gap-3 py-3 md:px-5 md:py-0 md:first:pl-0 md:last:pr-0">
      <div className="min-w-0">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <Icon className="size-3.5 shrink-0 text-muted-foreground" />
          {heading}
        </h3>
        <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
      </div>
      {children && <div className="flex flex-col gap-2">{children}</div>}
      {action && <div className="mt-auto pt-1">{action}</div>}
    </section>
  )
}

/**
 * The board's single print/export surface: thermal slip, A4 status print and
 * per-event file export side by side, because they are three ways of getting
 * the same board onto paper and used to cost three separate footer controls.
 *
 * Gating is unchanged from those controls: thermal needs a configured printer,
 * the file exports stay editor-only, and everything needs a selected event.
 */
export function PrintHubSheet({
  open,
  onOpenChange,
  onThermoPrint,
  isThermoPrinting,
  printerEnabled,
}: PrintHubSheetProps) {
  const t = useTranslations("print")
  // The role labels the field surface already uses — one wording for «Fahrer
  // TLF 1», whether it is read on a phone or off a printout.
  const tRoles = useTranslations("feld.roles")
  const { operations, personnel, materials, materialOnSite } = useOperations()
  const { groups, getGroupResources } = useGroups()
  const { selectedEvent } = useEvent()
  const { isEditor } = useAuth()

  const [thermoOptions, setThermoOptions] = useState<ThermoPrintOptions>({
    includeIncidents: true,
    includeCompleted: true,
    includeVehicles: true,
    includePersonnel: true,
  })

  const [printOptions, setPrintOptions] = useState<PrintOptions>({
    includeIncidents: true,
    includeCompleted: true,
    includePersonnel: true,
    includeVehicles: true,
    includeMaterials: true,
    // Map is a heavy, deliberately-chosen artifact — left off by default.
    includeMap: false,
  })

  const [vehicles, setVehicles] = useState<ApiVehicle[]>([])
  const [vehicleDrivers, setVehicleDrivers] = useState<Map<string, string>>(new Map())
  /** personnel id → «Fahrer TLF 1 · Reko», for the Personal list on the printout. */
  const [eventFunctions, setEventFunctions] = useState<Map<string, string>>(new Map())
  const [attendance, setAttendance] = useState<ApiPersonnelListItem[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [exporting, setExporting] = useState<EventExportKind | null>(null)
  /** The A4 sheet is ready for the printer — see `PrintView.onMapReady`. */
  const [printReady, setPrintReady] = useState(false)
  const [mapFailed, setMapFailed] = useState(false)
  const handlePrintReady = useCallback(() => {
    setMapFailed(false)
    setPrintReady(true)
  }, [])
  const handleMapLoading = useCallback(() => {
    setMapFailed(false)
    setPrintReady(false)
  }, [])
  const handleMapError = useCallback(() => {
    setMapFailed(true)
    setPrintReady(false)
  }, [])

  // Closing unmounts the print view, so the next opening builds its map from
  // scratch and has to be waited for again.
  useEffect(() => {
    if (!open) {
      setPrintReady(false)
      setMapFailed(false)
    }
  }, [open])

  // Fetch vehicles, drivers and the roll-call when the sheet opens — the A4
  // view prints them. The roll-call is the only list that knows who has already
  // gone home, which the board's personnel list cannot say.
  useEffect(() => {
    if (!open) return
    setIsLoading(true)
    const loadData = async () => {
      try {
        const [vehiclesList, specialFunctions, checkInList] = await Promise.all([
          apiClient.getVehicles(),
          selectedEvent ? apiClient.getEventSpecialFunctions(selectedEvent.id) : Promise.resolve([]),
          selectedEvent
            ? apiClient.getEventCheckInList(selectedEvent.id).catch(() => ({ personnel: [] }))
            : Promise.resolve({ personnel: [] as ApiPersonnelListItem[] }),
        ])
        setVehicles(vehiclesList)
        setAttendance(checkInList.personnel)

        const vehicleIdToName = new Map<string, string>()
        vehiclesList.forEach((v) => vehicleIdToName.set(v.id, v.name))

        const driverMap = new Map<string, string>()
        specialFunctions
          .filter((f) => f.function_type === "driver" && f.vehicle_id)
          .forEach((f) => {
            const vehicleName = vehicleIdToName.get(f.vehicle_id!)
            if (vehicleName) driverMap.set(vehicleName, f.personnel_name)
          })
        setVehicleDrivers(driverMap)

        // The same rows, read the other way round: what each PERSON holds here.
        // A driver's vehicle is named, because «Fahrer» without it is the one
        // label on the sheet that raises a question instead of answering one.
        const functionMap = new Map<string, string>()
        specialFunctions.forEach((f) => {
          const label =
            f.function_type === "driver"
              ? tRoles("driver", { vehicle: f.vehicle_name ?? vehicleIdToName.get(f.vehicle_id ?? "") ?? "" }).trim()
              : tRoles(f.function_type)
          const previous = functionMap.get(f.personnel_id)
          functionMap.set(f.personnel_id, previous ? `${previous} · ${label}` : label)
        })
        setEventFunctions(functionMap)
      } catch (error) {
        console.error("Failed to load print data:", error)
      } finally {
        setIsLoading(false)
      }
    }
    loadData()
  }, [open, selectedEvent, tRoles])

  // Auftrag context per stop. Resolved here rather than in the print view so
  // that stays presentational — and via `findAuftragForStop`, which trusts the
  // route's `stopIds` over the incident's own `groupId` (see its doc comment).
  const auftraege = useMemo(() => {
    const map = new Map<string, PrintAuftrag>()
    for (const operation of operations) {
      const group = findAuftragForStop(groups, operation)
      if (!group) continue
      const index = group.stopIds.indexOf(operation.id)
      map.set(operation.id, {
        name: group.name,
        stopPos: index >= 0 ? index + 1 : operation.groupPosition + 1,
        stopTotal: group.stopIds.length,
        resources: getGroupResources(group.id),
      })
    }
    return map
  }, [operations, groups, getGroupResources])

  const updateThermoOption = (key: keyof ThermoPrintOptions, value: boolean) =>
    setThermoOptions((prev) => ({ ...prev, [key]: value }))
  const updatePrintOption = (key: keyof PrintOptions, value: boolean) => {
    // Switching the map on puts a fresh, empty map into the sheet — the print
    // button has to wait for it again, not inherit the readiness of the
    // map-less sheet it just replaced.
    if (key === "includeMap") {
      setMapFailed(false)
      if (value) setPrintReady(false)
    }
    setPrintOptions((prev) => ({ ...prev, [key]: value }))
  }

  const handleExport = async (kind: EventExportKind) => {
    if (!selectedEvent || exporting) return
    setExporting(kind)
    try {
      await downloadEventExport(selectedEvent.id, selectedEvent.name, kind)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("hub.exportFailed"))
    } finally {
      setExporting(null)
    }
  }

  // Count operations that will be printed on A4
  const operationCount = printOptions.includeCompleted
    ? operations.length
    : operations.filter((op) => op.status !== "complete").length

  const exportButtons: { kind: EventExportKind; icon: typeof FileText; label: string }[] = [
    { kind: "report", icon: FileText, label: t("hub.exportReport") },
    { kind: "lageblatt", icon: ClipboardList, label: t("hub.exportLageblatt") },
    { kind: "audit", icon: FileSpreadsheet, label: t("hub.exportAudit") },
  ]

  return (
    <>
      {/* `max-h`/scroll is for the phone, where the three columns stack into one
          tall list; on desktop the row is far shorter than the cap. */}
      <FooterSheet
        open={open}
        onOpenChange={onOpenChange}
        className="max-w-5xl mx-auto px-6 py-4 max-h-[85dvh] overflow-y-auto"
      >
        <div className="pr-8">
          <SheetHeader className="p-0 mb-4">
            <SheetTitle className="flex items-center gap-2">
              <Printer className="h-4 w-4" />
              {t("hub.title")}
            </SheetTitle>
            <SheetDescription>{t("hub.description")}</SheetDescription>
          </SheetHeader>

          {/* Three outputs, one row. `divide-*` draws the separators so a hidden
              column (no printer, no editor rights) leaves no stray rule behind. */}
          <div className="flex flex-col divide-y md:flex-row md:divide-x md:divide-y-0">
            {printerEnabled && (
              <OutputColumn
                icon={ReceiptText}
                heading={t("thermoSheet.title")}
                hint={t("thermoSheet.description")}
                action={
                  <Button
                    size="sm"
                    className="w-full max-w-[260px]"
                    onClick={() => onThermoPrint(thermoOptions)}
                    disabled={isThermoPrinting}
                  >
                    {isThermoPrinting ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Printer className="size-3.5" />
                    )}
                    {isThermoPrinting ? t("thermoSheet.printing") : t("common.print")}
                  </Button>
                }
              >
                <OptionRow
                  id="thermoIncludeIncidents"
                  label={t("common.incidentList")}
                  checked={thermoOptions.includeIncidents}
                  onChange={(value) => updateThermoOption("includeIncidents", value)}
                />
                <OptionRow
                  id="thermoIncludeCompleted"
                  label={t("common.completedIncidents")}
                  checked={thermoOptions.includeCompleted}
                  onChange={(value) => updateThermoOption("includeCompleted", value)}
                />
                <OptionRow
                  id="thermoIncludeVehicles"
                  label={t("common.vehicleStatus")}
                  checked={thermoOptions.includeVehicles}
                  onChange={(value) => updateThermoOption("includeVehicles", value)}
                />
                <OptionRow
                  id="thermoIncludePersonnel"
                  label={t("thermoSheet.personnelOverview")}
                  checked={thermoOptions.includePersonnel}
                  onChange={(value) => updateThermoOption("includePersonnel", value)}
                />
              </OutputColumn>
            )}

            <OutputColumn
              icon={Printer}
              heading={t("optionsModal.title")}
              hint={t("optionsModal.description")}
              action={
                <div className="flex flex-col gap-2">
                  <p className="text-xs text-muted-foreground">
                    {t("optionsModal.summaryIncidents", { count: operationCount })}
                    {printOptions.includePersonnel &&
                      `, ${t("optionsModal.summaryPersonnel", { count: personnel.length })}`}
                    {printOptions.includeVehicles &&
                      `, ${t("optionsModal.summaryVehicles", { count: vehicles.length })}`}
                    {printOptions.includeMaterials &&
                      `, ${t("optionsModal.summaryMaterials", { count: materials.length })}`}
                  </p>
                  {/* Held until the sheet is drawn: the map is a WebGL canvas and
                      goes onto paper exactly as it stands at the moment of the
                      print call, so an early click prints an empty frame. */}
                  <Button
                    size="sm"
                    className="w-full max-w-[260px]"
                    onClick={() => window.print()}
                    disabled={isLoading || !printReady}
                  >
                    {printReady || mapFailed ? (
                      <Printer className="size-3.5" />
                    ) : (
                      <Loader2 className="size-3.5 animate-spin" />
                    )}
                    {printReady || mapFailed ? t("common.print") : t("map.loading")}
                  </Button>
                  {mapFailed && (
                    <p role="alert" className="text-xs text-destructive">{t("map.loadFailed")}</p>
                  )}
                </div>
              }
            >
              <OptionRow
                id="includeIncidents"
                label={t("common.incidentList")}
                checked={printOptions.includeIncidents}
                onChange={(value) => updatePrintOption("includeIncidents", value)}
              />
              <OptionRow
                id="includeCompleted"
                label={t("common.completedIncidents")}
                checked={printOptions.includeCompleted}
                onChange={(value) => updatePrintOption("includeCompleted", value)}
              />
              <OptionRow
                id="includePersonnel"
                label={t("optionsModal.personnelList")}
                checked={printOptions.includePersonnel}
                onChange={(value) => updatePrintOption("includePersonnel", value)}
              />
              <OptionRow
                id="includeVehicles"
                label={t("common.vehicleStatus")}
                checked={printOptions.includeVehicles}
                onChange={(value) => updatePrintOption("includeVehicles", value)}
              />
              <OptionRow
                id="includeMaterials"
                label={t("optionsModal.materialInventory")}
                checked={printOptions.includeMaterials}
                onChange={(value) => updatePrintOption("includeMaterials", value)}
              />
              <OptionRow
                id="includeMap"
                label={t("optionsModal.mapOverview")}
                checked={printOptions.includeMap}
                onChange={(value) => updatePrintOption("includeMap", value)}
              />
            </OutputColumn>

            {/* Editor-only, exactly as in the Verwaltung → Export menu these
                buttons mirror: a viewer never had a file export. */}
            {isEditor && (
              <OutputColumn
                icon={FileText}
                heading={t("hub.exportHeading")}
                hint={t("hub.exportHint")}
              >
                {exportButtons.map(({ kind, icon: Icon, label }) => (
                  <Button
                    key={kind}
                    size="sm"
                    variant="outline"
                    className="w-full max-w-[260px] justify-start"
                    onClick={() => handleExport(kind)}
                    disabled={!selectedEvent || exporting !== null}
                  >
                    {exporting === kind ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Icon className="size-3.5" />
                    )}
                    {exporting === kind ? t("hub.exporting") : label}
                  </Button>
                ))}

                {/* The Lageblatt above is a one-off download; the same document
                    can also be fetched on a timer per device, which is the
                    Ausfall-Variante — a current sheet of paper already lying
                    there when the screens go. That switch lives in the
                    Ausfallsicherheit settings, so this is a link to it rather
                    than a second copy of the control: one place owns the
                    interval, and a toggle shown in two places is a toggle that
                    disagrees with itself. */}
                <Link
                  href="/settings?section=fallback"
                  onClick={() => onOpenChange(false)}
                  className="mt-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
                >
                  <LifeBuoy className="size-3.5 shrink-0" />
                  {t("hub.exportAutomatic")}
                </Link>
              </OutputColumn>
            )}
          </div>
        </div>
      </FooterSheet>

      {/* Hidden print view - rendered in DOM but only visible when printing */}
      {open && (
        <PrintView
          eventName={selectedEvent?.name ?? "Unbekanntes Event"}
          operations={operations}
          personnel={personnel}
          vehicles={vehicles}
          materials={materials}
          options={printOptions}
          vehicleDrivers={vehicleDrivers}
          attendance={attendance}
          eventFunctions={eventFunctions}
          auftraege={auftraege}
          materialOnSite={materialOnSite}
          onMapReady={handlePrintReady}
          onMapError={handleMapError}
          onMapLoading={handleMapLoading}
        />
      )}
    </>
  )
}
