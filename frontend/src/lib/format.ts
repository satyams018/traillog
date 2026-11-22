/** Display helpers. Kept pure so they're easy to unit-test. */

export function formatDistance(m: number | null | undefined): string {
  if (m == null) return '–'
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10_000 ? 2 : 1)} km`
}

export function formatElevation(m: number | null | undefined): string {
  return m == null ? '–' : `${Math.round(m).toLocaleString('en-IN')} m`
}

export function formatDuration(s: number | null | undefined): string {
  if (s == null) return '–'
  let h = Math.floor(s / 3600)
  let m = Math.round((s % 3600) / 60)
  if (m === 60) {
    h += 1
    m = 0
  }
  if (h === 0) return `${m} min`
  return m === 0 ? `${h}h` : `${h}h ${m.toString().padStart(2, '0')}m`
}

export function formatPace(sPerKm: number | null | undefined): string {
  if (sPerKm == null) return '–'
  const m = Math.floor(sPerKm / 60)
  const s = Math.round(sPerKm % 60)
  return `${m}:${s.toString().padStart(2, '0')} /km`
}

export function formatDateRange(start: string | null, end: string | null): string {
  if (!start) return ''
  const fmt = (d: string) =>
    new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  return !end || end === start ? fmt(start) : `${fmt(start)} – ${fmt(end)}`
}
