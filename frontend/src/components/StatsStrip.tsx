import { formatDistance, formatDuration, formatElevation, formatSpeed } from '../lib/format'
import { isHilly } from '../lib/stats'
import type { TripStats } from '../lib/types'

type Item = { label: string; value: string; show: boolean }

/**
 * Trip numbers in two weights. `lead`: distance and time, plus climb for hilly trips, in
 * large numerals over the map. `quiet`: moving time, average speed and (hilly trips) the
 * highest point, in a small row. Numbers the GPX can't give (no times, no elevation) are left
 * out rather than shown as dashes.
 */
export default function StatsStrip({
  stats,
  variant,
}: {
  stats: Partial<TripStats>
  variant: 'lead' | 'quiet'
}) {
  const hilly = isHilly(stats)
  if (variant === 'lead') {
    const items: Item[] = [
      { label: 'distance', value: formatDistance(stats.distance_m), show: true },
      { label: 'time', value: formatDuration(stats.total_s), show: stats.total_s != null },
      { label: 'climb', value: formatElevation(stats.gain_m), show: hilly },
    ]
    return (
      <dl className="flex gap-6">
        {items
          .filter((i) => i.show)
          .map(({ label, value }) => (
            <div key={label} className="flex flex-col-reverse">
              <dt className="text-sm text-muted">{label}</dt>
              <dd className="text-2xl font-extrabold tracking-[-0.03em] whitespace-nowrap text-brand tabular-nums sm:text-[1.75rem]">
                {value}
              </dd>
            </div>
          ))}
      </dl>
    )
  }
  const items: Item[] = [
    { label: 'Moving time', value: formatDuration(stats.moving_s), show: stats.moving_s != null },
    {
      label: 'Average speed',
      value: formatSpeed(stats.avg_moving_speed_kmh),
      show: stats.avg_moving_speed_kmh != null,
    },
    { label: 'Highest point', value: formatElevation(stats.max_ele_m), show: hilly },
  ]
  return (
    <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
      {items
        .filter((i) => i.show)
        .map(({ label, value }) => (
          <div key={label} className="flex gap-1.5">
            <dt className="text-muted">{label}</dt>
            <dd className="font-bold tabular-nums">{value}</dd>
          </div>
        ))}
    </dl>
  )
}
