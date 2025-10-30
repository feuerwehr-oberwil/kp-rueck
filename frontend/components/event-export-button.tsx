'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Download } from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import { toast } from 'sonner'

interface EventExportButtonProps {
  eventId: string
  eventName: string
}

export function EventExportButton({ eventId, eventName }: EventExportButtonProps) {
  const [exporting, setExporting] = useState(false)

  const handleExport = async () => {
    setExporting(true)
    try {
      const blob = await apiClient.exportEvent(eventId)

      // Create download link
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url

      // Format filename: export_EventName_YYYYMMDD_HHMMSS.zip
      const timestamp = new Date().toISOString()
        .replace(/[-:]/g, '')
        .replace('T', '_')
        .slice(0, 15) // YYYYMMDD_HHMMSS
      const sanitizedName = eventName.replace(/[^a-zA-Z0-9_-]/g, '_')
      a.download = `export_${sanitizedName}_${timestamp}.zip`

      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)

      toast.success('Export erfolgreich heruntergeladen')
    } catch (error) {
      console.error('Export failed:', error)
      toast.error('Export fehlgeschlagen', {
        description: error instanceof Error ? error.message : 'Ein unbekannter Fehler ist aufgetreten'
      })
    } finally {
      setExporting(false)
    }
  }

  return (
    <Button
      onClick={handleExport}
      disabled={exporting}
      variant="outline"
      size="icon"
      title={exporting ? 'Exportiere...' : 'Event exportieren'}
    >
      <Download className="h-4 w-4" />
    </Button>
  )
}
