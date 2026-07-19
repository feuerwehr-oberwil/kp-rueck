'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Copy, Check } from 'lucide-react'
import { Button } from './button'
import { toast } from 'sonner'
import { copyToClipboard } from '@/lib/utils'

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
  const t = useTranslations('common.copyButton')
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await copyToClipboard(text)
      setCopied(true)
      toast.success(t('copiedTitle'), {
        description: t('copiedDescription'),
      })

      // Reset copied state after 2 seconds
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      console.error('Failed to copy text:', error)
      toast.error(t('errorTitle'), {
        description: t('errorDescription'),
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
          {t('copied')}
        </>
      ) : (
        <>
          <Copy className="h-4 w-4 mr-1" />
          {t('copy')}
        </>
      )}
    </Button>
  )
}
