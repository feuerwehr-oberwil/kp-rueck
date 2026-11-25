"use client"

import { useTranslations } from "next-intl"
import { useDisplaySearch } from "@/lib/contexts/display-search-context"

/**
 * «1 von 23 Einsätzen» right under the display's search while it filters (owner pick
 * «Suchfeld über den Spalten», hunt 2026-11-24): a board that hides most of a storm says so,
 * at every width, and does not scroll away with the columns. Both boards put it above their
 * scroller – the signed-in one and the share link's.
 */
export function DisplaySearchHits({ shown, total }: { shown: number; total: number }) {
  const t = useTranslations("display")
  const { query } = useDisplaySearch()
  if (!query.trim()) return null
  return (
    <p role="status" className="shrink-0 px-3 pt-2 text-sm text-muted-foreground">
      {t("layout.searchHits", { shown, total })}
    </p>
  )
}
