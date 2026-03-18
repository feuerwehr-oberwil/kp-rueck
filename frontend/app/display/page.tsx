"use client"

import Link from "next/link"
import { ArrowLeft } from "lucide-react"

export default function DisplayIndexPage() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-6">
      <nav className="flex gap-3">
        <DisplayLink href="/display/map" label="Lagekarte" />
        <DisplayLink href="/display/board" label="Board" />
        <DisplayLink href="/display/status" label="Status" />
      </nav>
      <Link
        href="/"
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Editor
      </Link>
    </div>
  )
}

function DisplayLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="px-6 py-3 rounded-md border border-border bg-card hover:bg-muted transition-colors text-sm font-medium"
    >
      {label}
    </Link>
  )
}
