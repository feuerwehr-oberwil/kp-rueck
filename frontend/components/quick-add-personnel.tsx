'use client'

import { useState } from 'react'
import { apiClient, type ApiPersonnelCreate } from '@/lib/api-client'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { UserPlus } from 'lucide-react'

interface QuickAddPersonnelProps {
  /** Called after person is added - receives the new person data for optimistic update */
  onPersonAdded: (newPerson?: { id: string; name: string; checked_in: boolean }) => Promise<void>
  /** Optional token for auto-check-in after creation */
  checkInToken?: string
}

export function QuickAddPersonnel({ onPersonAdded, checkInToken }: QuickAddPersonnelProps) {
  const [showAddForm, setShowAddForm] = useState(false)
  const [newPersonName, setNewPersonName] = useState('')
  const [addingPerson, setAddingPerson] = useState(false)

  const addNewPerson = async () => {
    if (!newPersonName.trim()) return

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
      alert('Fehler beim Hinzufügen der Person.')
    } finally {
      setAddingPerson(false)
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
          Neue Person hinzufügen
        </Button>
      ) : (
        <div className="bg-card border-2 border-border rounded-lg p-4 space-y-3">
          <Input
            type="text"
            placeholder="Name eingeben..."
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
              {addingPerson ? 'Wird hinzugefügt...' : 'Hinzufügen'}
            </Button>
            <Button
              onClick={() => {
                setShowAddForm(false)
                setNewPersonName('')
              }}
              variant="outline"
              className="flex-1 h-11"
            >
              Abbrechen
            </Button>
          </div>
        </div>
      )}
    </>
  )
}
