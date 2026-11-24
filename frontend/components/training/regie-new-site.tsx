'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { MessageSquare } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { FormMessage, fieldMessageProps, formMessageId } from '@/components/ui/form-message'
import { Input } from '@/components/ui/input'
import { ShellLoader } from '@/components/ui/shell-loader'

/**
 * «Neuer Schadenplatz …»: what the Trupp reports, in free text, with three quick-fills that
 * only fill the field (the trainer can still edit before it goes out). `onSend` gets the
 * trimmed text and resolves true once it went out; only then the field empties.
 */
export function RegieNewSiteForm({ busy, onSend }: { busy: boolean; onSend: (text: string) => Promise<boolean> }) {
  const t = useTranslations('training.simulation')
  const [text, setText] = useState('')
  const [tried, setTried] = useState(false)
  const missing = tried && !text.trim() ? t('fieldReportTextRequired') : undefined

  const send = async () => {
    if (busy) return
    if (!text.trim()) {
      setTried(true)
      document.getElementById('regie-new-site')?.focus()
      return
    }
    if (!(await onSend(text.trim()))) return // the toast said why; the text stays
    setText('')
    setTried(false)
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Input
          id="regie-new-site"
          {...fieldMessageProps('regie-new-site', missing ? 'error' : null)}
          aria-label={t('fieldReportPlaceholder')}
          placeholder={t('fieldReportPlaceholder')}
          autoComplete="off"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void send()
          }}
          className="min-w-0 flex-1"
        />
        <Button onClick={() => void send()} disabled={busy} variant="outline" className="shrink-0">
          {busy ? <ShellLoader className="size-3.5" /> : <MessageSquare className="size-3.5" />}
          {busy ? t('fieldReportSending') : t('fieldReportSend')}
        </Button>
      </div>
      <FormMessage id={formMessageId('regie-new-site')}>{missing}</FormMessage>
      <div className="flex flex-wrap gap-1.5">
        {[t('fieldReportExample1'), t('fieldReportExample2'), t('fieldReportExample3')].map((example) => (
          <Button key={example} variant="outline" size="sm" className="text-muted-foreground" onClick={() => setText(example)}>
            {example}
          </Button>
        ))}
      </div>
    </div>
  )
}
