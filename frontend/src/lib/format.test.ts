import { describe, expect, it } from 'vitest'

import { formatDistance, formatDuration, formatElevation, formatPace } from './format'

describe('format', () => {
  it('formats distance in m and km', () => {
    expect(formatDistance(850)).toBe('850 m')
    expect(formatDistance(4321)).toBe('4.32 km')
    expect(formatDistance(26_480)).toBe('26.5 km')
    expect(formatDistance(null)).toBe('–')
  })

  it('formats durations', () => {
    expect(formatDuration(45 * 60)).toBe('45 min')
    expect(formatDuration(3 * 3600 + 5 * 60)).toBe('3h 05m')
    expect(formatDuration(20 * 3600 + 12 * 60)).toBe('20h 12m')
    expect(formatDuration(2 * 3600 + 59.8 * 60)).toBe('3h')
  })

  it('formats pace and elevation', () => {
    expect(formatPace(615)).toBe('10:15 /km')
    expect(formatElevation(4270.4)).toBe('4,270 m')
  })
})
