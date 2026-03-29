"use client"

import { useState } from "react"
import { ArrowRightLeft } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { type Person } from "@/lib/contexts/personnel-context"
import { apiClient } from "@/lib/api-client"
import { useEvent } from "@/lib/contexts/event-context"
import { toast } from "sonner"

interface TransferRekoDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  fromPerson: Person | null
  rekoPersonnel: Person[]
  onTransferred: () => void
}

export function TransferRekoDialog({
  open,
  onOpenChange,
  fromPerson,
  rekoPersonnel,
  onTransferred,
}: TransferRekoDialogProps) {
  const { selectedEvent } = useEvent()
  const [isTransferring, setIsTransferring] = useState(false)

  if (!fromPerson) return null

  // Filter out the source person from target list
  const targetOptions = rekoPersonnel.filter(p => p.id !== fromPerson.id)

  const handleTransfer = async (toPerson: Person) => {
    if (!selectedEvent) return
    setIsTransferring(true)
    try {
      const result = await apiClient.transferRekoAssignments(
        fromPerson.id,
        toPerson.id,
        selectedEvent.id,
      )
      onTransferred()
      onOpenChange(false)
    } catch {
      toast.error("Übertragung fehlgeschlagen")
    } finally {
      setIsTransferring(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Rekos übertragen</DialogTitle>
          <DialogDescription>
            Offene Reko-Aufträge von {fromPerson.name} an eine andere Person übertragen.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {targetOptions.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              Keine anderen Reko-Personen verfügbar
            </p>
          ) : (
            targetOptions.map((person) => (
              <Button
                key={person.id}
                variant="outline"
                className="w-full justify-start gap-2"
                onClick={() => handleTransfer(person)}
                disabled={isTransferring}
              >
                <ArrowRightLeft className="h-4 w-4" />
                {person.name}
              </Button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
