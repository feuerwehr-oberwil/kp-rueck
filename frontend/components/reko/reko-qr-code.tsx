'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Copy, Check, Loader2, ChevronDown, X } from 'lucide-react'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'
import { useOperations } from '@/lib/contexts/operations-context'
import { useEvent } from '@/lib/contexts/event-context'

interface RekoQRCodeProps {
  incidentId: string
}

export default function RekoQRCode({ incidentId }: RekoQRCodeProps) {
  const [copied, setCopied] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [showPersonnelPicker, setShowPersonnelPicker] = useState(false)
  const [selectedPersonnelId, setSelectedPersonnelId] = useState<string>('')
  const [rekoPersonnel, setRekoPersonnel] = useState<Array<{ id: string; name: string; role?: string }>>([])
  const { personnel, operations } = useOperations()
  const { selectedEvent } = useEvent()

  // Get the current incident's crew
  const incident = operations.find(op => op.id === incidentId)
  const incidentCrew = incident?.crew || []

  async function copyLinkToClipboard(personnelId: string) {
    setIsLoading(true)
    try {
      const response = await apiClient.generateRekoLink(incidentId, personnelId)
      const fullUrl = `${window.location.origin}${response.link}`

      await navigator.clipboard.writeText(fullUrl)
      setCopied(true)

      toast.success('Reko-Link kopiert', {
        description: incident?.location
          ? `Link für "${incident.location}" wurde kopiert`
          : undefined
      })

      setTimeout(() => setCopied(false), 2000)
      setShowPersonnelPicker(false)
      setSelectedPersonnelId('')
    } catch (error) {
      console.error('Failed to generate/copy Reko link:', error)
      toast.error('Fehler beim Kopieren des Links')
    } finally {
      setIsLoading(false)
    }
  }

  async function handleButtonClick() {
    if (!selectedEvent) {
      toast.error('Kein Event ausgewählt')
      return
    }

    setIsLoading(true)
    try {
      // Fetch special functions to find reko personnel
      const specialFunctions = await apiClient.getEventSpecialFunctions(selectedEvent.id)
      const rekoFunctions = specialFunctions.filter(f => f.function_type === 'reko')

      if (rekoFunctions.length === 0) {
        toast.error('Keine Reko-Person zugewiesen', {
          description: 'Bitte zuerst eine Person als Reko markieren (Rechtsklick auf Person → Reko)'
        })
        setIsLoading(false)
        return
      }

      // Map to personnel with names
      const rekoPersonnelList = rekoFunctions
        .map(f => {
          const person = personnel.find(p => p.id === f.personnel_id)
          return person ? { id: person.id, name: person.name, role: person.role } : null
        })
        .filter((p): p is NonNullable<typeof p> => p !== null)

      if (rekoPersonnelList.length === 0) {
        toast.error('Reko-Personen nicht gefunden', {
          description: 'Die zugewiesenen Reko-Personen sind nicht mehr eingecheckt'
        })
        setIsLoading(false)
        return
      }

      // Check if any reko person is already assigned to this incident
      const assignedRekoPersonnel = rekoPersonnelList.filter(rekoPerson =>
        incidentCrew.includes(rekoPerson.name)
      )

      // If a reko person is already assigned to the incident, use them directly
      if (assignedRekoPersonnel.length === 1) {
        await copyLinkToClipboard(assignedRekoPersonnel[0].id)
        return
      }

      // If multiple reko people are assigned to this incident, let user pick from them
      if (assignedRekoPersonnel.length > 1) {
        setRekoPersonnel(assignedRekoPersonnel)
        setShowPersonnelPicker(true)
        return
      }

      // No reko person assigned to incident yet - show all reko personnel
      // If only one reko person total, use them directly
      if (rekoPersonnelList.length === 1) {
        await copyLinkToClipboard(rekoPersonnelList[0].id)
        return
      }

      // Multiple reko personnel - show inline picker
      setRekoPersonnel(rekoPersonnelList)
      setShowPersonnelPicker(true)
    } catch (error) {
      console.error('Failed to load reko personnel:', error)
      toast.error('Fehler beim Laden der Reko-Personen')
    } finally {
      setIsLoading(false)
    }
  }

  function handleConfirm() {
    if (selectedPersonnelId) {
      copyLinkToClipboard(selectedPersonnelId)
    }
  }

  function handleCancel() {
    setShowPersonnelPicker(false)
    setSelectedPersonnelId('')
  }

  // When picker is visible, show inline controls
  if (showPersonnelPicker) {
    return (
      <div className="flex items-center gap-2">
        <Select value={selectedPersonnelId} onValueChange={setSelectedPersonnelId}>
          <SelectTrigger className="w-[180px] h-8">
            <SelectValue placeholder="Reko wählen..." />
          </SelectTrigger>
          <SelectContent>
            {rekoPersonnel.map((person) => (
              <SelectItem key={person.id} value={person.id}>
                {person.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          variant="outline"
          size="sm"
          onClick={handleConfirm}
          disabled={!selectedPersonnelId || isLoading}
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </Button>

        <Button
          variant="ghost"
          size="sm"
          onClick={handleCancel}
          className="h-8 w-8 p-0"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    )
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleButtonClick}
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
