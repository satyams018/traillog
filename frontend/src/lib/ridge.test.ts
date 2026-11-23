import { describe, expect, it } from 'vitest'

import { backRidge, resample, ridgeShape } from './ridge'

describe('resample', () => {
  it('interpolates to the requested length and keeps the ends', () => {
    expect(resample([0, 10], 5)).toEqual([0, 2.5, 5, 7.5, 10])
    expect(resample([3], 3)).toEqual([3, 3, 3])
    expect(resample([], 4)).toEqual([])
  })
})

describe('ridgeShape', () => {
  it('fits the highest point at the top and the lowest at the base', () => {
    const r = ridgeShape([100, 500, 300], 200, 100, { top: 10, base: 20, samples: 3 })!
    expect(r.start).toEqual([0, 80]) // 100 m is the lowest -> height - base
    expect(r.end).toEqual([200, 45]) // 300 m is halfway between y = 10 and y = 80
    expect(r.line).toContain(' 100.0 10.0 C') // the curve passes the 500 m summit at y = top
    expect(r.area.endsWith('L200.0 100.0 L0 100.0 Z')).toBe(true)
  })
  it('insets the line from the edges but fills the area edge to edge', () => {
    const r = ridgeShape([100, 500, 300], 200, 100, { inset: 20, samples: 3 })!
    expect(r.start[0]).toBe(20)
    expect(r.end[0]).toBe(180)
    expect(r.area.startsWith(`M0 ${r.start[1].toFixed(1)} L20.0`)).toBe(true)
  })
  it('handles flat and unusable input', () => {
    expect(ridgeShape([5, 5], 100, 50)!.start[1]).toBe(50)
    expect(ridgeShape([1], 100, 50)).toBeNull()
    expect(ridgeShape([1, 2], 0, 50)).toBeNull()
  })
})

it('backRidge stays the same length and is flatter', () => {
  const vs = [0, 100, 0, 100, 0]
  const back = backRidge(vs, 0.3)
  expect(back).toHaveLength(5)
  expect(Math.max(...back) - Math.min(...back)).toBeLessThan(100)
})
