'use client'

import { useState } from 'react'
import { Copy, Check } from 'lucide-react'
import { Button } from './button'
import { toast } from 'sonner'

interface CopyButtonProps {
  text: string
  size?: 'default' | 'sm' | 'lg' | 'icon'
  variant?: 'default' | 'outline' | 'ghost' | 'secondary'
  className?: string
}

export function CopyButton({
  text,
  size = 'sm',
  variant = 'outline',
  className = ''
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      toast.success('Kopiert', {
        description: 'Text wurde in die Zwischenablage kopiert.',
      })

      // Reset copied state after 2 seconds
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      console.error('Failed to copy text:', error)
      toast.error('Fehler', {
        description: 'Text konnte nicht kopiert werden.',
      })
    }
  }

  return (
    <Button
      size={size}
      variant={copied ? 'default' : variant}
      onClick={handleCopy}
      className={className}
    >
      {copied ? (
        <>
          <Check className="h-4 w-4 mr-1" />
          Kopiert
        </>
      ) : (
        <>
          <Copy className="h-4 w-4 mr-1" />
          Kopieren
        </>
      )}
    </Button>
  )
}
