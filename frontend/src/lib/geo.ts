/** Small geometry helpers for camera framing. Pure functions, unit-tested. */

type LngLat = [number, number] | [number, number, number]

const toRad = (d: number) => (d * Math.PI) / 180
const toDeg = (r: number) => (r * 180) / Math.PI

/** Initial compass bearing from a to b, in degrees clockwise from north (0–360). */
export function bearingDeg(a: LngLat, b: LngLat): number {
  const [lon1, lat1, lon2, lat2] = [toRad(a[0]), toRad(a[1]), toRad(b[0]), toRad(b[1])]
  const y = Math.sin(lon2 - lon1) * Math.cos(lat2)
  const x =
    Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1)
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

/** Index of the point farthest from the first one (works for loops, where start ≈ end). */
export function farthestFromStart(coords: LngLat[]): number {
  const [x0, y0] = coords[0]
  const k = Math.cos(toRad(y0))
  let best = 0
  let bestD = -1
  coords.forEach(([x, y], i) => {
    const d = ((x - x0) * k) ** 2 + (y - y0) ** 2
    if (d > bestD) {
      bestD = d
      best = i
    }
  })
  return best
}

/**
 * Camera bearing that lays the route's main direction left-to-right across the (wide) map,
 * kept within ±90° so the map never ends up upside down.
 */
export function cameraBearingForRoute(coords: LngLat[]): number {
  if (coords.length < 2) return 0
  const far = coords[farthestFromStart(coords)]
  let b = bearingDeg(coords[0], far) - 90
  b = ((b + 540) % 360) - 180 // normalise to (-180, 180]
  if (b > 90) b -= 180
  if (b <= -90) b += 180
  return b
}
