'use client'

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Command as CommandPrimitive, useCommandState } from 'cmdk'
import { SearchIcon, XIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

function Command({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn(
        'bg-popover text-popover-foreground flex h-full w-full flex-col overflow-hidden rounded-md',
        className,
      )}
      {...props}
    />
  )
}

function CommandDialog({
  title = 'Command Palette',
  description = 'Search for a command to run...',
  children,
  className,
  showCloseButton = false,
  ...props
}: React.ComponentProps<typeof Dialog> & {
  title?: string
  description?: string
  className?: string
  showCloseButton?: boolean
}) {
  return (
    <Dialog {...props}>
      <DialogHeader className="sr-only">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <DialogContent
        className={cn('overflow-hidden p-0', className)}
        showCloseButton={showCloseButton}
      >
        <Command className="[&_[cmdk-group-heading]]:text-muted-foreground **:data-[slot=command-input-wrapper]:h-12 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group]]:px-2 [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5">
          {children}
        </Command>
      </DialogContent>
    </Dialog>
  )
}

function CommandInput({
  className,
  showClose = false,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input> & {
  showClose?: boolean
}) {
  const t = useTranslations('kanban.common')
  return (
    <div
      data-slot="command-input-wrapper"
      className="flex h-9 items-center gap-2 border-b px-(--field-px)"
    >
      <SearchIcon className="size-4 shrink-0 opacity-50" />
      <CommandPrimitive.Input
        data-slot="command-input"
        className={cn(
          'placeholder:text-muted-foreground flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-hidden disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      />
      {showClose && (
        <DialogPrimitive.Close
          data-slot="command-input-close"
          className="ring-offset-background focus:ring-ring hover:bg-muted hover:text-foreground -mr-1 inline-flex size-7 shrink-0 items-center justify-center rounded-sm opacity-70 transition-colors hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden cursor-pointer"
          aria-label={t('close')}
        >
          <XIcon className="size-4" />
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function CommandList({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn(
        'max-h-[300px] scroll-py-1 overflow-x-hidden overflow-y-auto',
        className,
      )}
      {...props}
    />
  )
}

function CommandEmpty({
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className="py-6 text-center text-sm"
      {...props}
    />
  )
}

function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        'text-foreground [&_[cmdk-group-heading]]:text-muted-foreground overflow-hidden p-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium',
        className,
      )}
      {...props}
    />
  )
}

function CommandSeparator({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      data-slot="command-separator"
      className={cn('bg-border -mx-1 h-px', className)}
      {...props}
    />
  )
}

function CommandItem({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        "data-[selected=true]:bg-foreground/10 data-[selected=true]:text-foreground [&_svg:not([class*='text-'])]:text-muted-foreground relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    />
  )
}

/**
 * Ranks a filtered list as a whole: groups by their best item, items inside a
 * group by score. The first row – the one cmdk highlights and ↵ runs – is then
 * the best match overall, not the best match of the first group that matches
 * at all («neu» opened «Einstellungen» from Navigation instead of «Neuer
 * Einsatz» further down). cmdk 1.1 means to rank groups itself but never does:
 * it looks each group up by `data-value="<group id>"`, and a group's data-value
 * is its heading. Items it ranks only while they are rendered, so ones that
 * reappear (backspace) land unranked; this pass covers those too.
 *
 * Render once anywhere inside `<Command>`. It runs in a layout effect, which
 * React fires before cmdk's own (a parent's) one that highlights the first row.
 */
function CommandRankGroups() {
  const search = useCommandState((state) => state.search)
  const scores = useCommandState((state) => state.filtered.items)
  const ref = React.useRef<HTMLSpanElement>(null)

  React.useLayoutEffect(() => {
    if (!search) return
    const sizer = ref.current?.closest('[cmdk-root]')?.querySelector('[cmdk-list-sizer]')
    if (!sizer) return
    const score = (el: Element) => scores.get(el.id) ?? 0
    const ranked = (els: Element[], rank: (el: Element) => number) =>
      els
        .map((el, index) => ({ el, index, rank: rank(el) }))
        .sort((a, b) => b.rank - a.rank || a.index - b.index)
        .map(({ el }) => el)
    const reorder = (parent: Element, els: Element[], rank: (el: Element) => number) => {
      const next = ranked(els, rank)
      if (next.every((el, i) => el === els[i])) return
      next.forEach((el) => parent.appendChild(el))
    }

    const groups = Array.from(sizer.children).filter((el) => el.hasAttribute('cmdk-group'))
    for (const group of groups) {
      const items = group.querySelector('[cmdk-group-items]')
      if (items) reorder(items, Array.from(items.children).filter((el) => el.hasAttribute('cmdk-item')), score)
    }
    reorder(sizer, groups, (group) =>
      Math.max(0, ...Array.from(group.querySelectorAll('[cmdk-item]'), score)),
    )
  }, [search, scores])

  return <span ref={ref} hidden aria-hidden />
}

function CommandShortcut({
  className,
  ...props
}: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="command-shortcut"
      className={cn(
        'text-muted-foreground ml-auto text-xs tracking-widest',
        className,
      )}
      {...props}
    />
  )
}

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandRankGroups,
  CommandShortcut,
  CommandSeparator,
}
