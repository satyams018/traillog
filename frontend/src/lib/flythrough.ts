/**
 * Geometry for the flythrough replay (SPEC F7): distance along the route, the point at a
 * distance, a smoothed camera heading and which photos or stops the camera just passed.
 * Pure functions so the maths is unit-tested; the animation loop lives in TripMap.
 */

type Coord = [number, number] | [number, number, number]

const EARTH_M = 6_371_008.8
const rad = (d: number) => (d * Math.PI) / 180

/** One replay lasts about this long at 1× speed, whatever the route length (like Relive). */
export const REPLAY_MS = 45_000
/** How long the replay pauses on a photo so it can be looked at. */
export const PHOTO_HOLD_MS = 1_800

function haversine(a: Coord, b: Coord): number {
  const dLat = rad(b[1] - a[1])
  const dLon = rad(b[0] - a[0])
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_M * Math.asin(Math.sqrt(h))
}

/** Cumulative distance (m) at each vertex; the last value is the route length. */
export function cumulative(coords: Coord[]): number[] {
  const out = [0]
  for (let i = 1; i < coords.length; i++) out.push(out[i - 1] + haversine(coords[i - 1], coords[i]))
  return out
}

/** The [lng, lat] at distance `d` along the route (clamped to its ends). Binary search. */
export function pointAlong(coords: Coord[], cum: number[], d: number): [number, number] {
  const total = cum[cum.length - 1]
  if (d <= 0 || total === 0) return [coords[0][0], coords[0][1]]
  if (d >= total) return [coords[coords.length - 1][0], coords[coords.length - 1][1]]
  let lo = 0
  let hi = cum.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (cum[mid] <= d) lo = mid
    else hi = mid
  }
  const seg = cum[hi] - cum[lo]
  const t = seg === 0 ? 0 : (d - cum[lo]) / seg
  return [
    coords[lo][0] + t * (coords[hi][0] - coords[lo][0]),
    coords[lo][1] + t * (coords[hi][1] - coords[lo][1]),
  ]
}

/** Camera zoom that shows a few kilometres around the traveller: closer on short routes. */
export function followZoom(totalM: number): number {
  const z = 15.6 - 0.75 * Math.log2(Math.max(totalM, 500) / 1500)
  return Math.min(15.5, Math.max(11.5, z))
}

/** How far ahead the camera looks to set its heading; longer routes look further ahead. */
export function lookAhead(totalM: number): number {
  return Math.min(1500, Math.max(250, totalM * 0.03))
}

/** Move angle `from` toward `to` by share `t` (0..1) the short way round, in degrees. */
export function lerpAngle(from: number, to: number, t: number): number {
  const diff = ((((to - from) % 360) + 540) % 360) - 180
  return (from + diff * t + 360) % 360
}

/** Items whose route position lies in (prev, next]: the ones the camera just passed. */
export function passed<T extends { fraction: number }>(items: T[], prev: number, next: number) {
  return items.filter((it) => it.fraction > prev && it.fraction <= next)
}
