import type { TripStats } from './types'

/** Climb (m) above which a trip counts as hilly, so climb and height are worth showing. */
export const HILLY_GAIN_M = 150

/**
 * City walks, drives and beach days barely climb; for them "1,580 m climb" style numbers are
 * noise. Treks, cycling passes and mountain drives cross the threshold easily.
 */
export function isHilly(stats: Partial<TripStats> | undefined): boolean {
  return (stats?.gain_m ?? 0) >= HILLY_GAIN_M
}
