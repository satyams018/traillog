import { describe, expect, it } from 'vitest'

import { BASE_STYLES, DEFAULT_STYLE, RELIEF_RAMP, hasRelief, styleFor } from './mapStyles'

describe('map styles', () => {
  it('has a relief ramp MapLibre accepts: ascending heights, each with a colour', () => {
    const heights = RELIEF_RAMP.filter((_, i) => i % 2 === 0) as number[]
    const colours = RELIEF_RAMP.filter((_, i) => i % 2 === 1) as string[]
    expect(heights).toEqual([...heights].sort((a, b) => a - b))
    expect(new Set(heights).size).toBe(heights.length)
    expect(colours.every((c) => /^#[0-9a-f]{6}$/i.test(c))).toBe(true)
  })

  it('offers four styles without any key, defaulting to the tinted terrain', () => {
    expect(BASE_STYLES.map((s) => s.id)).toEqual(['terrain', 'satellite', 'topo', 'dark'])
    expect(DEFAULT_STYLE).toBe('terrain')
    expect(hasRelief('terrain') && !hasRelief('satellite')).toBe(true)
    // Without a MapTiler key the satellite style is the inline Sentinel-2 one, with credit.
    const satellite = styleFor('satellite')
    expect(typeof satellite).toBe('object')
    expect(JSON.stringify(satellite)).toContain('Sentinel-2 cloudless')
  })
})
