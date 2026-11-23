import type { Photo } from '../lib/types'

interface Props {
  photos: Photo[]
  onOpen: (photo: Photo) => void
  /** Called with the photo's position along the route (0..1), or null on leave. */
  onHover: (fraction: number | null) => void
}

/**
 * Photos on the route, in the order you walked past them. Hovering one moves the map and
 * chart cursor to where it was taken; clicking opens it.
 */
export default function PhotoStrip({ photos, onOpen, onHover }: Props) {
  const placed = photos
    .filter((p) => p.route_fraction != null)
    .sort((a, b) => a.route_fraction! - b.route_fraction!)
  if (!placed.length) return null
  return (
    <ul
      aria-label="Photos along the route"
      className="map-panel flex max-w-full gap-1.5 overflow-x-auto rounded-2xl p-1.5"
      onMouseLeave={() => onHover(null)}
    >
      {placed.map((p) => (
        <li key={p.id} className="shrink-0">
          <button
            onClick={() => onOpen(p)}
            onMouseEnter={() => onHover(p.route_fraction)}
            onFocus={() => onHover(p.route_fraction)}
            onBlur={() => onHover(null)}
            aria-label={`Open ${p.caption || p.filename}`}
            className="block h-14 w-[4.5rem] overflow-hidden rounded-xl bg-wash ring-route transition-shadow hover:ring-[3px] focus-visible:ring-[3px] sm:h-16 sm:w-20"
          >
            <img src={p.thumb_url ?? undefined} alt="" className="h-full w-full object-cover" />
          </button>
        </li>
      ))}
    </ul>
  )
}
