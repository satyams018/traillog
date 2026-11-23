import type { MapStop } from '../components/TripMap'
import type { Highlight, Photo } from './types'

/** Story stops as map pins: each sits at the middle of its photos that have a position. */
export function mapStops(highlights: Highlight[], photos: Pick<Photo, 'id' | 'location'>[]) {
  const byId = new Map(photos.map((p) => [p.id, p]))
  const out: MapStop[] = []
  for (const h of highlights) {
    const spots = h.photo_ids.map((id) => byId.get(id)?.location).filter((l) => l != null)
    if (!spots.length) continue
    out.push({
      id: h.id,
      label: h.label,
      lng: spots.reduce((t, l) => t + l[0], 0) / spots.length,
      lat: spots.reduce((t, l) => t + l[1], 0) / spots.length,
      fraction: h.route_fraction,
    })
  }
  return out
}
