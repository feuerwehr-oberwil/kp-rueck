"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PopoverContent } from "@/components/ui/popover"
import { useOperations, type Operation } from "@/lib/contexts/operations-context"

/** The two card flags that carry a note: «Am Warten» (its reason) and «Nachbarhilfe» (who). */
export type CardFlag = "amWarten" | "nachbarhilfe"

/** Which flag the popover edits, and how it was opened: right after the menu set the flag
 *  (`marked` – «Ohne Grund» is the other answer), or from a click on the chip (`chip` –
 *  «Aufheben» is the other answer). */
export interface FlagEdit {
  flag: CardFlag
  mode: "marked" | "chip"
}

/** The incident fields behind a flag – the same ones the detail's switch and note field write. */
export function flagUpdate(flag: CardFlag, on: boolean, note?: string): Partial<Operation> {
  if (flag === "amWarten") return { amWarten: on, ...(note === undefined ? {} : { amWartenNote: note }) }
  return { nachbarhilfe: on, ...(note === undefined ? {} : { nachbarhilfeNote: note }) }
}

const COPY = {
  amWarten: { title: "amWartenTitle", without: "withoutReason" },
  nachbarhilfe: { title: "nachbarhilfeTitle", without: "withoutNote" },
} as const satisfies Record<CardFlag, { title: string; without: string }>

/**
 * The one-line popover on a card for a flag's note (owner pick 5A, 24.11.2026). Enter saves
 * (an empty line too), Esc closes and writes nothing. Mounted inside the card's `<Popover>`;
 * its content – and with it the board subscription – exists only while it is open. Writes go
 * through `updateOperation`, the funnel the detail's note field uses (text base, conflicts).
 */
export function CardFlagPopoverContent({ operation, edit, onDone }: {
  operation: Operation
  edit: FlagEdit
  onDone: () => void
}) {
  return (
    <PopoverContent
      align="start"
      sideOffset={6}
      className="w-72 p-3"
      // Portalled, but React bubbles through the card: a click or a key here is not the card's.
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <FlagNoteForm operation={operation} edit={edit} onDone={onDone} />
    </PopoverContent>
  )
}

function FlagNoteForm({ operation, edit, onDone }: { operation: Operation; edit: FlagEdit; onDone: () => void }) {
  const t = useTranslations("kanban.card.flagNote")
  const { updateOperation } = useOperations()
  const current = edit.flag === "amWarten" ? operation.amWartenNote : operation.nachbarhilfeNote
  const [text, setText] = useState(current ?? "")
  const copy = COPY[edit.flag]

  const write = (on: boolean, note?: string) => {
    updateOperation(operation.id, flagUpdate(edit.flag, on, note))
    onDone()
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        write(true, text.trim())
      }}
      className="space-y-2"
    >
      <label htmlFor={`flag-note-${operation.id}`} className="block text-sm font-medium">
        {t(copy.title)}
      </label>
      <Input
        id={`flag-note-${operation.id}`}
        autoFocus
        autoComplete="off"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 text-xs text-muted-foreground">{t("hint")}</span>
        {edit.mode === "marked" ? (
          <Button type="button" variant="ghost" size="xs" onClick={() => write(true, "")}>
            {t(copy.without)}
          </Button>
        ) : (
          <Button type="button" variant="ghost" size="xs" onClick={() => write(false)}>
            {t("clear")}
          </Button>
        )}
        <Button type="submit" size="xs">
          {t("save")}
        </Button>
      </div>
    </form>
  )
}
