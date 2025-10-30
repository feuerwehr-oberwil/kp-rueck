'use client'

import { useState } from 'react'
import { apiClient, type ApiPersonnelCreate } from '@/lib/api-client'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { UserPlus } from 'lucide-react'

interface QuickAddPersonnelProps {
  onPersonAdded: () => Promise<void>
}

export function QuickAddPersonnel({ onPersonAdded }: QuickAddPersonnelProps) {
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
      await apiClient.createPersonnel(newPerson)
      setNewPersonName('')
      setShowAddForm(false)
      // Reload personnel list to include the new person
      await onPersonAdded()
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
