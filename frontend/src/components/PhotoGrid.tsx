import { Eye, EyeOff, MapPin, MapPinOff, Navigation, Trash2, TriangleAlert } from 'lucide-react'

import type { Photo, Placement } from '../lib/types'
import ActionsMenu from './ActionsMenu'
import { btn } from './ui'

// On devices that can hover, routine details appear on hover/focus so the grid stays calm;
// touch screens always show them.
const REVEAL =
  'transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/tile:opacity-100 [@media(hover:hover)]:group-focus-within/tile:opacity-100'

const PLACEMENT: Record<Placement, string> = {
  exif: 'Photo GPS',
  time: 'Matched by time',
  manual: 'Placed by you',
  unplaced: 'Not on map',
}

interface Props {
  photos: Photo[]
  canPlace: boolean
  placingId: string | null
  bulkBusy: boolean
  onOpen: (photo: Photo) => void
  onPatch: (photo: Photo, body: Partial<Pick<Photo, 'is_public'>> & { location?: null }) => void
  onBulk: (isPublic: boolean) => void
  onStartPlacing: (photo: Photo | null) => void
  onDelete: (photo: Photo) => void
}

export default function PhotoGrid({
  photos,
  canPlace,
  placingId,
  bulkBusy,
  onOpen,
  onPatch,
  onBulk,
  onStartPlacing,
  onDelete,
}: Props) {
  const ready = photos.filter((p) => p.status === 'ready')
  const hidden = ready.filter((p) => !p.is_public).length
  const unplaced = ready.filter((p) => p.placement === 'unplaced').length

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 className="text-xl font-bold">
          Photos <span className="font-semibold text-muted tabular-nums">{ready.length}</span>
        </h2>
        <p className="text-sm text-muted">
          {hidden
            ? `${hidden} hidden from the share page`
            : 'All photos will show on the share page'}
          {unplaced > 0 && ` · ${unplaced} not on the map yet`}
        </p>
        {ready.length > 0 && (
          <div className="ml-auto flex gap-2">
            <button
              className={btn.secondary}
              disabled={bulkBusy || hidden === 0}
              onClick={() => onBulk(true)}
            >
              <Eye className="h-4 w-4" aria-hidden />
              Show all
            </button>
            <button
              className={btn.secondary}
              disabled={bulkBusy || hidden === ready.length}
              onClick={() => onBulk(false)}
            >
              <EyeOff className="h-4 w-4" aria-hidden />
              Hide all
            </button>
          </div>
        )}
      </div>

      <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {photos.map((p) => (
          <li key={p.id} className="group/tile relative">
            {p.status === 'ready' ? (
              <button
                onClick={() => onOpen(p)}
                className={`group block aspect-[4/3] w-full overflow-hidden rounded-2xl bg-wash ring-offset-2 focus-visible:ring-2 focus-visible:ring-brand ${
                  placingId === p.id ? 'ring-4 ring-route' : ''
                }`}
                aria-label={`Open ${p.caption || p.filename}`}
              >
                <img
                  src={p.thumb_url ?? undefined}
                  alt=""
                  loading="lazy"
                  className={`h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03] ${
                    p.is_public ? '' : 'opacity-45 grayscale'
                  }`}
                />
              </button>
            ) : (
              <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 rounded-2xl border border-line bg-card p-3 text-center text-xs">
                {p.status === 'pending' ? (
                  <>
                    <span className="h-6 w-6 animate-spin rounded-full border-2 border-brand border-t-transparent" />
                    <span className="text-muted">Processing…</span>
                  </>
                ) : (
                  <>
                    <TriangleAlert className="h-5 w-5 text-danger" aria-hidden />
                    <span className="font-medium text-danger">{p.error || 'Upload failed.'}</span>
                  </>
                )}
                <span className="w-full truncate text-muted">{p.filename}</span>
              </div>
            )}

            {p.status === 'ready' && (
              <>
                <span
                  className={`pointer-events-none absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
                    p.placement === 'unplaced'
                      ? 'bg-white text-route-dark'
                      : `bg-card/90 text-ink ${REVEAL}`
                  }`}
                >
                  {p.placement === 'unplaced' ? (
                    <MapPinOff className="h-3 w-3" aria-hidden />
                  ) : (
                    <MapPin className="h-3 w-3" aria-hidden />
                  )}
                  {PLACEMENT[p.placement]}
                </span>
                {!p.is_public && (
                  <span className="pointer-events-none absolute top-2 left-2 inline-flex items-center gap-1 rounded-full bg-ink/75 px-2 py-0.5 text-xs font-semibold text-white">
                    <EyeOff className="h-3 w-3" aria-hidden />
                    Hidden
                  </span>
                )}
              </>
            )}
            <div
              className={`absolute top-1.5 right-1.5 [&_button[aria-haspopup]]:h-8 [&_button[aria-haspopup]]:w-8 [&_button[aria-haspopup]]:bg-card/90 ${
                p.status === 'ready' ? REVEAL : ''
              } has-[[aria-expanded=true]]:opacity-100`}
            >
              <ActionsMenu
                label={`Actions for ${p.filename}`}
                actions={[
                  ...(p.status === 'ready'
                    ? [
                        {
                          label: p.is_public ? 'Hide from share page' : 'Show on share page',
                          icon: p.is_public ? EyeOff : Eye,
                          onSelect: () => onPatch(p, { is_public: !p.is_public }),
                        },
                        ...(canPlace
                          ? [
                              {
                                label: p.location ? 'Move on map' : 'Place on map',
                                icon: Navigation,
                                onSelect: () => onStartPlacing(p),
                              },
                            ]
                          : []),
                        ...(p.placement === 'manual'
                          ? [
                              {
                                label: 'Place automatically',
                                icon: MapPin,
                                onSelect: () => onPatch(p, { location: null }),
                              },
                            ]
                          : []),
                      ]
                    : []),
                  {
                    label: 'Delete photo',
                    icon: Trash2,
                    danger: true,
                    onSelect: () => onDelete(p),
                  },
                ]}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
