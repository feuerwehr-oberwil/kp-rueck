'use client'

/**
 * Stats Widget Component
 * Displays real-time event statistics with auto-refresh
 */

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { apiClient, type ApiEventStats } from '@/lib/api-client'
import { Activity, Users, Clock, TrendingUp } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { STATUS_LABELS } from '@/lib/types/incidents'

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

// Helper function to get status label with fallback (labels shared with the
// incident type definitions so board and stats can't drift)
function getStatusLabel(status: string): string {
  return (
    STATUS_LABELS[status as keyof typeof STATUS_LABELS] ||
    status.charAt(0).toUpperCase() + status.slice(1)
  )
}

export function StatsWidget({ eventId }: { eventId: string }) {
  const t = useTranslations('common.statsWidget')
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
        setError(err instanceof Error ? err.message : t('loadError'))
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
          <p className="text-sm text-muted-foreground">{t('loading')}</p>
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
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>
          {t('description')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label={t('activeIncidents')}
            value={totalIncidents}
            icon={<Activity className="h-5 w-5" />}
          />
          <StatCard
            label={t('personnelAvailable')}
            value={`${stats.personnel_available}/${stats.personnel_total}`}
            icon={<Users className="h-5 w-5" />}
          />
          <StatCard
            label={t('avgDuration')}
            value={t('minutesValue', { minutes: stats.avg_duration_minutes })}
            icon={<Clock className="h-5 w-5" />}
          />
          <StatCard
            label={t('utilization')}
            value={`${stats.resource_utilization_percent}%`}
            icon={<TrendingUp className="h-5 w-5" />}
          />
        </div>

        <div>
          <h4 className="text-sm font-medium mb-3">{t('statusDistribution')}</h4>
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
