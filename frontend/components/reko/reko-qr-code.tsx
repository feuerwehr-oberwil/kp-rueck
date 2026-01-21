'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Copy, Check, Loader2, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'
import { useOperations } from '@/lib/contexts/operations-context'
import { useEvent } from '@/lib/contexts/event-context'

interface RekoQRCodeProps {
  incidentId: string
}

export default function RekoQRCode({ incidentId }: RekoQRCodeProps) {
  const [copied, setCopied] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isCopying, setIsCopying] = useState(false)
  const [selectedPersonnelId, setSelectedPersonnelId] = useState<string>('')
  const [rekoPersonnel, setRekoPersonnel] = useState<Array<{ id: string; name: string; role?: string }>>([])
  const [error, setError] = useState<string | null>(null)
  const { personnel, operations } = useOperations()
  const { selectedEvent } = useEvent()

  // Get the current incident's crew
  const incident = operations.find(op => op.id === incidentId)
  const incidentCrew = incident?.crew || []

  // Load reko personnel on mount
  useEffect(() => {
    async function loadRekoPersonnel() {
      if (!selectedEvent) {
        setError('Kein Event ausgewählt')
        setIsLoading(false)
        return
      }

      try {
        setIsLoading(true)
        setError(null)

        // Fetch special functions to find reko personnel
        const specialFunctions = await apiClient.getEventSpecialFunctions(selectedEvent.id)
        const rekoFunctions = specialFunctions.filter(f => f.function_type === 'reko')

        if (rekoFunctions.length === 0) {
          setError('Keine Reko-Person zugewiesen')
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
          setError('Reko-Personen nicht eingecheckt')
          setIsLoading(false)
          return
        }

        // Check if any reko person is already assigned to this incident
        const assignedRekoPersonnel = rekoPersonnelList.filter(rekoPerson =>
          incidentCrew.includes(rekoPerson.name)
        )

        // Prefer assigned reko personnel, otherwise show all
        if (assignedRekoPersonnel.length > 0) {
          setRekoPersonnel(assignedRekoPersonnel)
          // If only one assigned, pre-select them
          if (assignedRekoPersonnel.length === 1) {
            setSelectedPersonnelId(assignedRekoPersonnel[0].id)
          }
        } else {
          setRekoPersonnel(rekoPersonnelList)
          // If only one total, pre-select them
          if (rekoPersonnelList.length === 1) {
            setSelectedPersonnelId(rekoPersonnelList[0].id)
          }
        }
      } catch (err) {
        console.error('Failed to load reko personnel:', err)
        setError('Fehler beim Laden')
      } finally {
        setIsLoading(false)
      }
    }

    loadRekoPersonnel()
  }, [selectedEvent, personnel, incidentCrew])

  // Fallback copy method for Safari (which has stricter clipboard permissions)
  function copyToClipboardFallback(text: string): boolean {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.left = '-9999px'
    textarea.style.top = '-9999px'
    document.body.appendChild(textarea)
    textarea.focus()
    textarea.select()

    try {
      const successful = document.execCommand('copy')
      document.body.removeChild(textarea)
      return successful
    } catch {
      document.body.removeChild(textarea)
      return false
    }
  }

  async function copyLinkToClipboard() {
    if (!selectedPersonnelId) {
      toast.error('Bitte zuerst eine Reko-Person auswählen')
      return
    }

    setIsCopying(true)
    try {
      const response = await apiClient.generateRekoLink(incidentId, selectedPersonnelId)
      const fullUrl = `${window.location.origin}${response.link}`

      // Try modern clipboard API first, fall back to execCommand for Safari
      let copySuccess = false
      try {
        await navigator.clipboard.writeText(fullUrl)
        copySuccess = true
      } catch {
        // Safari often denies clipboard.writeText after async operations
        copySuccess = copyToClipboardFallback(fullUrl)
      }

      if (copySuccess) {
        setCopied(true)
        const selectedPerson = rekoPersonnel.find(p => p.id === selectedPersonnelId)
        toast.success('Reko-Link kopiert', {
          description: selectedPerson
            ? `Link für ${selectedPerson.name} wurde kopiert`
            : undefined
        })
        setTimeout(() => setCopied(false), 2000)
      } else {
        toast.error('Fehler beim Kopieren des Links')
      }
    } catch (err) {
      console.error('Failed to generate/copy Reko link:', err)
      toast.error('Fehler beim Kopieren des Links')
    } finally {
      setIsCopying(false)
    }
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Lade Reko...
      </div>
    )
  }

  // Error state - no reko personnel
  if (error) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <AlertCircle className="h-4 w-4" />
        {error}
      </div>
    )
  }

  // Single reko person - just show copy button
  if (rekoPersonnel.length === 1) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={copyLinkToClipboard}
        disabled={isCopying}
      >
        {isCopying ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : copied ? (
          <Check className="mr-2 h-4 w-4 text-green-600" />
        ) : (
          <Copy className="mr-2 h-4 w-4" />
        )}
        Reko-Link ({rekoPersonnel[0].name})
      </Button>
    )
  }

  // Multiple reko personnel - show dropdown + copy button
  return (
    <div className="flex items-center gap-2">
      <Select value={selectedPersonnelId} onValueChange={setSelectedPersonnelId}>
        <SelectTrigger className="w-[160px] h-8">
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
        onClick={copyLinkToClipboard}
        disabled={!selectedPersonnelId || isCopying}
      >
        {isCopying ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : copied ? (
          <Check className="h-4 w-4 text-green-600" />
        ) : (
          <Copy className="h-4 w-4" />
        )}
      </Button>
    </div>
  )
}
