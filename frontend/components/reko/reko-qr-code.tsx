'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Copy, Check, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'

interface RekoQRCodeProps {
  incidentId: string
}

export default function RekoQRCode({ incidentId }: RekoQRCodeProps) {
  const [copied, setCopied] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  async function copyLinkToClipboard() {
    if (isLoading) return

    setIsLoading(true)
    try {
      const response = await apiClient.generateRekoLink(incidentId)
      const fullUrl = `${window.location.origin}${response.link}`

      await navigator.clipboard.writeText(fullUrl)
      setCopied(true)
      toast.success('Reko-Link kopiert')
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      console.error('Failed to generate/copy Reko link:', error)
      toast.error('Fehler beim Kopieren des Links')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={copyLinkToClipboard}
      disabled={isLoading}
    >
      {isLoading ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : copied ? (
        <Check className="mr-2 h-4 w-4 text-green-600" />
      ) : (
        <Copy className="mr-2 h-4 w-4" />
      )}
      Reko-Link
    </Button>
  )
}
