import { describe, expect, it } from 'vitest'

import {
  formatDistance,
  formatDuration,
  formatElevation,
  formatPace,
  formatPhotoTime,
  formatSpeed,
} from './format'

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

describe('photo formats', () => {
  it('formats bytes', async () => {
    const { formatBytes } = await import('./format')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(300 * 1024)).toBe('300 kB')
    expect(formatBytes(2.5 * 1024 ** 2)).toBe('2.5 MB')
    expect(formatBytes(1024 ** 3)).toBe('1.00 GB')
  })
  it('formats camera offsets', async () => {
    const { formatOffset } = await import('./format')
    expect(formatOffset(0)).toBe('No offset')
    expect(formatOffset(-180)).toBe('−3 min')
    expect(formatOffset(3900)).toBe('+1h 05m')
  })
})

describe('formatPhotoTime', () => {
  it('shows the time in the trip time zone', () => {
    // 03:05 UTC is 08:35 in India.
    expect(formatPhotoTime('2026-05-10T03:05:00Z', 'Asia/Kolkata')).toMatch(/10 May.*8:35/)
  })

  it('is empty without a time or with an unknown zone', () => {
    expect(formatPhotoTime(null)).toBe('')
    expect(formatPhotoTime('2026-05-10T03:05:00Z', 'Not/AZone')).toBe('')
  })
})

describe('formatSpeed', () => {
  it('keeps one decimal for walking speeds only', () => {
    expect(formatSpeed(4.12)).toBe('4.1 km/h')
    expect(formatSpeed(62.4)).toBe('62 km/h')
    expect(formatSpeed(null)).toBe('–')
  })
})
