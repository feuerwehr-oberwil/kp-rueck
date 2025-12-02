'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Copy, Check, Loader2, Binoculars } from 'lucide-react'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'
import { useOperations } from '@/lib/contexts/operations-context'

interface RekoQRCodeProps {
  incidentId: string
}

export default function RekoQRCode({ incidentId }: RekoQRCodeProps) {
  const [copied, setCopied] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [showPersonnelPicker, setShowPersonnelPicker] = useState(false)
  const [selectedPersonnelId, setSelectedPersonnelId] = useState<string>('')
  const { personnel } = useOperations()

  // Get personnel (the list is already filtered to checked-in personnel for the current event)
  const availablePersonnel = personnel

  async function copyLinkToClipboard(personnelId?: string) {
    setIsLoading(true)
    try {
      const response = await apiClient.generateRekoLink(incidentId, personnelId)
      const fullUrl = `${window.location.origin}${response.link}`

      await navigator.clipboard.writeText(fullUrl)
      setCopied(true)

      const selectedPerson = personnelId
        ? personnel.find(p => p.id === personnelId)
        : null

      toast.success('Reko-Link kopiert', {
        description: selectedPerson
          ? `Link für ${selectedPerson.name} wurde kopiert`
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

  function handleButtonClick() {
    if (availablePersonnel.length > 0) {
      setShowPersonnelPicker(true)
    } else {
      // No personnel available, generate link without personnel
      copyLinkToClipboard()
    }
  }

  function handleConfirm() {
    copyLinkToClipboard(selectedPersonnelId || undefined)
  }

  function handleSkip() {
    copyLinkToClipboard()
  }

  return (
    <>
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

      <Dialog open={showPersonnelPicker} onOpenChange={setShowPersonnelPicker}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Binoculars className="h-5 w-5" />
              Reko-Person auswählen
            </DialogTitle>
            <DialogDescription>
              Wer geht auf Reko? Diese Information wird im Reko-Bericht gespeichert.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <Select value={selectedPersonnelId} onValueChange={setSelectedPersonnelId}>
              <SelectTrigger>
                <SelectValue placeholder="Person auswählen..." />
              </SelectTrigger>
              <SelectContent>
                {availablePersonnel.map((person) => (
                  <SelectItem key={person.id} value={person.id}>
                    {person.name}
                    {person.role && (
                      <span className="text-muted-foreground ml-2">({person.role})</span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={handleSkip}
                disabled={isLoading}
              >
                Überspringen
              </Button>
              <Button
                onClick={handleConfirm}
                disabled={!selectedPersonnelId || isLoading}
              >
                {isLoading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Copy className="mr-2 h-4 w-4" />
                )}
                Link kopieren
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
