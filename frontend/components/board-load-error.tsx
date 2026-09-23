"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { CloudOff, RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useOperations } from "@/lib/contexts/operations-context"
import { cn } from "@/lib/utils"

/**
 * What the board area shows when the board has NEVER loaded (`boardNeverLoaded`:
 * the first load failed and nothing has got through since).
 *
 * It replaces the columns rather than sitting on top of them, because empty
 * columns under a notice still read as «no Einsätze» at a glance — and a KP that
 * believes the Ereignis is quiet does not pick up the phone to find out. Once
 * there IS a last good board, this never shows: that board stays usable and the
 * stale-data banner says how old it is (decision 26 A, 2026-09-23).
 *
 * The body names both causes (no answer / an error) on purpose. The first cut
 * said «Der Server antwortet nicht», which a 500 disproves — the same wrong
 * claim the banner's «Verbindung verloren» used to make.
 *
 * ⚠️ No «next automatic attempt in N s» line although the mockup had one: the
 * poll fallback retries, but it keeps no due time anyone could count down to.
 * A countdown that is not tied to the real timer would be a made-up number.
 */
export function BoardLoadErrorPanel() {
  const t = useTranslations("common.boardLoadError")
  const { refreshOperations } = useOperations()
  const [retrying, setRetrying] = useState(false)

  const retry = async () => {
    setRetrying(true)
    try {
      await refreshOperations()
    } finally {
      setRetrying(false)
    }
  }

  return (
    <div className="flex h-full items-start justify-center px-4 pt-[12vh]">
      <section
        role="alert"
        aria-labelledby="board-load-error-title"
        className="flex w-full max-w-md flex-col items-center gap-3 rounded-lg border border-destructive/40 bg-card px-8 py-8 text-center shadow-sm animate-in fade-in duration-300"
      >
        <span className="flex size-12 items-center justify-center rounded-full bg-destructive/10">
          <CloudOff className="size-6 text-destructive" aria-hidden="true" />
        </span>
        <h2 id="board-load-error-title" className="text-lg font-semibold text-foreground">
          {t("title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("body")}</p>
        <Button className="mt-2" onClick={retry} disabled={retrying}>
          <RefreshCw className={cn(retrying && "animate-spin")} aria-hidden="true" />
          {t("retry")}
        </Button>
      </section>
    </div>
  )
}

/**
 * The resource sidebars' counterpart: «Nicht geladen», never «Niemand
 * angemeldet» / «Noch kein Material erfasst». Those are statements about the
 * station; with no answer from the server there is nothing to state.
 */
export function ResourcesNotLoaded({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-6 text-center text-muted-foreground animate-in fade-in duration-300">
      <CloudOff className="size-5" aria-hidden="true" />
      <p className="text-sm">{label}</p>
    </div>
  )
}
