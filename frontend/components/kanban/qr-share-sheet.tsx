"use client"

import { useState, type ReactNode } from "react"
import { QRCodeSVG } from "qrcode.react"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { Check, Copy, ExternalLink, Printer } from "lucide-react"
import { SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import { FooterSheet } from "@/components/ui/footer-sheet"
import { Button } from "@/components/ui/button"

interface QrShareSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The URL encoded in the QR + shown in the copyable field. */
  url: string | null | undefined
  title: string
  description: string
  hint: string
  printerEnabled?: boolean
  isPrinting?: boolean
  /** Print the QR via the thermal agent. Only shown when printerEnabled. */
  onPrint?: () => void
  /** Extra controls between the header and the link row (e.g. a view selector). */
  children?: ReactNode
}

/**
 * A bottom footer sheet that shares a link as a QR code + copyable URL.
 * Backs the check-in / Reko / display / alarm share sheets, which were four
 * ~90-line copy-paste blocks in the dashboard (each with its own duplicated
 * copy-flag state and handler). Owns its own "copied" state; the only variant
 * — the display view selector — comes in via `children`.
 */
export function QrShareSheet({
  open,
  onOpenChange,
  url,
  title,
  description,
  hint,
  printerEnabled,
  isPrinting,
  onPrint,
  children,
}: QrShareSheetProps) {
  const tCommon = useTranslations("kanban.common")
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    if (!url) return
    try {
      const { copyToClipboard } = await import("@/lib/utils")
      await copyToClipboard(url)
      setCopied(true)
      toast.success(tCommon("linkCopied"))
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error(tCommon("copyFailed"))
    }
  }

  return (
    <FooterSheet open={open} onOpenChange={onOpenChange} className="max-w-3xl mx-auto px-6 py-4">
      <div className="flex items-start gap-6">
        {/* QR Code */}
        {url && (
          <div className="rounded-lg border p-3 bg-white flex-shrink-0">
            <QRCodeSVG value={url} size={140} level="M" includeMargin={false} />
          </div>
        )}

        {/* Content */}
        <div className="flex-1 min-w-0">
          <SheetHeader className="p-0 mb-3">
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription>{description}</SheetDescription>
          </SheetHeader>

          {children}

          {url && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={url}
                  readOnly
                  className="flex-1 rounded-md border px-3 py-1.5 text-xs bg-muted font-mono truncate"
                />
                <Button variant="outline" size="sm" onClick={handleCopy} className="flex-shrink-0">
                  {copied ? (
                    <Check className="h-3.5 w-3.5 text-green-600" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  asChild
                  className="flex-shrink-0 text-muted-foreground"
                  title={tCommon("openInNewTab")}
                >
                  <a href={url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </Button>
                {printerEnabled && onPrint && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onPrint}
                    disabled={isPrinting}
                    className="flex-shrink-0"
                    title={tCommon("printQrCode")}
                  >
                    <Printer className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">{hint}</p>
            </div>
          )}
        </div>
      </div>
    </FooterSheet>
  )
}
