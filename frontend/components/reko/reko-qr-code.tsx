'use client'

import { useState, useEffect } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { QrCode, Copy, Check } from 'lucide-react'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'

interface RekoQRCodeProps {
  incidentId: string
}

export default function RekoQRCode({ incidentId }: RekoQRCodeProps) {
  const [copied, setCopied] = useState(false)
  const [rekoUrl, setRekoUrl] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isOpen, setIsOpen] = useState(false)

  // Generate link when dialog opens
  useEffect(() => {
    if (isOpen && !rekoUrl) {
      generateLink()
    }
  }, [isOpen])

  async function generateLink() {
    setIsLoading(true)
    try {
      const response = await apiClient.generateRekoLink(incidentId)
      // Construct full URL (link from backend is relative)
      const fullUrl = `${window.location.origin}${response.link}`
      setRekoUrl(fullUrl)
    } catch (error) {
      console.error('Failed to generate Reko link:', error)
      toast.error('Fehler beim Generieren des Links')
    } finally {
      setIsLoading(false)
    }
  }

  async function copyToClipboard() {
    if (!rekoUrl) return

    try {
      await navigator.clipboard.writeText(rekoUrl)
      setCopied(true)
      toast.success('Link kopiert')
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      toast.error('Fehler beim Kopieren')
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <QrCode className="mr-2 h-4 w-4" />
          Reko-Link
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rekognoszierungs-Formular</DialogTitle>
          <DialogDescription>
            QR-Code scannen oder Link teilen für mobilen Zugriff
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="text-sm text-muted-foreground">Link wird generiert...</div>
          </div>
        ) : rekoUrl ? (
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="rounded-lg border p-4 bg-white">
              <QRCodeSVG
                value={rekoUrl}
                size={200}
                level="M"
                includeMargin
              />
            </div>

            <div className="w-full">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={rekoUrl}
                  readOnly
                  className="flex-1 rounded-md border px-3 py-2 text-sm bg-muted"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={copyToClipboard}
                >
                  {copied ? (
                    <Check className="h-4 w-4 text-green-600" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>

            <p className="text-xs text-muted-foreground text-center">
              Dieser Link ermöglicht den Zugriff auf das Reko-Formular ohne Anmeldung
            </p>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
