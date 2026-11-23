import { describe, expect, it } from 'vitest'

import type { Highlight } from './types'
import { mapStops } from './stops'

const stop = (id: string, photo_ids: string[]): Highlight => ({
  id,
  kind: 'sight',
  label: id,
  body: '',
  order: 0,
  photo_ids,
  route_fraction: 0.5,
})

describe('mapStops', () => {
  it('pins each stop at the middle of its placed photos and skips unplaced stops', () => {
    const photos = [
      { id: 'a', location: [10, 20, 0] as [number, number, number] },
      { id: 'b', location: [12, 22, 0] as [number, number, number] },
      { id: 'c', location: null },
    ]
    const pins = mapStops([stop('s1', ['a', 'b', 'c']), stop('s2', ['c'])], photos)
    expect(pins).toEqual([{ id: 's1', label: 's1', lng: 11, lat: 21, fraction: 0.5 }])
  })
})
