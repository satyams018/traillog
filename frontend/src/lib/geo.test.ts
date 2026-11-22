import { describe, expect, it } from 'vitest'

import { bearingDeg, cameraBearingForRoute, farthestFromStart } from './geo'

describe('bearingDeg', () => {
  it('gives compass bearings', () => {
    expect(bearingDeg([77, 32], [77, 33])).toBeCloseTo(0)
    expect(bearingDeg([77, 32], [78, 32])).toBeCloseTo(89.7, 0)
    expect(bearingDeg([77, 32], [77, 31])).toBeCloseTo(180)
  })
})

describe('cameraBearingForRoute', () => {
  it('lays an east-bound route left-to-right with no rotation', () => {
    expect(
      cameraBearingForRoute([
        [77, 32],
        [78, 32],
      ]),
    ).toBeCloseTo(0, 0)
  })

  it('rotates a north-bound route to run across the screen, never upside down', () => {
    const b = cameraBearingForRoute([
      [77, 32],
      [77, 33],
    ])
    expect(Math.abs(b)).toBeCloseTo(90)
    for (const end of [
      [76, 31],
      [78, 31],
      [76, 33],
      [78, 33],
    ] as [number, number][]) {
      const v = cameraBearingForRoute([[77, 32], end])
      expect(v).toBeGreaterThan(-90)
      expect(v).toBeLessThanOrEqual(90)
    }
  })

  it('uses the farthest point for loop routes', () => {
    const loop: [number, number][] = [
      [77, 32],
      [77.5, 32.1],
      [78, 32],
      [77.5, 31.9],
      [77, 32],
    ]
    expect(farthestFromStart(loop)).toBe(2)
  })
})
