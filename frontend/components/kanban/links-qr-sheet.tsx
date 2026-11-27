"use client"

/**
 * One sheet for every link the board hands out (plan 26, decision 29).
 *
 * The footer used to carry five separate QR buttons — Check-In, Reko, Feld,
 * Anzeige, Alarm — each opening its own sheet that did the same three things.
 * Five doors to the same cupboard. They are one row each now, and each row says
 * **who the link is for**, which was the part an operator had to already know.
 *
 * Reko is gone from the list rather than merged: `/feld` absorbed it, and a Reko
 * auftrag now opens the form straight from the crew's own page.
 *
 * Check-In and Anzeige held out longest as their own pills (the Appell; picking
 * which display the token opens), but they are folded in now too:
 *
 * * **Check-In leads**, and the Appell rides along as a row — the roll call is
 *   the other half of the same job, so it lives next to the link that feeds it.
 * * **Anzeige shares only the base `/display` link.** The board/map/status
 *   picker moved to where it belongs: the `/display` overview page itself,
 *   which forwards the token to whichever wall page is chosen on site.
 *
 * Two things that are not just tidying:
 *
 * * **The Feld-Code rides along, right above the Feld link.** Since plan 26 the
 *   QR alone gets nobody in, so printing or reading out a link without its code
 *   strands whoever scans it. The code itself is click-to-copy.
 * * **Clicking a QR enlarges it**, for the recurring case of somebody standing
 *   in the KP without the poster: click, hold up the screen, done. The enlarged
 *   Feld QR shows the code underneath it for the same reason.
 *
 * **«Link neu erzeugen»** (editors, the circular arrow on Check-in, Alarm erfassen and
 * Wandanzeige): for a link that reached the wrong people. It asks once, ends every link
 * of that kind issued so far for the Ereignis, and puts the new link and QR in the row.
 * The Feld link has no arrow: its door is the Feld-Code, with «Neu» and «Abmelden» below it.
 */

import { useCallback, useEffect, useState } from "react"
import { QRCodeSVG } from "qrcode.react"
import { useTranslations } from "next-intl"
import { Check, Copy, ExternalLink, Printer, RefreshCw, Users } from "lucide-react"
import { toast } from "sonner"

import { FooterSheet } from "@/components/ui/footer-sheet"
import { SurfaceStep, useOpenSurface } from "@/components/ui/surface-step"
import { SheetBody, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { FeldAccessCard, prefetchFeldAccess } from "@/components/feld/feld-access-card"
import { apiClient } from "@/lib/api-client"
import type { ShareLinkKind } from "@/lib/api/resources/viewer"
import { useAuth } from "@/lib/contexts/auth-context"
import { queueLinkQrPrint, type LinkKind } from "@/lib/link-qr-print"
import { copyToClipboard } from "@/lib/utils"

/** The links the board hands out, in the order the KP needs them on a callout. */
const LINK_KEYS = ["checkin", "feld", "alarm", "display"] as const satisfies readonly LinkKind[]
type LinkKey = (typeof LINK_KEYS)[number]

/** The rows whose link can be made new, and the backend's name for each kind. */
const REGENERABLE = { checkin: "checkin", alarm: "alarm", display: "viewer" } as const satisfies Partial<
  Record<LinkKey, ShareLinkKind>
>
type RegenerableKey = keyof typeof REGENERABLE
const isRegenerable = (key: LinkKey): key is RegenerableKey => key in REGENERABLE

interface LinksQrSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  eventId: string | null
  /** Named in the «Link neu erzeugen» question, so the operator sees which Ereignis it is. */
  eventName?: string | null
  /** Whether the thermal agent is reachable — no print button without one. */
  printerEnabled?: boolean
  /** Opens the Appell — the page closes this sheet first (two layers is one too many). */
  onOpenAttendance?: () => void
}

export function LinksQrSheet({
  open,
  onOpenChange,
  eventId,
  eventName,
  printerEnabled,
  onOpenAttendance,
}: LinksQrSheetProps) {
  const t = useTranslations("kanban.links")
  const tCommon = useTranslations("kanban.common")
  const tAttendance = useTranslations("kanban.attendance")
  const [urls, setUrls] = useState<Partial<Record<LinkKey, string>>>({})
  const [copied, setCopied] = useState<LinkKey | null>(null)
  const [enlarged, setEnlarged] = useState<LinkKey | null>(null)
  /** The row whose «Link neu erzeugen» question is open. */
  const [regenerating, setRegenerating] = useState<RegenerableKey | null>(null)
  /** While the opening's links are still coming, «Link neu erzeugen» waits: a link of that
   *  batch landing after the new one would put the ended link back into the row. */
  const [linksLoading, setLinksLoading] = useState(false)
  const surface = useOpenSurface()
  /**
   * The day the Feld link dies, from its mint. The print puts it on the Feld
   * slip together with the Feld-Code (`queueLinkQrPrint` reads that fresh), so
   * a slip in the Magazin can be recognised as dead.
   */
  const [feldValidUntil, setFeldValidUntil] = useState<string | null>(null)
  // The Appell row's count — a label, not live state; the Appell itself
  // refreshes it on every write.
  const [attendance, setAttendance] = useState<{ present: number; total: number } | null>(null)

  const generate = useCallback(async (key: LinkKey, id: string): Promise<string> => {
    if (key === "display") {
      // The read-only share token, pointed at the /display OVERVIEW rather than
      // one wall page: the picker there forwards the token to board/map/status,
      // so one link covers all three and the sub-link picker could go. The
      // backend's `link` is that same `/display?token=…` path.
      const response = await apiClient.generateViewerLink(id)
      return `${window.location.origin}${response.link}`
    }
    if (key === "feld") {
      const response = await apiClient.generateFeldLink(id)
      setFeldValidUntil(response.valid_until ?? null)
      return `${window.location.origin}${response.link}`
    }
    const response =
      key === "checkin"
        ? await apiClient.generateCheckInLink(id)
        : await apiClient.generateAlarmLink(id)
    return `${window.location.origin}${response.link}`
  }, [])

  // All at once when the sheet opens. Each is a separate mint and they are
  // independent, so one failing (a provider off, a permission) must not take the
  // others down with it.
  useEffect(() => {
    if (!open || !eventId) return
    let cancelled = false
    setLinksLoading(true)
    void Promise.all(
      LINK_KEYS.map(async key => {
        try {
          return [key, await generate(key, eventId)] as const
        } catch (error) {
          console.error(`Failed to generate the ${key} link:`, error)
          return [key, undefined] as const
        }
      }),
    ).then(pairs => {
      if (cancelled) return
      setUrls(Object.fromEntries(pairs.filter(([, url]) => url)) as Partial<Record<LinkKey, string>>)
      setLinksLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [open, eventId, generate])

  // Closed: fetch the Feld-Code once in the background, so the sheet opens with it (the code
  // is editor-only on the server).
  const { isEditor, user } = useAuth()
  const userId = user?.id
  useEffect(() => {
    if (!open && eventId && isEditor && userId) void prefetchFeldAccess(userId, eventId)
  }, [open, eventId, isEditor, userId])

  // The Appell row's count, fetched only while the sheet showing it is open.
  useEffect(() => {
    if (!open || !eventId) return
    let cancelled = false
    apiClient
      .getEventCheckInStats(eventId)
      .then(stats => {
        if (!cancelled) setAttendance({ present: stats.checked_in, total: stats.total_available })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [open, eventId])

  const handleCopy = async (key: LinkKey) => {
    const url = urls[key]
    if (!url) return
    try {
      await copyToClipboard(url)
      setCopied(key)
      toast.success(tCommon("linkCopied"))
      setTimeout(() => setCopied(null), 2000)
    } catch {
      toast.error(tCommon("copyFailed"))
    }
  }

  /**
   * The old links of this kind end, then the new one is generated and shown. A failure is
   * said with the server's sentence and thrown on, so the question stays open for a retry.
   */
  const regenerate = async (key: RegenerableKey) => {
    if (!eventId) return
    // Revoke first: a link generated before the revoke would carry the old generation and
    // end with it.
    try {
      await apiClient.revokeShareLinks(eventId, REGENERABLE[key])
    } catch (error) {
      console.error(`Failed to end the ${key} links:`, error)
      toast.error(t("regenerateFailed"), { description: error instanceof Error ? error.message : undefined })
      throw error
    }
    try {
      const url = await generate(key, eventId)
      setUrls(current => ({ ...current, [key]: url }))
      toast.success(t(`${key}.regenerated`), { description: t("regeneratedNote") })
    } catch (error) {
      // The old link has ended, the new one did not come: the row must not offer the dead one.
      // Reopening the sheet generates the new link.
      console.error(`Failed to generate the new ${key} link:`, error)
      setUrls(current => ({ ...current, [key]: undefined }))
      toast.error(t("regenerateHalf"), { description: t("regenerateHalfNote") })
    }
  }

  const handlePrint = async (key: LinkKey) => {
    const url = urls[key]
    if (!url || !eventId) return
    try {
      await queueLinkQrPrint(key, eventId, {
        url,
        title: t(`${key}.title`),
        subtitle: t(`${key}.subtitle`),
        validUntil: key === "feld" ? feldValidUntil : undefined,
      })
      toast.info(tCommon("printQrCode"))
    } catch (error) {
      console.error("Failed to queue the QR print:", error)
      toast.error(tCommon("copyFailed"))
    }
  }

  /** One link row. `bare` drops the row's own border so it can stack inside a
   *  grouped container (divide-y draws the seams there instead).
   *
   *  The row wraps: the name never gets narrower than its longest word (`min-w-min`). Below
   *  `md` the buttons always take a second line, right-aligned, so every row has the same
   *  shape – when they wrapped only where they did not fit, «Wandanzeige» broke differently
   *  from «Alarm erfassen» (VIS.11). A row without «neu erzeugen» keeps its slot, so ↗ and
   *  copy stand in one column on every row. */
  const linkRow = (key: LinkKey, bare = false) => {
    const url = urls[key]
    return (
      <div
        key={key}
        className={
          bare
            ? "flex flex-wrap items-center gap-x-3 gap-y-1.5 p-2.5"
            : "flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-border/60 p-2.5"
        }
      >
        {/* Clickable: the KP holds the screen up and somebody scans it. */}
        <button
          type="button"
          onClick={() => url && setEnlarged(key)}
          disabled={!url}
          title={t("enlarge")}
          className="shrink-0 rounded-md bg-white p-1.5 disabled:opacity-40"
        >
          {url ? (
            <QRCodeSVG value={url} size={44} level="M" includeMargin={false} />
          ) : (
            <div className="size-[44px]" />
          )}
        </button>

        <div className="min-w-min flex-1">
          {/* The name does the explaining. A second line spelling out
              who it is for ("Tablet an der Tür – Anwesenheit") was the
              same fact twice, and the longer half was the vaguer one. */}
          <div className="text-sm font-medium">{t(`${key}.title`)}</div>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1.5 max-md:basis-full max-md:justify-end">
          <Button variant="ghost" size="sm" asChild disabled={!url} title={tCommon("openInNewTab")}>
            <a href={url ?? "#"} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="size-3.5" />
            </a>
          </Button>
          <Button variant="outline" size="sm" onClick={() => void handleCopy(key)} disabled={!url}>
            {copied === key ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
          </Button>
          {printerEnabled && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handlePrint(key)}
              disabled={!url}
              title={tCommon("printQrCode")}
            >
              <Printer className="size-3.5" />
            </Button>
          )}
          {isEditor && isRegenerable(key) && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRegenerating(key)}
              disabled={!url || linksLoading}
              title={t("regenerate")}
              aria-label={t("regenerate")}
            >
              <RefreshCw className="size-3.5" />
            </Button>
          )}
          {isEditor && !isRegenerable(key) && (
            <span aria-hidden className="invisible flex">
              <Button variant="outline" size="sm" tabIndex={-1}>
                <RefreshCw className="size-3.5" />
              </Button>
            </span>
          )}
        </div>
      </div>
    )
  }

  const enlargedUrl = enlarged ? urls[enlarged] : undefined
  const enlargedQr = enlarged && enlargedUrl && (
    <>
      <div className="rounded-lg bg-white p-3">
        <QRCodeSVG value={enlargedUrl} size={240} level="M" includeMargin={false} />
      </div>
      {/* The Feld QR is useless on its own now — whoever scans it is
          asked for the code next, so it belongs on the same surface. */}
      {enlarged === "feld" && eventId && (
        <FeldAccessCard eventId={eventId} />
      )}
    </>
  )

  return (
    <>
      <FooterSheet
        open={open}
        onOpenChange={onOpenChange}
        // Enlarging a QR opens a dialog on top of this sheet; without this the
        // outside-click guard reads that as "the operator clicked away" and
        // closes the sheet underneath, so dismissing the QR lands on the board.
        shouldPreventClose={() => enlarged !== null || regenerating !== null}
        surface={t("title")}
        // Capped at the screen, the groups scroll: on a short phone the rows wrap to two lines
        // and the sheet would otherwise rise past the top, out of reach.
        className="max-w-3xl mx-auto px-6 py-4 pb-sheet-safe md:pb-4 modal-h-tall flex flex-col gap-0"
      >
        <SheetHeader className="p-0 mb-3 shrink-0">
          <SheetTitle>{t("title")}</SheetTitle>
          <SheetDescription>{t("description")}</SheetDescription>
        </SheetHeader>

        {/* Order is the callout: crew checks in (the roll call watches it),
            the Feld poster (link + code) goes out of the door, and the phone
            desk / wall display come last. Three labelled groups instead of a
            flat row list — the Anwesenheit row and the Feld-Code used to sit
            wedged between QR rows they had nothing to do with. */}
        <SheetBody className="space-y-3">
          {/* Check-In and the Appell it feeds — the two halves of one job. */}
          <section>
            <p className="mb-1 px-0.5 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("groupCheckin")}
            </p>
            <div className="rounded-lg border border-border/60 divide-y divide-border/50">
              {linkRow("checkin", true)}
              {eventId && (
                <div className="flex items-center gap-3 px-2.5 py-2">
                  <Users className="size-4 shrink-0 text-muted-foreground" />
                  {/* On a phone the count goes under the label: beside it, «17 von 61 anwesend»
                      pushed «Appell öffnen» past the card's edge at 393px (phone sweep 14.11.). */}
                  <div className="flex min-w-0 flex-1 flex-col md:flex-row md:items-center md:gap-3">
                    <span className="text-sm font-medium">{tAttendance("rowLabel")}</span>
                    <span className="min-w-0 break-words text-sm text-muted-foreground md:flex-1">
                      {attendance
                        ? tAttendance("rowCount", { present: attendance.present, total: attendance.total })
                        : ""}
                    </span>
                  </div>
                  <Button size="sm" variant="outline" className="shrink-0" onClick={onOpenAttendance}>
                    {tAttendance("open")}
                  </Button>
                </div>
              )}
            </div>
          </section>

          {/* The Feld link and the code without which it is useless (plan 26):
              one group, so they leave the KP together. */}
          <section>
            <p className="mb-1 px-0.5 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("groupFeld")}
            </p>
            <div className="rounded-lg border border-border/60 divide-y divide-border/50">
              {linkRow("feld", true)}
              {eventId && <FeldAccessCard eventId={eventId} bare />}
            </div>
          </section>

          {/* The phone desk's intake link and the wall display. */}
          <section>
            <p className="mb-1 px-0.5 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("groupOther")}
            </p>
            <div className="rounded-lg border border-border/60 divide-y divide-border/50">
              {linkRow("alarm", true)}
              {linkRow("display", true)}
            </div>
          </section>
        </SheetBody>
      </FooterSheet>

      {regenerating && (
        <ConfirmDialog
          open
          onOpenChange={openState => !openState && setRegenerating(null)}
          title={t(`${regenerating}.regenerateTitle`)}
          description={t(`${regenerating}.regenerateDescription`, { event: eventName ?? "" })}
          confirmText={t("regenerateConfirm")}
          confirmIcon={<RefreshCw />}
          // Not red (the owner's pick), but Enter must not end the links by reflex: the focus
          // starts on Abbrechen.
          initialFocus="cancel"
          onConfirm={() => regenerate(regenerating)}
        />
      )}

      {/* On a desk the enlarged QR is a step inside this sheet (owner pick 5A: no window on a
          window); on the phone an S dialog over the sheet. */}
      {surface && enlarged ? (
        <SurfaceStep host={surface} title={t(`${enlarged}.title`)} onBack={() => setEnlarged(null)}>
          <div className="flex min-h-0 flex-1 flex-col items-center gap-4 overflow-y-auto px-5 pb-5">
            {enlargedQr}
          </div>
        </SurfaceStep>
      ) : (
        <Dialog open={enlarged !== null} onOpenChange={openState => !openState && setEnlarged(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{enlarged ? t(`${enlarged}.title`) : ""}</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col items-center gap-4 pb-2">{enlargedQr}</div>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
