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
 * Two things that are not just tidying:
 *
 * * **The Feld-Code rides along at the top.** Since plan 26 the QR alone gets
 *   nobody in, so printing or reading out a link without its code strands
 *   whoever scans it.
 * * **Clicking a QR enlarges it**, for the recurring case of somebody standing
 *   in the KP without the poster: click, hold up the screen, done. The enlarged
 *   Feld QR shows the code underneath it for the same reason.
 */

import { useCallback, useEffect, useState } from "react"
import { QRCodeSVG } from "qrcode.react"
import { useTranslations } from "next-intl"
import { Check, Copy, ExternalLink, Printer } from "lucide-react"
import { toast } from "sonner"

import { FooterSheet } from "@/components/ui/footer-sheet"
import { SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { FeldAccessCard } from "@/components/feld/feld-access-card"
import { apiClient } from "@/lib/api-client"
import { copyToClipboard } from "@/lib/utils"

/** The four surviving links, in the order the KP needs them on a callout. */
const LINK_KEYS = ["feld", "checkin", "display", "alarm"] as const
type LinkKey = (typeof LINK_KEYS)[number]

interface LinksQrSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  eventId: string | null
  /** Whether the thermal agent is reachable — no print button without one. */
  printerEnabled?: boolean
}

export function LinksQrSheet({ open, onOpenChange, eventId, printerEnabled }: LinksQrSheetProps) {
  const t = useTranslations("kanban.links")
  const tCommon = useTranslations("kanban.common")
  const [urls, setUrls] = useState<Partial<Record<LinkKey, string>>>({})
  const [copied, setCopied] = useState<LinkKey | null>(null)
  const [enlarged, setEnlarged] = useState<LinkKey | null>(null)

  const generate = useCallback(
    async (key: LinkKey, id: string): Promise<string> => {
      const response =
        key === "feld"
          ? await apiClient.generateFeldLink(id)
          : key === "checkin"
            ? await apiClient.generateCheckInLink(id)
            : key === "display"
              ? await apiClient.generateViewerLink(id)
              : await apiClient.generateAlarmLink(id)
      return `${window.location.origin}${response.link}`
    },
    [],
  )

  // All four at once when the sheet opens. Each is a separate mint and they are
  // independent, so one failing (a provider off, a permission) must not take the
  // other three down with it.
  useEffect(() => {
    if (!open || !eventId) return
    let cancelled = false
    Promise.all(
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
    })
    return () => {
      cancelled = true
    }
  }, [open, eventId, generate])

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

  const handlePrint = async (key: LinkKey) => {
    const url = urls[key]
    if (!url || !eventId) return
    try {
      await apiClient.queueQRCodePrint({
        qr_content: url,
        title: t(`${key}.title`),
        subtitle: t(`${key}.audience`),
        event_id: eventId,
      })
      toast.info(tCommon("printQrCode"))
    } catch (error) {
      console.error("Failed to queue the QR print:", error)
      toast.error(tCommon("copyFailed"))
    }
  }

  return (
    <>
      <FooterSheet open={open} onOpenChange={onOpenChange} className="max-w-3xl mx-auto px-6 py-4">
        <SheetHeader className="p-0 mb-3">
          <SheetTitle>{t("title")}</SheetTitle>
          <SheetDescription>{t("description")}</SheetDescription>
        </SheetHeader>

        {eventId && (
          <div className="mb-3">
            <FeldAccessCard eventId={eventId} />
          </div>
        )}

        <div className="space-y-2">
          {LINK_KEYS.map(key => {
            const url = urls[key]
            return (
              <div key={key} className="flex items-center gap-3 rounded-lg border border-border/60 p-2.5">
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

                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{t(`${key}.title`)}</div>
                  <div className="truncate text-xs text-muted-foreground">{t(`${key}.audience`)}</div>
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  <Button variant="ghost" size="sm" asChild disabled={!url} title={tCommon("openInNewTab")}>
                    <a href={url ?? "#"} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="size-3.5" />
                    </a>
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => handleCopy(key)} disabled={!url}>
                    {copied === key ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
                  </Button>
                  {printerEnabled && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handlePrint(key)}
                      disabled={!url}
                      title={tCommon("printQrCode")}
                    >
                      <Printer className="size-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </FooterSheet>

      <Dialog open={enlarged !== null} onOpenChange={openState => !openState && setEnlarged(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{enlarged ? t(`${enlarged}.title`) : ""}</DialogTitle>
          </DialogHeader>
          {enlarged && urls[enlarged] && (
            <div className="flex flex-col items-center gap-4 pb-2">
              <div className="rounded-lg bg-white p-3">
                <QRCodeSVG value={urls[enlarged]!} size={240} level="M" includeMargin={false} />
              </div>
              {/* The Feld QR is useless on its own now — whoever scans it is
                  asked for the code next, so it belongs on the same surface. */}
              {enlarged === "feld" && eventId && <FeldAccessCard eventId={eventId} />}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
