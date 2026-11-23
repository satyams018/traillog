import { ChevronLeft, ChevronRight, MapPin, X } from 'lucide-react'
import { useEffect, useRef } from 'react'

import type { Photo } from '../lib/types'

interface Props {
  photos: Photo[]
  index: number | null
  onIndex: (i: number | null) => void
  onShowOnMap?: (photo: Photo) => void
  timeZone?: string
}

/** Full-screen viewer: arrow keys, swipe, Esc, and "Show on map" (SPEC F6). */
export default function Lightbox({ photos, index, onIndex, onShowOnMap, timeZone }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const touchX = useRef<number | null>(null)
  const open = index != null && photos[index] != null
  const photo = open ? photos[index] : null
  const go = (d: number) => index != null && onIndex((index + d + photos.length) % photos.length)

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') go(1)
      if (e.key === 'ArrowLeft') go(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Preload neighbours so swiping feels instant.
  useEffect(() => {
    if (index == null || photos.length < 2) return
    for (const d of [1, -1]) {
      const p = photos[(index + d + photos.length) % photos.length]
      if (p?.web_url) new Image().src = p.web_url
    }
  }, [index, photos])

  const when = photo?.taken_at
    ? new Date(photo.taken_at).toLocaleString('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: timeZone || undefined,
      })
    : null

  return (
    <dialog
      ref={ref}
      onClose={() => onIndex(null)}
      aria-label="Photo viewer"
      className="m-0 h-dvh max-h-none w-screen max-w-none bg-ink/95 p-0 text-white backdrop:bg-ink/80"
    >
      {photo && (
        <div
          className="flex h-full flex-col"
          onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
          onTouchEnd={(e) => {
            if (touchX.current == null) return
            const dx = e.changedTouches[0].clientX - touchX.current
            touchX.current = null
            if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1)
          }}
        >
          <div className="flex items-center gap-3 px-4 py-3 text-sm">
            <span className="font-semibold tabular-nums">
              {index! + 1} / {photos.length}
            </span>
            <span className="truncate text-white/70">{when}</span>
            <div className="ml-auto flex items-center gap-1">
              {photo.location && onShowOnMap && (
                <button
                  onClick={() => onShowOnMap(photo)}
                  className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 font-semibold hover:bg-white/10"
                >
                  <MapPin className="h-4 w-4" aria-hidden />
                  Show on map
                </button>
              )}
              <button
                onClick={() => onIndex(null)}
                aria-label="Close"
                className="rounded-full p-2 hover:bg-white/10"
                autoFocus
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
          <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 sm:px-16">
            <img
              key={photo.id}
              src={photo.web_url ?? undefined}
              alt={photo.caption || photo.filename}
              width={photo.width ?? undefined}
              height={photo.height ?? undefined}
              className="max-h-full max-w-full rounded-lg object-contain"
            />
            {photos.length > 1 && (
              <>
                <button
                  onClick={() => go(-1)}
                  aria-label="Previous photo"
                  className="absolute left-2 hidden rounded-full bg-white/10 p-3 hover:bg-white/20 sm:block"
                >
                  <ChevronLeft className="h-6 w-6" />
                </button>
                <button
                  onClick={() => go(1)}
                  aria-label="Next photo"
                  className="absolute right-2 hidden rounded-full bg-white/10 p-3 hover:bg-white/20 sm:block"
                >
                  <ChevronRight className="h-6 w-6" />
                </button>
              </>
            )}
          </div>
          <p className="min-h-12 px-4 py-3 text-center text-sm text-white/85">{photo.caption}</p>
        </div>
      )}
    </dialog>
  )
}
