import { ArrowDown, ArrowUp, Flag, MapPinned, Pencil, Plus, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { formatDateRange, formatDistance, formatDuration, formatElevation } from '../lib/format'
import { profileIndexAtFraction } from '../lib/profile'
import { isHilly } from '../lib/stats'
import type { Highlight, HighlightInput, Photo, ProfileRow, Trip } from '../lib/types'
import ActionsMenu from './ActionsMenu'
import HighlightEditor from './HighlightEditor'
import Polaroid from './Polaroid'
import StoryRail from './StoryRail'
import { KIND } from './storyKinds'
import { btn } from './ui'

interface Props {
  trip: Trip
  highlights: Highlight[]
  /** Ready photos of the trip. */
  photos: Photo[]
  profile?: ProfileRow[]
  /** Share pages: no editing controls, and nothing at all when there are no stops. */
  readOnly?: boolean
  /** 'new', a highlight id, or null. */
  editing?: string | null
  saving?: boolean
  error?: string
  onEdit?: (id: string | null) => void
  onSave?: (input: HighlightInput) => void
  onDelete?: (h: Highlight) => void
  onMove?: (h: Highlight, by: -1 | 1) => void
  onOpenPhoto: (p: Photo) => void
  onShowOnMap: (h: Highlight) => void
}

// Where on screen a stop counts as "reached" while scrolling (share of the viewport height).
const READ_LINE = 0.55

/** A small, stable tilt per photo (−3.5° to 3.5°) so prints look laid down by hand. */
function tiltFor(id: string, i: number): number {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0
  const t = ((Math.abs(h) % 8) - 3.5) * 0.9
  return i % 2 ? -Math.abs(t) : Math.abs(t) // alternate sides within a stop
}

/**
 * The trip's story: stops threaded from start to finish down the page. A route line fills in
 * as you scroll, each stop's marker lights up when reached, and on wide screens a sticky rail
 * shows where along the route you are.
 */
export default function StoryThread({
  trip,
  highlights,
  photos,
  profile,
  readOnly = false,
  editing = null,
  saving = false,
  error = '',
  onEdit = () => {},
  onSave = () => {},
  onDelete = () => {},
  onMove = () => {},
  onOpenPhoto,
  onShowOnMap,
}: Props) {
  const listRef = useRef<HTMLOListElement>(null)
  const fillRef = useRef<HTMLSpanElement>(null)
  const [reached, setReached] = useState(-1)

  const byId = new Map(photos.map((p) => [p.id, p]))
  const inRouteOrder = [...photos].sort((a, b) => (a.route_fraction ?? 2) - (b.route_fraction ?? 2))
  const stopLabels = Object.fromEntries(highlights.map((h) => [h.id, h.label]))

  // Scroll-linked progress. Written straight to the DOM in a frame callback so scrolling
  // never re-renders React; only the "reached" stop index goes through state.
  useEffect(() => {
    let frame = 0
    const update = () => {
      frame = 0
      const list = listRef.current
      if (!list) return
      const line = window.innerHeight * READ_LINE
      const rect = list.getBoundingClientRect()
      const filled = Math.max(0, Math.min(rect.height, line - rect.top))
      if (fillRef.current) fillRef.current.style.height = `${filled}px`
      const stops = list.querySelectorAll<HTMLElement>('[data-stop]')
      let last = -1
      stops.forEach((el, i) => {
        if (el.getBoundingClientRect().top < line) last = i
      })
      setReached(last)
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [highlights.length, editing])

  const jumpTo = (id: string) =>
    document.getElementById(`stop-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })

  const where = (h: Highlight) => {
    if (h.route_fraction == null || !profile?.length) return null
    const row = profile[profileIndexAtFraction(profile, h.route_fraction)]
    return `at ${formatDistance(row[0])}, ${formatElevation(row[1])}`
  }

  const editor = (h: Highlight | null) => (
    <HighlightEditor
      key={h?.id ?? 'new'}
      highlight={h}
      photos={inRouteOrder}
      stopLabels={stopLabels}
      saving={saving}
      error={error}
      onSave={onSave}
      onCancel={() => onEdit(null)}
    />
  )

  const empty = highlights.length === 0
  if (readOnly && empty) return null
  return (
    <section aria-labelledby="story-title" className="mx-auto mt-16 w-full max-w-6xl px-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 id="story-title" className="text-3xl font-extrabold tracking-tight sm:text-4xl">
            The story
          </h2>
          <p className="mt-1 max-w-xl text-muted">
            {empty
              ? 'Optional: group your photos into stops along the route and add a few words to each.'
              : 'From start to finish, stop by stop.'}
          </p>
        </div>
        {!readOnly && !empty && editing !== 'new' && (
          <button onClick={() => onEdit('new')} className={btn.secondary}>
            <Plus className="h-4 w-4" aria-hidden />
            Add a stop
          </button>
        )}
      </div>

      {empty && editing !== 'new' ? (
        <div className="mt-8 rounded-3xl border border-dashed border-brand/30 bg-card/60 px-6 py-12 text-center">
          <p className="mx-auto max-w-md text-muted">
            A stop is a place worth remembering: a café, a viewpoint, the hotel with the view. Stops
            follow the route from start to finish, and you can move them around.
          </p>
          <button onClick={() => onEdit('new')} className={`${btn.primary} mt-6`}>
            <Plus className="h-4 w-4" aria-hidden />
            Add the first stop
          </button>
        </div>
      ) : (
        <div className="mt-10 lg:grid lg:grid-cols-[minmax(0,1fr)_15rem] lg:gap-14">
          <ol ref={listRef} className="relative">
            {/* The route: a dashed track, and a raspberry line that fills as you scroll. */}
            <span
              className="absolute top-5 bottom-5 left-[19px] border-l-2 border-dashed border-line"
              aria-hidden
            />
            <span
              ref={fillRef}
              className="absolute top-5 left-[19px] w-0.5 rounded-full bg-route"
              style={{ maxHeight: 'calc(100% - 2.5rem)' }}
              aria-hidden
            />

            <li className="relative pb-12 pl-14">
              <span className="absolute top-1 left-[9px] h-[22px] w-[22px] rounded-full border-[3px] border-white bg-brand shadow-[var(--shadow-soft)]" />
              <p className="font-bold">Start</p>
              {trip.start_date && (
                <p className="text-sm text-muted">
                  {formatDateRange(trip.start_date, trip.end_date)}
                </p>
              )}
            </li>

            {highlights.map((h, i) => {
              const { icon: Icon, label: kindName } = KIND[h.kind]
              const shots = h.photo_ids.map((pid) => byId.get(pid)).filter((p) => p != null)
              const lit = i <= reached
              const place = where(h)
              return (
                <li
                  key={h.id}
                  id={`stop-${h.id}`}
                  data-stop
                  className="relative scroll-mt-24 pb-16 pl-14"
                  style={{ viewTransitionName: `stop-${h.id}` }}
                >
                  <span
                    className={`absolute top-0 left-0 flex h-10 w-10 items-center justify-center rounded-full border-[3px] border-white shadow-[var(--shadow-soft)] transition-colors duration-500 ${
                      lit ? 'bg-route text-white' : 'bg-wash text-brand'
                    }`}
                    aria-hidden
                  >
                    <Icon className="h-[18px] w-[18px]" />
                  </span>

                  {editing === h.id ? (
                    editor(h)
                  ) : (
                    <>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm text-muted">
                            {kindName}
                            {place && <span className="tabular-nums">, {place}</span>}
                          </p>
                          <h3 className="mt-0.5 text-2xl font-extrabold tracking-tight sm:text-[1.75rem]">
                            {h.label}
                          </h3>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          {h.route_fraction != null && (
                            <span className={readOnly ? '' : 'hidden sm:block'}>
                              <button onClick={() => onShowOnMap(h)} className={btn.ghost}>
                                <MapPinned className="h-4 w-4" aria-hidden />
                                Show on map
                              </button>
                            </span>
                          )}
                          {!readOnly && (
                            <ActionsMenu
                              label={`Actions for ${h.label}`}
                              actions={[
                                { label: 'Edit stop', icon: Pencil, onSelect: () => onEdit(h.id) },
                                ...(i > 0
                                  ? [
                                      {
                                        label: 'Move up',
                                        icon: ArrowUp,
                                        onSelect: () => onMove(h, -1),
                                      },
                                    ]
                                  : []),
                                ...(i < highlights.length - 1
                                  ? [
                                      {
                                        label: 'Move down',
                                        icon: ArrowDown,
                                        onSelect: () => onMove(h, 1),
                                      },
                                    ]
                                  : []),
                                ...(h.route_fraction != null
                                  ? [
                                      {
                                        label: 'Show on map',
                                        icon: MapPinned,
                                        onSelect: () => onShowOnMap(h),
                                      },
                                    ]
                                  : []),
                                {
                                  label: 'Delete stop',
                                  icon: Trash2,
                                  danger: true,
                                  onSelect: () => onDelete(h),
                                },
                              ]}
                            />
                          )}
                        </div>
                      </div>
                      {h.body && (
                        <div className="mt-3 max-w-prose space-y-3 text-[1.05rem] leading-relaxed text-ink/85">
                          {h.body
                            .split(/\n\s*\n/)
                            .filter((para) => para.trim())
                            .map((para, k) => (
                              <p key={k} className="whitespace-pre-line">
                                {para.trim()}
                              </p>
                            ))}
                        </div>
                      )}
                      {shots.length > 0 && (
                        // Phones: a swipeable row. Wider: prints overlap a little, like a pile.
                        <div className="-mx-4 mt-6 flex snap-x snap-mandatory gap-5 overflow-x-auto px-4 pt-2 pb-6 sm:mx-0 sm:flex-wrap sm:gap-y-6 sm:overflow-visible sm:px-1 sm:[&>*+*]:-ml-4">
                          {shots.map((p, k) => (
                            <Polaroid
                              key={p.id}
                              photo={p}
                              tilt={tiltFor(p.id, k)}
                              size={shots.length === 1 ? 'large' : 'small'}
                              timeZone={trip.timezone}
                              onOpen={() => onOpenPhoto(p)}
                            />
                          ))}
                        </div>
                      )}
                      {!readOnly && !h.body && shots.length === 0 && (
                        <button onClick={() => onEdit(h.id)} className={`${btn.ghost} mt-2 -ml-3`}>
                          <Pencil className="h-4 w-4" aria-hidden />
                          Add words or photos
                        </button>
                      )}
                    </>
                  )}
                </li>
              )
            })}

            {editing === 'new' && (
              <li className="relative pb-16 pl-14">
                <span
                  className="absolute top-0 left-0 flex h-10 w-10 items-center justify-center rounded-full border-[3px] border-white bg-route text-white shadow-[var(--shadow-soft)]"
                  aria-hidden
                >
                  <Plus className="h-[18px] w-[18px]" />
                </span>
                {editor(null)}
              </li>
            )}

            <li className="relative pl-14">
              <span className="absolute top-0 left-[7px] flex h-[26px] w-[26px] items-center justify-center rounded-full border-[3px] border-white bg-route text-white shadow-[var(--shadow-soft)]">
                <Flag className="h-3 w-3" aria-hidden />
              </span>
              <p className="font-bold">Finish</p>
              <p className="text-sm text-muted">
                {formatDistance(trip.stats.distance_m)}
                {trip.stats.total_s != null && ` in ${formatDuration(trip.stats.total_s)}`}
                {isHilly(trip.stats) && `, ${formatElevation(trip.stats.gain_m)} of climbing`}
              </p>
            </li>
          </ol>

          <aside className="hidden lg:block" aria-label="Story overview">
            <div className="sticky top-24">
              <StoryRail
                values={trip.elevation_preview}
                flat={!isHilly(trip.stats)}
                stops={highlights.map((h) => ({
                  id: h.id,
                  label: h.label,
                  fraction: h.route_fraction,
                }))}
                reached={reached}
                onJump={jumpTo}
              />
            </div>
          </aside>
        </div>
      )}
    </section>
  )
}
