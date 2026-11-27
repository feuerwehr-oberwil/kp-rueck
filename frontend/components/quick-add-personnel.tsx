'use client'

import { useId, useState, useRef } from 'react'
import { apiClient, ApiError, NetworkError, type ApiPersonnelCreate } from '@/lib/api-client'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ShellLoader } from '@/components/ui/shell-loader'
import { UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { FormMessage, fieldMessageProps, focusFirstBlockingField, formMessageId } from '@/components/ui/form-message'
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
  /** The Ereignis the person is added to. They become its GUEST, not a roster member:
   *  listed there only, never in Settings ≫ Personal or another Ereignis (#5, 19.11.2026). */
  guestEventId: string
  /** Optional guard: return true if a person with this name already exists.
   *  Prevents creating indistinguishable same-name duplicates at check-in. */
  isNameTaken?: (name: string) => boolean
  /** Pause adding while the kiosk reconnects, preserving the name being entered. */
  submissionDisabled?: boolean
  /** `false` drops the card frame around the open form – for a mount that already sits
   *  in its own framed footer (the phone Appell sheet), where a box inside the bar was
   *  one frame too many. Default `true` (the /check-in page). */
  framed?: boolean
}

export function QuickAddPersonnel({
  onPersonAdded,
  checkInToken,
  checkInEventId,
  guestEventId,
  isNameTaken,
  submissionDisabled = false,
  framed = true,
}: QuickAddPersonnelProps) {
  const t = useTranslations('incidents.quickAdd')
  const tCommon = useTranslations('incidents.common')
  const tForm = useTranslations('common.formMessage')
  const [showAddForm, setShowAddForm] = useState(false)
  const [newPersonName, setNewPersonName] = useState('')
  const [addingPerson, setAddingPerson] = useState(false)
  // What is wrong with the typed name (missing, or already on the list), said under it.
  const [nameError, setNameError] = useState<string | null>(null)
  const nameId = useId()
  // Synchronous guard: React state updates async, so two very fast Enter/tap
  // presses can both pass an `if (addingPerson)` check before the first
  // setState lands. A ref flips immediately, and a short cooldown after
  // completion absorbs an accidental double-press.
  const addingRef = useRef(false)

  const addNewPerson = async () => {
    const trimmedName = newPersonName.trim()
    if (addingRef.current || submissionDisabled) return
    // Disallow indistinguishable same-name duplicates. The server's own 409 below
    // stays a toast: by then the form has been sent.
    const problem = !trimmedName
      ? tForm('nameRequired')
      : isNameTaken?.(trimmedName)
        ? t('duplicateDescription')
        : null
    if (problem) {
      setNameError(problem)
      focusFirstBlockingField([nameId])
      return
    }
    addingRef.current = true

    setAddingPerson(true)
    try {
      const newPerson: ApiPersonnelCreate = {
        name: newPersonName.trim(),
        status: 'available',
        guest_event_id: guestEventId,
      }
      const createdPerson = await apiClient.createPersonnel(newPerson)

      // Auto-check-in the new person, through whichever door this mount has.
      const willCheckIn = !!(checkInToken || checkInEventId)
      let checkedIn = false
      if (willCheckIn && createdPerson.id) {
        try {
          if (checkInToken) {
            await apiClient.checkInPersonnel(createdPerson.id, checkInToken)
          } else if (checkInEventId) {
            await apiClient.checkInPersonnelForEvent(createdPerson.id, checkInEventId)
          }
          checkedIn = true
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
        checked_in: checkedIn
      })
    } catch (error) {
      console.error('Failed to add person:', error)
      // Provide specific error messages based on error type
      if (NetworkError.isNetworkError(error)) {
        toast.error(t('networkErrorTitle'), {
          description: t('networkErrorDescription')
        })
      } else if (ApiError.isConflictError(error)) {
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
          disabled={submissionDisabled}
          variant="outline"
          size="lg"
          className="w-full"
        >
          <UserPlus className="size-4" />
          {t('addNewPerson')}
        </Button>
      ) : (
        <div
          data-slot="quick-add-form"
          className={framed ? 'bg-card border-2 border-border rounded-lg p-4 space-y-3' : 'space-y-2'}
        >
          <Input
            id={nameId}
            type="text"
            placeholder={t('namePlaceholder')}
            value={newPersonName}
            onChange={(e) => {
              setNewPersonName(e.target.value)
              setNameError(null)
            }}
            {...fieldMessageProps(nameId, nameError ? 'error' : null)}
            onKeyPress={(e) => {
              if (e.key === 'Enter') {
                void addNewPerson()
              }
            }}
            className="h-12 text-lg"
            autoFocus
          />
          <FormMessage id={formMessageId(nameId)}>{nameError}</FormMessage>
          <div className="flex gap-2">
            <Button
              onClick={() => void addNewPerson()}
              disabled={addingPerson || submissionDisabled}
              className="flex-1"
            >
              {addingPerson && <ShellLoader className="size-4" />}
              {addingPerson ? t('adding') : t('add')}
            </Button>
            <Button
              onClick={() => {
                setShowAddForm(false)
                setNewPersonName('')
                setNameError(null)
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
