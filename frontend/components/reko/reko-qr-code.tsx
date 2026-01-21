'use client'

import { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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

// Detect Safari browser
function isSafari(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent.toLowerCase()
  return ua.includes('safari') && !ua.includes('chrome') && !ua.includes('chromium')
}

export default function RekoQRCode({ incidentId }: RekoQRCodeProps) {
  const [copied, setCopied] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isCopying, setIsCopying] = useState(false)
  const [selectedPersonnelId, setSelectedPersonnelId] = useState<string>('')
  const [rekoPersonnel, setRekoPersonnel] = useState<Array<{ id: string; name: string; role?: string }>>([])
  const [error, setError] = useState<string | null>(null)
  // For Safari: show the link in a visible input
  const [showLinkInput, setShowLinkInput] = useState(false)
  const [generatedLink, setGeneratedLink] = useState<string>('')
  const inputRef = useRef<HTMLInputElement>(null)
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

  // Auto-select input text when shown
  useEffect(() => {
    if (showLinkInput && inputRef.current) {
      inputRef.current.select()
    }
  }, [showLinkInput])

  async function copyLinkToClipboard() {
    if (!selectedPersonnelId) {
      toast.error('Bitte zuerst eine Reko-Person auswählen')
      return
    }

    setIsCopying(true)
    try {
      const response = await apiClient.generateRekoLink(incidentId, selectedPersonnelId)
      const fullUrl = `${window.location.origin}${response.link}`

      // Safari: show visible input for manual copy
      if (isSafari()) {
        setGeneratedLink(fullUrl)
        setShowLinkInput(true)
        toast.info('Link bereit - bitte manuell kopieren (Cmd+C)')
        return
      }

      // Chrome and others: use clipboard API directly
      await navigator.clipboard.writeText(fullUrl)
      setCopied(true)

      const selectedPerson = rekoPersonnel.find(p => p.id === selectedPersonnelId)
      toast.success('Reko-Link kopiert', {
        description: selectedPerson
          ? `Link für ${selectedPerson.name} wurde kopiert`
          : undefined
      })

      setTimeout(() => setCopied(false), 2000)
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

  // Safari: Show visible link input for manual copy
  if (showLinkInput) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Input
            ref={inputRef}
            value={generatedLink}
            readOnly
            className="text-xs font-mono h-8"
            onFocus={(e) => e.target.select()}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setShowLinkInput(false)
              setGeneratedLink('')
            }}
          >
            Schliessen
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Link markiert - mit Cmd+C kopieren
        </p>
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
