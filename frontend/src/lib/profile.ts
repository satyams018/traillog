import type { ProfileRow } from './types'

/**
 * Index of the profile sample closest to a map position.
 * Uses an equirectangular approximation (x scaled by cos(lat)), which is accurate enough
 * over a single trek and cheap enough to run on every mouse move (≤ 2,000 samples).
 */
export function nearestProfileIndex(profile: ProfileRow[], lng: number, lat: number): number {
  const k = Math.cos((lat * Math.PI) / 180)
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < profile.length; i++) {
    const dx = (profile[i][3] - lng) * k
    const dy = profile[i][4] - lat
    const d = dx * dx + dy * dy
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

/** Columns for uPlot: x = distance in km, y = elevation in m. */
export function chartData(profile: ProfileRow[]): [number[], (number | null)[]] {
  return [profile.map((r) => r[0] / 1000), profile.map((r) => r[1])]
}
