import { describe, expect, it } from 'vitest'

import { cumulative, followZoom, lerpAngle, passed, pointAlong } from './flythrough'

// Ten points going north, ~100 m apart.
const coords: [number, number][] = Array.from({ length: 10 }, (_, i) => [77.18, 32.24 + i * 0.0009])

describe('flythrough geometry', () => {
  it('measures the route and finds points along it', () => {
    const cum = cumulative(coords)
    expect(cum[cum.length - 1]).toBeGreaterThan(890) // 9 segments of ~100 m
    expect(cum[cum.length - 1]).toBeLessThan(910)
    const [lng, lat] = pointAlong(coords, cum, cum[3] + (cum[4] - cum[3]) / 2)
    expect(lng).toBeCloseTo(77.18)
    expect(lat).toBeCloseTo(32.24 + 3.5 * 0.0009, 6)
    expect(pointAlong(coords, cum, -5)).toEqual(coords[0])
    expect(pointAlong(coords, cum, 1e9)).toEqual(coords[9])
  })

  it('zooms closer on short routes and stays in range', () => {
    expect(followZoom(2_000)).toBeGreaterThan(followZoom(30_000))
    expect(followZoom(10)).toBeLessThanOrEqual(15.5)
    expect(followZoom(1e7)).toBeGreaterThanOrEqual(11.5)
  })

  it('turns the short way round', () => {
    expect(lerpAngle(350, 10, 0.5)).toBeCloseTo(0)
    expect(lerpAngle(10, 350, 0.5)).toBeCloseTo(0)
    expect(lerpAngle(90, 180, 1)).toBeCloseTo(180)
  })

  it('reports what the camera just passed', () => {
    const items = [{ fraction: 0.2 }, { fraction: 0.5 }, { fraction: 0.8 }]
    expect(passed(items, 0.1, 0.5)).toEqual([{ fraction: 0.2 }, { fraction: 0.5 }])
    expect(passed(items, 0.5, 0.6)).toEqual([])
  })
})
