import { resample } from '../lib/ridge'

interface Stop {
  id: string
  label: string
  fraction: number | null
}

interface Props {
  /** The trip's elevation preview (metres, start to finish). */
  values: number[]
  /** A flat trip: draw the route as a straight line, since its tiny ups and downs would be
   * stretched into fake hills. */
  flat?: boolean
  stops: Stop[]
  /** Index of the last stop scrolled past, or -1. */
  reached: number
  onJump: (id: string) => void
}

const W = 240
const H = 72

/**
 * Sticky overview beside the story: the route (with its climb), a dot per stop, a marker that glides to the
 * stop you're reading, and the stops as a list you can jump through.
 */
export default function StoryRail({ values, stops, reached, onJump, flat = false }: Props) {
  const pts = flat ? [0, 0] : values.length > 1 ? resample(values, 60) : []
  const lo = Math.min(...pts)
  const hi = Math.max(...pts)
  const y = (v: number) => (flat ? H / 2 : H - 6 - ((v - lo) / (hi - lo || 1)) * (H - 14))
  const yAt = (f: number) => (pts.length ? y(pts[Math.round(f * (pts.length - 1))]) : H / 2)
  const line = pts.map((v, i) => `${i ? 'L' : 'M'}${(i / (pts.length - 1)) * W} ${y(v)}`).join(' ')
  const current = reached >= 0 ? stops[reached] : null
  // Before the first stop the marker waits at the trailhead.
  const markerAt = current?.fraction ?? (reached < 0 ? 0 : null)

  return (
    <div className="rounded-3xl border border-line bg-card p-4 shadow-[var(--shadow-soft)]">
      <p className="text-sm font-semibold">Along the route</p>
      {pts.length > 0 && (
        <div className="relative mt-3" style={{ height: H }}>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full"
            aria-hidden
          >
            <path d={`${line} L${W} ${H} L0 ${H} Z`} fill="var(--color-wash)" />
            <path
              d={line}
              fill="none"
              stroke="var(--color-brand)"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          {stops.map(
            (s, i) =>
              s.fraction != null && (
                <button
                  key={s.id}
                  onClick={() => onJump(s.id)}
                  aria-label={`Go to ${s.label}`}
                  title={s.label}
                  className={`absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white transition-colors ${
                    i <= reached ? 'bg-route' : 'bg-brand/60'
                  }`}
                  style={{ left: `${s.fraction * 100}%`, top: yAt(s.fraction) }}
                />
              ),
          )}
          {markerAt != null && (
            <span
              className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white bg-route shadow-[0_0_0_4px_rgb(227_58_110/0.2)] transition-[left,top] duration-700 ease-out"
              style={{ left: `${markerAt * 100}%`, top: yAt(markerAt) }}
              aria-hidden
            />
          )}
        </div>
      )}
      <ol className="mt-4 space-y-0.5 text-sm">
        {stops.map((s, i) => (
          <li key={s.id}>
            <button
              onClick={() => onJump(s.id)}
              aria-current={i === reached ? 'step' : undefined}
              className={`flex w-full items-baseline gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-wash/60 ${
                i === reached ? 'bg-wash font-semibold text-ink' : 'text-muted'
              }`}
            >
              <span className="w-4 shrink-0 text-right tabular-nums">{i + 1}</span>
              <span className="min-w-0 truncate">{s.label}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  )
}
