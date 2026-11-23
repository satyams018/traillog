import { PALETTE } from '../lib/palette'

/** Small SVG outline of a route for trip cards. Points are [lng, lat]. */
export default function RoutePreview({ points }: { points: [number, number][] }) {
  if (points.length < 2) return null
  const W = 300
  const H = 140
  const PAD = 22
  // Equirectangular projection: shrink longitude by cos(latitude) so shapes aren't stretched.
  const k = Math.cos((points[0][1] * Math.PI) / 180)
  const xs = points.map(([lng]) => lng * k)
  const ys = points.map(([, lat]) => lat)
  const [minX, maxX, minY, maxY] = [
    Math.min(...xs),
    Math.max(...xs),
    Math.min(...ys),
    Math.max(...ys),
  ]
  const scale = Math.min((W - 2 * PAD) / (maxX - minX || 1), (H - 2 * PAD) / (maxY - minY || 1))
  const offX = (W - (maxX - minX) * scale) / 2
  const offY = (H - (maxY - minY) * scale) / 2
  const pts = xs.map((x, i) => [offX + (x - minX) * scale, H - offY - (ys[i] - minY) * scale])
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
  const [sx, sy] = pts[0]
  const [ex, ey] = pts[pts.length - 1]

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" aria-hidden>
      <path
        d={d}
        fill="none"
        stroke="#ffffff"
        strokeWidth={7}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path
        d={d}
        fill="none"
        stroke={PALETTE.route}
        strokeWidth={3.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* Start: blue dot. Finish: raspberry flag. */}
      <circle cx={sx} cy={sy} r={5.5} fill={PALETTE.brand} stroke="#ffffff" strokeWidth={2.5} />
      <path
        d={`M${ex - 1} ${ey + 6} V${ey - 9} L${ex + 9} ${ey - 5.5} L${ex - 1} ${ey - 2}`}
        fill={PALETTE.route}
        stroke="#ffffff"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
    </svg>
  )
}
