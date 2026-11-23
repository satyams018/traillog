import { describe, expect, it } from 'vitest'

import { chartData, nearestProfileIndex, profileIndexAtFraction } from './profile'
import type { ProfileRow } from './types'

const profile: ProfileRow[] = Array.from({ length: 100 }, (_, i) => [
  i * 100,
  3000 + i,
  null,
  77.18,
  32.24 + i * 0.0009,
])

describe('nearestProfileIndex', () => {
  it('finds the closest sample', () => {
    expect(nearestProfileIndex(profile, 77.18, 32.24 + 42 * 0.0009 + 0.0001)).toBe(42)
  })

  it('clamps to the ends for points beyond the track', () => {
    expect(nearestProfileIndex(profile, 77.18, 31)).toBe(0)
    expect(nearestProfileIndex(profile, 77.18, 40)).toBe(99)
  })
})

describe('chartData', () => {
  it('converts distance to km', () => {
    const [x, y] = chartData(profile)
    expect(x[10]).toBe(1)
    expect(y[10]).toBe(3010)
  })
})

describe('profileIndexAtFraction', () => {
  it('finds the sample at a share of the distance', () => {
    // 99 samples span 9,900 m, so 25% is 2,475 m: sample 25 (2,500 m) is closest.
    expect(profileIndexAtFraction(profile, 0.25)).toBe(25)
    expect(profileIndexAtFraction(profile, 0.5)).toBe(50)
  })

  it('clamps to the ends', () => {
    expect(profileIndexAtFraction(profile, -1)).toBe(0)
    expect(profileIndexAtFraction(profile, 2)).toBe(99)
    expect(profileIndexAtFraction([], 0.5)).toBe(0)
  })
})
