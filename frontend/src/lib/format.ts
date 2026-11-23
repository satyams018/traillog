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

export function formatSpeed(kmh: number | null | undefined): string {
  if (kmh == null) return '–'
  return `${kmh < 10 ? kmh.toFixed(1) : Math.round(kmh)} km/h`
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

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${Math.round(n / 1024)} kB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(n < 10 * 1024 ** 2 ? 1 : 0)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

/** Camera clock offset in seconds -> "+1h 05m", "−3 min", "No offset". */
export function formatOffset(s: number): string {
  if (s === 0) return 'No offset'
  const sign = s > 0 ? '+' : '−'
  const abs = Math.abs(s)
  const h = Math.floor(abs / 3600)
  const m = Math.round((abs % 3600) / 60)
  if (h === 0) return `${sign}${m} min`
  return `${sign}${h}h ${m.toString().padStart(2, '0')}m`
}

/** A photo's time for a polaroid caption, e.g. "10 May, 8:40 am", in the trip's time zone. */
export function formatPhotoTime(iso: string | null, timeZone?: string): string {
  if (!iso) return ''
  try {
    return new Intl.DateTimeFormat('en-IN', {
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: timeZone || undefined,
    }).format(new Date(iso))
  } catch {
    return '' // unknown time zone name
  }
}
