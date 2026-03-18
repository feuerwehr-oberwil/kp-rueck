"use client"

import Link from "next/link"
import { Map, LayoutGrid, BarChart3, ArrowLeft, ExternalLink } from "lucide-react"
import { cn } from "@/lib/utils"

const displays = [
  {
    href: "/display/map",
    title: "Lagekarte",
    description: "Karte mit Einsatzorten und Fahrzeug-GPS",
    icon: Map,
    color: "text-blue-500",
    border: "border-blue-500/30 hover:border-blue-500/60",
  },
  {
    href: "/display/board",
    title: "Board",
    description: "Kanban-Übersicht aller Einsätze",
    icon: LayoutGrid,
    color: "text-orange-500",
    border: "border-orange-500/30 hover:border-orange-500/60",
  },
  {
    href: "/display/status",
    title: "Status",
    description: "Fahrzeuge, Einsätze, Personal, Material",
    icon: BarChart3,
    color: "text-emerald-500",
    border: "border-emerald-500/30 hover:border-emerald-500/60",
  },
]

export default function DisplayIndexPage() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 p-8">
      <div className="grid grid-cols-3 gap-3 w-full max-w-2xl">
        {displays.map((d) => (
          <Link
            key={d.href}
            href={d.href}
            className={cn(
              "flex flex-col items-center gap-2.5 rounded-lg border bg-card/50 p-5 transition-all",
              d.border
            )}
          >
            <d.icon className={cn("h-7 w-7", d.color)} />
            <div className="text-center">
              <h2 className="font-bold text-sm">{d.title}</h2>
              <p className="text-[11px] text-muted-foreground mt-0.5">{d.description}</p>
            </div>
          </Link>
        ))}
      </div>

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
