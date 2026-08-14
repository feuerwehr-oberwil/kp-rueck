'use client'

import { useState, useRef } from 'react'
import { apiClient, type ApiPersonnelCreate } from '@/lib/api-client'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'

interface QuickAddPersonnelProps {
  /** Called after person is added - receives the new person data for optimistic update */
  onPersonAdded: (newPerson?: { id: string; name: string; checked_in: boolean }) => Promise<void>
  /** Optional token for auto-check-in after creation */
  checkInToken?: string
  /** Optional Ereignis for auto-check-in on the board, where there is no token.
   *  Somebody is being added because they are standing in front of the operator —
   *  adding them and leaving them absent is the wrong default in exactly that moment.
   *  Also the documented route for Nachbarhilfe and Zivilschutz. */
  checkInEventId?: string
  /** Optional guard: return true if a person with this name already exists.
   *  Prevents creating indistinguishable same-name duplicates at check-in. */
  isNameTaken?: (name: string) => boolean
}

export function QuickAddPersonnel({
  onPersonAdded,
  checkInToken,
  checkInEventId,
  isNameTaken,
}: QuickAddPersonnelProps) {
  const t = useTranslations('incidents.quickAdd')
  const tCommon = useTranslations('incidents.common')
  const [showAddForm, setShowAddForm] = useState(false)
  const [newPersonName, setNewPersonName] = useState('')
  const [addingPerson, setAddingPerson] = useState(false)
  // Synchronous guard: React state updates async, so two very fast Enter/tap
  // presses can both pass an `if (addingPerson)` check before the first
  // setState lands. A ref flips immediately, and a short cooldown after
  // completion absorbs an accidental double-press.
  const addingRef = useRef(false)

  const addNewPerson = async () => {
    const trimmedName = newPersonName.trim()
    if (!trimmedName) return
    if (addingRef.current) return
    // Disallow indistinguishable same-name duplicates
    if (isNameTaken?.(trimmedName)) {
      toast.error(t('duplicateTitle'), { description: t('duplicateDescription') })
      return
    }
    addingRef.current = true

    setAddingPerson(true)
    try {
      const newPerson: ApiPersonnelCreate = {
        name: newPersonName.trim(),
        status: 'available',
      }
      const createdPerson = await apiClient.createPersonnel(newPerson)

      // Auto-check-in the new person, through whichever door this mount has.
      const willCheckIn = !!(checkInToken || checkInEventId)
      if (willCheckIn && createdPerson.id) {
        try {
          if (checkInToken) {
            await apiClient.checkInPersonnel(createdPerson.id, checkInToken)
          } else if (checkInEventId) {
            await apiClient.checkInPersonnelForEvent(createdPerson.id, checkInEventId)
          }
        } catch (checkInError) {
          console.error('Failed to auto-check-in new person:', checkInError)
          // Don't fail the whole operation if check-in fails
        }
      }

      setNewPersonName('')
      setShowAddForm(false)
      // Notify parent with the new person data for optimistic update
      await onPersonAdded({
        id: createdPerson.id,
        name: createdPerson.name,
        checked_in: willCheckIn
      })
    } catch (error) {
      console.error('Failed to add person:', error)
      // Provide specific error messages based on error type
      if (error instanceof TypeError && error.message.includes('fetch')) {
        toast.error(t('networkErrorTitle'), {
          description: t('networkErrorDescription')
        })
      } else if (error instanceof Error && error.message.includes('409')) {
        toast.error(t('duplicateTitle'), {
          description: t('duplicateDescription')
        })
      } else {
        toast.error(t('addErrorTitle'), {
          description: t('addErrorDescription')
        })
      }
    } finally {
      setAddingPerson(false)
      // Small cooldown so an accidental double-press doesn't add twice.
      setTimeout(() => { addingRef.current = false }, 400)
    }
  }

  return (
    <>
      {!showAddForm ? (
        <Button
          onClick={() => setShowAddForm(true)}
          variant="outline"
          size="lg"
          className="w-full"
        >
          <UserPlus className="size-4" />
          {t('addNewPerson')}
        </Button>
      ) : (
        <div className="bg-card border-2 border-border rounded-lg p-4 space-y-3">
          <Input
            type="text"
            placeholder={t('namePlaceholder')}
            value={newPersonName}
            onChange={(e) => setNewPersonName(e.target.value)}
            onKeyPress={(e) => {
              if (e.key === 'Enter') {
                addNewPerson()
              }
            }}
            className="h-12 text-lg"
            autoFocus
          />
          <div className="flex gap-2">
            <Button
              onClick={addNewPerson}
              disabled={!newPersonName.trim() || addingPerson}
              className="flex-1"
            >
              {addingPerson ? t('adding') : t('add')}
            </Button>
            <Button
              onClick={() => {
                setShowAddForm(false)
                setNewPersonName('')
              }}
              variant="outline"
              className="flex-1"
            >
              {tCommon('cancel')}
            </Button>
          </div>
        </div>
      )}
    </>
  )
}
