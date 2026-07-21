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
  /** Optional guard: return true if a person with this name already exists.
   *  Prevents creating indistinguishable same-name duplicates at check-in. */
  isNameTaken?: (name: string) => boolean
}

export function QuickAddPersonnel({ onPersonAdded, checkInToken, isNameTaken }: QuickAddPersonnelProps) {
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
        availability: 'available',
      }
      const createdPerson = await apiClient.createPersonnel(newPerson)

      // Auto-check-in the new person if token is provided
      if (checkInToken && createdPerson.id) {
        try {
          await apiClient.checkInPersonnel(createdPerson.id, checkInToken)
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
        checked_in: !!checkInToken // Will be checked in if token was provided
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
          className="w-full h-12"
        >
          <UserPlus className="h-5 w-5 mr-2" />
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
              className="flex-1 h-11"
            >
              {addingPerson ? t('adding') : t('add')}
            </Button>
            <Button
              onClick={() => {
                setShowAddForm(false)
                setNewPersonName('')
              }}
              variant="outline"
              className="flex-1 h-11"
            >
              {tCommon('cancel')}
            </Button>
          </div>
        </div>
      )}
    </>
  )
}
