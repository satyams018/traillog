import { describe, expect, it } from 'vitest'

import { HILLY_GAIN_M, isHilly } from './stats'

describe('isHilly', () => {
  it('shows climb only for trips that really climb', () => {
    expect(isHilly({ gain_m: 1580 })).toBe(true)
    expect(isHilly({ gain_m: HILLY_GAIN_M })).toBe(true)
    expect(isHilly({ gain_m: 40 })).toBe(false) // a city walk
    expect(isHilly({ gain_m: null })).toBe(false) // no elevation in the file
    expect(isHilly(undefined)).toBe(false)
  })
})
