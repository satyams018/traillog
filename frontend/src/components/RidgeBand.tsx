import { useLayoutEffect, useRef, useState } from 'react'

import { backRidge, ridgeShape } from '../lib/ridge'

interface Props {
  /** Elevation profile of the trek, start to finish. */
  values: number[]
  height: number
  /** 'full' draws three ranges, the trail and its start/finish; 'mini' is one quiet ridge. */
  variant?: 'full' | 'mini'
  /** Draw the trail along the ridge once, on mount (respects reduced motion). */
  animate?: boolean
  /** Start dot and finish flag (full variant only). */
  markers?: boolean
  /** Share of the height kept clear below the lowest point (room for overlapping content). */
  baseRatio?: number
  className?: string
}

/**
 * The trek's own climb drawn as a horizon: back ranges in mist, the real profile in forest
 * green, and the trail in orange along its crest. Drawn in real pixels (measured width), so
 * strokes and markers never stretch.
 */
export default function RidgeBand({
  values,
  height,
  variant = 'full',
  animate = false,
  markers = true,
  baseRatio = 0.12,
  className = '',
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.clientWidth)
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const full = variant === 'full'
  const front = ridgeShape(values, width, height, {
    top: full ? height * 0.3 : height * 0.15,
    base: full ? height * baseRatio : 0,
    // Keep the start dot and finish flag on screen.
    inset: full ? Math.min(Math.max(width * 0.05, 28), 96) : 0,
  })
  const mid = full
    ? ridgeShape(backRidge(values, 0.35), width, height, { top: height * 0.12, base: height * 0.3 })
    : null
  const far = full
    ? ridgeShape(backRidge(values, 0.7), width, height, { top: 0, base: height * 0.45 })
    : null

  return (
    <div ref={ref} className={`w-full ${className}`} style={{ height }} aria-hidden>
      {front && (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block">
          {far && <path d={far.area} fill="var(--color-mist)" />}
          {mid && <path d={mid.area} fill="var(--color-pine)" fillOpacity={0.55} />}
          <path d={front.area} fill={full ? 'var(--color-brand)' : 'var(--color-wash)'} />
          {full && (
            <path
              d={front.line}
              fill="none"
              stroke="#ffffff"
              strokeOpacity={0.9}
              strokeWidth={9}
              strokeLinecap="round"
              pathLength={1}
              className={animate ? 'trail-draw' : undefined}
            />
          )}
          <path
            d={front.line}
            fill="none"
            stroke="var(--color-route)"
            strokeWidth={full ? 4.5 : 2}
            strokeLinecap="round"
            pathLength={1}
            className={animate ? 'trail-draw' : undefined}
          />
          {full && markers && (
            <g className={animate ? 'trail-markers' : undefined}>
              <circle
                cx={front.start[0]}
                cy={front.start[1]}
                r={7}
                fill="var(--color-brand)"
                stroke="#ffffff"
                strokeWidth={3}
              />
              <path
                d={`M${front.end[0]} ${front.end[1] + 2} V${front.end[1] - 24} L${front.end[0] + 15} ${front.end[1] - 17.5} L${front.end[0]} ${front.end[1] - 11}`}
                fill="var(--color-route)"
                stroke="#ffffff"
                strokeWidth={2}
                strokeLinejoin="round"
              />
            </g>
          )}
        </svg>
      )}
    </div>
  )
}
