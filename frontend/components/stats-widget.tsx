'use client'

/**
 * Stats Widget Component
 * Displays real-time event statistics with auto-refresh
 */

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { apiClient, type ApiEventStats } from '@/lib/api-client'
import { Activity, Users, Clock, TrendingUp } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'

interface StatCardProps {
  label: string
  value: string | number
  icon: React.ReactNode
}

function StatCard({ label, value, icon }: StatCardProps) {
  return (
    <div className="flex items-center gap-3 p-4 rounded-lg border bg-card">
      <div className="p-2 rounded-lg bg-primary/10 text-primary">
        {icon}
      </div>
      <div className="flex-1">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-2xl font-bold">{value}</p>
      </div>
    </div>
  )
}

const STATUS_LABELS: Record<string, string> = {
  eingegangen: 'Eingegangen',
  reko: 'Reko',
  reko_done: 'Reko abgeschlossen',
  disponiert: 'Disponiert',
  einsatz: 'Einsatz',
  einsatz_beendet: 'Einsatz beendet',
  abschluss: 'Abschluss',
}

// Helper function to get status label with fallback
function getStatusLabel(status: string): string {
  return STATUS_LABELS[status] || status.charAt(0).toUpperCase() + status.slice(1)
}

export function StatsWidget({ eventId }: { eventId: string }) {
  const [stats, setStats] = useState<ApiEventStats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const fetchStats = async () => {
      try {
        setError(null)
        const data = await apiClient.getEventStats(eventId)
        setStats(data)
      } catch (err) {
        console.error('Failed to fetch stats:', err)
        setError(err instanceof Error ? err.message : 'Fehler beim Laden der Statistiken')
      } finally {
        setIsLoading(false)
      }
    }

    fetchStats()
    const interval = setInterval(fetchStats, 10000) // Update every 10s

    return () => clearInterval(interval)
  }, [eventId])

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-sm text-muted-foreground">Statistiken werden geladen...</p>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    )
  }

  if (!stats) {
    return null
  }

  const totalIncidents = Object.values(stats.status_counts).reduce((a, b) => a + b, 0)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Einsatz-Statistiken</CardTitle>
        <CardDescription>
          Echtzeit-Übersicht der aktuellen Einsatzdaten
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Aktive Einsätze"
            value={totalIncidents}
            icon={<Activity className="h-5 w-5" />}
          />
          <StatCard
            label="Personal verfügbar"
            value={`${stats.personnel_available}/${stats.personnel_total}`}
            icon={<Users className="h-5 w-5" />}
          />
          <StatCard
            label="Ø Einsatzdauer"
            value={`${stats.avg_duration_minutes} min`}
            icon={<Clock className="h-5 w-5" />}
          />
          <StatCard
            label="Auslastung"
            value={`${stats.resource_utilization_percent}%`}
            icon={<TrendingUp className="h-5 w-5" />}
          />
        </div>

        <div>
          <h4 className="text-sm font-medium mb-3">Status-Verteilung</h4>
          <div className="flex flex-wrap gap-2">
            {Object.entries(stats.status_counts).map(([status, count]) => (
              <Badge key={status} variant="outline" className="px-3 py-1">
                {getStatusLabel(status)}: {count}
              </Badge>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
