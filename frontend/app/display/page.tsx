"use client"

import Link from "next/link"
import { Map, LayoutGrid, BarChart3, ArrowLeft } from "lucide-react"
import { cn } from "@/lib/utils"

const displays = [
  {
    href: "/display/map",
    title: "Lagekarte",
    description: "Vollbild-Karte mit Einsatzorten, Fahrzeug-GPS und Zuweisungslinien",
    icon: Map,
    color: "text-blue-500",
    bg: "bg-blue-500/10 hover:bg-blue-500/15 border-blue-500/20",
  },
  {
    href: "/display/board",
    title: "Board",
    description: "Kanban-Übersicht aller Einsätze nach Status — ohne Bearbeitungsfunktionen",
    icon: LayoutGrid,
    color: "text-orange-500",
    bg: "bg-orange-500/10 hover:bg-orange-500/15 border-orange-500/20",
  },
  {
    href: "/display/status",
    title: "Status",
    description: "Fahrzeuge, Einsätze, Personal und Material — auf einen Blick",
    icon: BarChart3,
    color: "text-emerald-500",
    bg: "bg-emerald-500/10 hover:bg-emerald-500/15 border-emerald-500/20",
  },
]

export default function DisplayIndexPage() {
  return (
    <div className="flex flex-col items-center justify-center gap-8 p-8">
      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight">Display-Ansichten</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Optimiert für Kommandoposten-Monitore — ohne Bearbeitungsfunktionen
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4 w-full max-w-3xl">
        {displays.map((d) => (
          <Link
            key={d.href}
            href={d.href}
            className={cn(
              "flex flex-col items-center gap-3 rounded-lg border p-6 transition-all",
              d.bg
            )}
          >
            <d.icon className={cn("h-10 w-10", d.color)} />
            <div className="text-center">
              <h2 className="font-bold text-lg">{d.title}</h2>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{d.description}</p>
            </div>
          </Link>
        ))}
      </div>

      <Link
        href="/"
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Zurück zum Editor
      </Link>
    </div>
  )
}
