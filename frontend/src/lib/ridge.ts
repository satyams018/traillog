/**
 * Turns an elevation profile into ridge-line SVG paths (the "horizon" drawn from a trek's
 * own climb). Pure functions so the geometry is unit-testable.
 */

export interface RidgeShape {
  /** The ridge-top line only (for the trail stroke). */
  line: string
  /** The ridge closed down to the bottom edge (for the filled silhouette). */
  area: string
  /** First and last point, for the start and finish markers. */
  start: [number, number]
  end: [number, number]
}

/** Evenly resample to n values (linear interpolation), so any profile length draws smoothly. */
export function resample(values: number[], n: number): number[] {
  if (values.length === 0) return []
  if (values.length === 1) return Array(n).fill(values[0])
  return Array.from({ length: n }, (_, i) => {
    const x = (i * (values.length - 1)) / (n - 1)
    const lo = Math.floor(x)
    const hi = Math.min(lo + 1, values.length - 1)
    return values[lo] + (values[hi] - values[lo]) * (x - lo)
  })
}

/**
 * Ridge for `values` in a width × height box. The highest value touches `top`, the lowest
 * sits at `height - base`. Catmull-Rom smoothing keeps it looking like terrain, not a chart.
 * With `inset`, the line starts and ends that far from the edges (so start/finish markers
 * aren't clipped) and the filled area continues flat to the edges.
 */
export function ridgeShape(
  values: number[],
  width: number,
  height: number,
  {
    top = 0,
    base = 0,
    samples = 72,
    inset = 0,
  }: { top?: number; base?: number; samples?: number; inset?: number } = {},
): RidgeShape | null {
  const clean = values.filter((v) => Number.isFinite(v))
  if (clean.length < 2 || width <= 0 || height <= 0) return null
  const vs = resample(clean, samples)
  const min = Math.min(...vs)
  const range = Math.max(...vs) - min || 1
  const span = height - top - base
  const pts: [number, number][] = vs.map((v, i) => [
    inset + (i / (vs.length - 1)) * (width - 2 * inset),
    top + (1 - (v - min) / range) * span,
  ])

  let line = `M${f(pts[0][0])} ${f(pts[0][1])}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(i - 1, 0)]
    const [p1, p2] = [pts[i], pts[i + 1]]
    const p3 = pts[Math.min(i + 2, pts.length - 1)]
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
    line += ` C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`
  }
  const last = pts[pts.length - 1]
  const area =
    `M0 ${f(pts[0][1])} L${line.slice(1)} L${f(width)} ${f(last[1])}` +
    ` L${f(width)} ${f(height)} L0 ${f(height)} Z`
  return { line, area, start: pts[0], end: pts[pts.length - 1] }
}

/** A farther, softer ridge behind the main one: shifted and partly mirrored, so the layers
 * look like distinct ranges rather than copies. */
export function backRidge(values: number[], shift: number): number[] {
  const n = values.length
  if (n < 2) return values
  const mean = values.reduce((a, b) => a + b, 0) / n
  return values.map((_, i) => {
    const j = (i + Math.round(shift * n)) % n
    const mirrored = values[n - 1 - j]
    return mean + (mirrored - mean) * 0.75
  })
}

function f(n: number): string {
  return n.toFixed(1)
}
