import { ArrowUpToLine, Clock, Footprints, Gauge, Route, TrendingUp } from 'lucide-react'

import { formatDistance, formatDuration, formatElevation, formatPace } from '../lib/format'
import type { TripStats } from '../lib/types'

export default function StatsStrip({ stats }: { stats: Partial<TripStats> }) {
  const items = [
    { icon: Route, label: 'Distance', value: formatDistance(stats.distance_m) },
    { icon: TrendingUp, label: 'Total climb', value: formatElevation(stats.gain_m) },
    { icon: ArrowUpToLine, label: 'Highest point', value: formatElevation(stats.max_ele_m) },
    { icon: Footprints, label: 'Moving time', value: formatDuration(stats.moving_s) },
    { icon: Clock, label: 'Total time', value: formatDuration(stats.total_s) },
    { icon: Gauge, label: 'Moving pace', value: formatPace(stats.pace_s_per_km) },
  ]
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {items.map(({ icon: Icon, label, value }) => (
        <div
          key={label}
          className="rounded-2xl border border-line bg-card px-4 py-3.5 shadow-[var(--shadow-soft)]"
        >
          <dt className="flex items-center gap-1.5 text-sm font-medium text-moss">
            <Icon className="h-4 w-4 text-trail-dark" aria-hidden />
            {label}
          </dt>
          <dd className="mt-1 text-xl font-extrabold tracking-tight tabular-nums sm:text-2xl">
            {value}
          </dd>
        </div>
      ))}
    </dl>
  )
}
