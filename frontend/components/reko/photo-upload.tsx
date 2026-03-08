'use client'

import { useState, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Camera, Upload, X, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'
import { getApiUrl } from '@/lib/env'

interface PhotoUploadProps {
  photos: string[]
  incidentId: string
  token: string
  onPhotosChange: (photos: string[]) => void
}

export default function PhotoUpload({
  photos,
  incidentId,
  token,
  onPhotosChange
}: PhotoUploadProps) {
  const [isUploading, setIsUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)

  // Store local blob URLs for immediate preview (mobile-friendly)
  const [localPreviews, setLocalPreviews] = useState<Map<string, string>>(new Map())

  async function handleFileUpload(files: FileList | null) {
    if (!files || files.length === 0) return

    setIsUploading(true)

    try {
      const uploadPromises = Array.from(files).map(async (file) => {
        // Validate file type
        if (!file.type.startsWith('image/')) {
          toast.error(`${file.name} ist kein Bild`)
          return null
        }

        // Validate file size (max 10MB)
        if (file.size > 10 * 1024 * 1024) {
          toast.error(`${file.name} ist zu gross (max 10MB)`)
          return null
        }

        // Create local blob URL for immediate preview (works better on mobile)
        const localUrl = URL.createObjectURL(file)

        // Upload photo
        const response = await apiClient.uploadRekoPhoto(incidentId, token, file)

        // Store local preview URL mapped to the server filename
        setLocalPreviews(prev => {
          const next = new Map(prev)
          next.set(response.filename, localUrl)
          return next
        })

        return response.filename
      })

      const uploadedFilenames = (await Promise.all(uploadPromises)).filter(
        (filename): filename is string => filename !== null
      )

      if (uploadedFilenames.length > 0) {
        onPhotosChange([...photos, ...uploadedFilenames])
        toast.success(`${uploadedFilenames.length} Foto(s) hochgeladen`)
      }
    } catch (error) {
      console.error('Upload failed:', error)
      const message = error instanceof Error ? error.message : 'Fehler beim Hochladen'
      toast.error(message)
    } finally {
      setIsUploading(false)
      // Reset file inputs
      if (fileInputRef.current) fileInputRef.current.value = ''
      if (cameraInputRef.current) cameraInputRef.current.value = ''
    }
  }

  function handleRemovePhoto(filename: string) {
    // Revoke local blob URL to free memory
    const localUrl = localPreviews.get(filename)
    if (localUrl) {
      URL.revokeObjectURL(localUrl)
      setLocalPreviews(prev => {
        const next = new Map(prev)
        next.delete(filename)
        return next
      })
    }

    onPhotosChange(photos.filter(f => f !== filename))
    toast.success('Foto entfernt')
  }

  // Get photo URL - prefer local blob URL for preview, fall back to server URL
  function getPhotoUrl(filename: string): string {
    // Use local blob URL if available (better for mobile preview)
    const localUrl = localPreviews.get(filename)
    if (localUrl) {
      return localUrl
    }
    // Fall back to server URL
    const apiUrl = getApiUrl()
    return `${apiUrl}/api/photos/${incidentId}/${filename}`
  }

  return (
    <div className="space-y-4">
      {/* Upload Buttons */}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => cameraInputRef.current?.click()}
          disabled={isUploading}
          className="flex-1"
        >
          <Camera className="mr-2 h-4 w-4" />
          Kamera
        </Button>

        <Button
          type="button"
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          className="flex-1"
        >
          <Upload className="mr-2 h-4 w-4" />
          Galerie
        </Button>
      </div>

      {/* Hidden file inputs */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        onChange={(e) => handleFileUpload(e.target.files)}
        className="hidden"
      />

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => handleFileUpload(e.target.files)}
        className="hidden"
      />

      {/* Photo Grid */}
      {photos.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          {photos.map((filename, index) => (
            <div key={index} className="relative aspect-square rounded-lg overflow-hidden bg-muted">
              <img
                src={getPhotoUrl(filename)}
                alt={`Photo ${index + 1}`}
                className="w-full h-full object-cover"
              />
              <button
                type="button"
                onClick={() => handleRemovePhoto(filename)}
                className="absolute top-1 right-1 p-1 bg-destructive text-destructive-foreground rounded-full hover:bg-destructive/90 transition-colors shadow-md"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Loading State */}
      {isUploading && (
        <div className="flex items-center justify-center py-4 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Wird hochgeladen...
        </div>
      )}

      {/* Info */}
      {photos.length === 0 && !isUploading && (
        <p className="text-sm text-muted-foreground text-center py-4">
          Noch keine Fotos hochgeladen
        </p>
      )}
    </div>
  )
}
