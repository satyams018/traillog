import { useEffect, useLayoutEffect, useRef } from 'react'
import uPlot from 'uplot'

import { chartData } from '../lib/profile'
import type { ProfileRow } from '../lib/types'

interface Props {
  profile: ProfileRow[]
  hoverIndex: number | null
  onHoverIndex: (i: number | null) => void
  height?: number
}

/**
 * Elevation profile drawn with uPlot (canvas; fast with thousands of points, ADR-16).
 * Two-way sync: hovering here reports an index; an external index moves the cursor.
 */
export default function ElevationChart({ profile, hoverIndex, onHoverIndex, height = 160 }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const plotRef = useRef<uPlot | null>(null)
  const onHoverRef = useRef(onHoverIndex)
  useLayoutEffect(() => {
    onHoverRef.current = onHoverIndex
  })
  // True while we move the cursor ourselves, so the hook doesn't echo it back.
  const syncing = useRef(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const opts: uPlot.Options = {
      width: el.clientWidth,
      height,
      padding: [12, 8, 0, 0],
      legend: { show: false },
      cursor: { y: false, points: { size: 10, fill: '#F07C1E' }, drag: { x: false, y: false } },
      scales: { x: { time: false } },
      axes: [
        {
          stroke: '#56655C',
          grid: { show: false },
          ticks: { stroke: '#DFE5DA' },
          values: (_u, vals) => vals.map((v) => `${v} km`),
          font: '500 12px "Plus Jakarta Sans", sans-serif',
        },
        {
          stroke: '#56655C',
          grid: { stroke: '#DFE5DA', width: 1 },
          ticks: { show: false },
          size: 68, // room for "4,000 m" in the bolder font
          values: (_u, vals) => vals.map((v) => `${v.toLocaleString('en-IN')} m`),
          font: '500 12px "Plus Jakarta Sans", sans-serif',
        },
      ],
      series: [
        {},
        {
          label: 'Elevation',
          stroke: '#1F5C3F',
          width: 2.5,
          fill: (u) => {
            const g = u.ctx.createLinearGradient(0, 0, 0, u.bbox.height)
            g.addColorStop(0, 'rgba(31,92,63,0.28)')
            g.addColorStop(1, 'rgba(31,92,63,0.03)')
            return g
          },
          points: { show: false },
        },
      ],
      hooks: {
        setCursor: [
          (u) => {
            if (syncing.current) return
            onHoverRef.current(u.cursor.idx ?? null)
          },
        ],
      },
    }
    const plot = new uPlot(opts, chartData(profile), el)
    plotRef.current = plot

    const ro = new ResizeObserver(() => plot.setSize({ width: el.clientWidth, height }))
    ro.observe(el)
    const leave = () => onHoverRef.current(null)
    el.addEventListener('mouseleave', leave)
    return () => {
      ro.disconnect()
      el.removeEventListener('mouseleave', leave)
      plot.destroy()
      plotRef.current = null
    }
  }, [profile, height])

  // External index (map hover) -> move the chart cursor.
  useEffect(() => {
    const u = plotRef.current
    if (!u || hoverIndex == null) return
    if (u.cursor.idx === hoverIndex) return
    const x = u.data[0][hoverIndex]
    const y = u.data[1][hoverIndex]
    if (x == null || y == null) return
    syncing.current = true
    u.setCursor({ left: u.valToPos(x, 'x'), top: u.valToPos(y as number, 'y') })
    syncing.current = false
  }, [hoverIndex])

  if (!profile.some((r) => r[1] != null)) {
    return <p className="px-2 py-6 text-sm text-moss">This track has no elevation data.</p>
  }
  return <div ref={ref} className="w-full" aria-label="Elevation profile" />
}
