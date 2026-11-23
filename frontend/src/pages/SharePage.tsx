import { useQuery } from '@tanstack/react-query'
import { CalendarDays, Check, EyeOff, MapPinned, Share2 } from 'lucide-react'
import { Suspense, lazy, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router'

import ElevationChart from '../components/ElevationChart'
import Lightbox from '../components/Lightbox'
import PhotoStrip from '../components/PhotoStrip'
import { PlayButton, ReplayOverlay } from '../components/ReplayControls'
import StatsStrip from '../components/StatsStrip'
import StatusMessage from '../components/StatusMessage'
import StoryThread from '../components/StoryThread'
import StyleSwitcher from '../components/StyleSwitcher'
import { btn } from '../components/ui'
import { ApiError, api } from '../lib/api'
import { useSession } from '../lib/auth'
import { formatDateRange, formatDistance, formatElevation } from '../lib/format'
import { type BaseStyleId, DEFAULT_STYLE } from '../lib/mapStyles'
import { profileIndexAtFraction } from '../lib/profile'
import { mapStops } from '../lib/stops'
import type { Highlight, Photo, PublicPhoto, PublicTrip, Trip } from '../lib/types'
import { useDocumentTitle } from '../lib/useDocumentTitle'
import { useMediaQuery } from '../lib/useMediaQuery'
import { useReplay } from '../lib/useReplay'

// MapLibre is large, so it loads only on pages that show a map (SPEC §11).
const TripMap = lazy(() => import('../components/TripMap'))

const CHART_HEIGHT = 110

/** Public photos carry fewer fields than the owner's; fill the rest for shared components. */
function asPhoto(p: PublicPhoto): Photo {
  return {
    ...p,
    filename: 'photo',
    status: 'ready',
    error: '',
    placement: p.location ? 'exif' : 'unplaced',
    is_public: true,
    order: 0,
    stored_bytes: 0,
    created_at: '',
  }
}

/**
 * The public story of a trip at /u/<username>/<slug>[?k=token] (SPEC F10). Read-only: the
 * privacy-trimmed route on the 3D map, headline numbers, photos in route order, the story and
 * every shared photo. Private trips and wrong links get the same "not available" page.
 */
export default function SharePage() {
  const { username = '', slug = '' } = useParams()
  const { search } = useLocation()
  const token = new URLSearchParams(search).get('k')
  const { data: me } = useSession()
  const wide = useMediaQuery('(min-width: 640px)')
  const mapRef = useRef<HTMLElement>(null)

  const query = useQuery({
    queryKey: ['public-trip', username, slug, token],
    queryFn: () =>
      api.get<PublicTrip>(
        `/api/public/u/${encodeURIComponent(username)}/${encodeURIComponent(slug)}${
          token ? `?k=${encodeURIComponent(token)}` : ''
        }`,
      ),
    retry: (n, err) => !(err instanceof ApiError && err.status === 404) && n < 2,
  })
  useDocumentTitle(query.data?.trip.title)

  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const [styleId, setStyleId] = useState<BaseStyleId>(DEFAULT_STYLE)
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [focus, setFocus] = useState<{ lng: number; lat: number; nonce: number } | null>(null)

  const photos = useMemo(() => (query.data?.photos ?? []).map(asPhoto), [query.data])
  const stopPins = useMemo(
    () => mapStops(query.data?.highlights ?? [], photos),
    [query.data, photos],
  )
  const replay = useReplay()
  const [copied, setCopied] = useState(false)

  if (query.isLoading) return <p className="p-8 text-muted">Loading this trip…</p>
  if (!query.data) {
    const missing = query.error instanceof ApiError && query.error.status === 404
    return missing ? (
      <StatusMessage
        title="This trip isn't available"
        body="The link may be wrong, or its owner has stopped sharing it."
        showTripsLink={!!me}
      />
    ) : (
      <StatusMessage
        title="Couldn't load this trip"
        body="Check your connection and try again."
        showTripsLink={!!me}
        action={
          <button onClick={() => query.refetch()} className={btn.primary}>
            Try again
          </button>
        }
      />
    )
  }

  const { trip, track, highlights } = query.data
  const isOwner = me?.username === trip.owner.username
  const chartIndex =
    replay.active && track
      ? profileIndexAtFraction(track.profile, replay.playback.fraction)
      : hoverIndex
  const hovered = chartIndex != null && track ? track.profile[chartIndex] : null

  // Share sheet on phones (and some desktops); otherwise copy the link.
  async function share() {
    const url = window.location.href
    if (navigator.share) {
      try {
        await navigator.share({ title: trip.title, url })
      } catch {
        // dismissed by the user
      }
      return
    }
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      window.prompt('Copy this link', url)
    }
  }
  const inset = {
    left: wide ? 430 : 0,
    bottom: photos.some((p) => p.route_fraction != null) ? 90 : 0,
  }
  const openPhoto = (p: Photo) => setLightboxIndex(photos.findIndex((x) => x.id === p.id))
  const showOnMap = (lng: number, lat: number) => {
    setFocus({ lng, lat, nonce: Date.now() })
    mapRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const showStop = (h: Highlight) => {
    const spots = h.photo_ids
      .map((pid) => photos.find((p) => p.id === pid)?.location)
      .filter((l) => l != null)
    if (spots.length)
      showOnMap(
        spots.reduce((t, l) => t + l[0], 0) / spots.length,
        spots.reduce((t, l) => t + l[1], 0) / spots.length,
      )
  }
  const inStory = new Set(highlights.flatMap((h) => h.photo_ids))
  const otherPhotos = photos.filter((p) => !inStory.has(p.id))

  const header = (
    <div
      className={
        track
          ? `px-4 pt-5 pb-4 transition-opacity duration-500 sm:absolute sm:top-4 sm:left-4 sm:z-10 sm:w-[25rem] sm:rounded-3xl sm:p-5 sm:map-panel ${
              replay.active ? 'sm:pointer-events-none sm:opacity-0' : ''
            }`
          : 'mx-auto w-full max-w-6xl px-4 pt-10 pb-6'
      }
    >
      <p className="text-sm text-muted">
        A trip by <span className="font-semibold text-ink">{trip.owner.display_name}</span>
      </p>
      <h1
        className={`mt-1 font-extrabold tracking-[-0.03em] ${
          track ? 'text-3xl leading-tight sm:text-[2rem]' : 'text-4xl sm:text-6xl'
        }`}
      >
        {trip.title}
      </h1>
      {trip.start_date && (
        <p className="mt-1.5 flex items-center gap-1.5 text-sm text-muted">
          <CalendarDays className="h-4 w-4" aria-hidden />
          {formatDateRange(trip.start_date, trip.end_date)}
        </p>
      )}
      <div className="mt-4">
        <StatsStrip stats={trip.stats} variant="lead" />
      </div>
      <div className="mt-4 flex gap-2">
        {track && <PlayButton replay={replay} className="flex-1 py-3" />}
        <button onClick={share} className={`${btn.secondary} py-3`}>
          {copied ? (
            <Check className="h-4 w-4" aria-hidden />
          ) : (
            <Share2 className="h-4 w-4" aria-hidden />
          )}
          {copied ? 'Link copied' : 'Share'}
        </button>
      </div>
      {trip.description && (
        <p className="mt-4 border-t border-line pt-4 text-sm leading-relaxed whitespace-pre-line text-ink/85">
          {trip.description}
        </p>
      )}
    </div>
  )

  return (
    <div className="pb-20">
      {isOwner && trip.visibility === 'private' && (
        <p className="flex items-center justify-center gap-2 bg-ink px-4 py-2.5 text-center text-sm font-medium text-white">
          <EyeOff className="h-4 w-4 shrink-0" aria-hidden />
          Preview: only you can see this page until you share the trip.
        </p>
      )}

      {track ? (
        <section ref={mapRef} className="relative scroll-mt-16">
          {header}
          <div className="relative h-[62svh] min-h-[420px] bg-wash sm:h-[calc(100svh-4rem)] sm:max-h-[900px] sm:min-h-[580px]">
            <Suspense fallback={<div className="h-full w-full animate-pulse bg-wash" />}>
              <TripMap
                track={track}
                styleId={styleId}
                hoverIndex={hoverIndex}
                onHoverIndex={setHoverIndex}
                inset={inset}
                photos={photos}
                onPhotoClick={(pid) => setLightboxIndex(photos.findIndex((p) => p.id === pid))}
                focus={focus}
                stops={stopPins}
                controllerRef={replay.controllerRef}
                onPlayback={replay.onPlayback}
                onReach={replay.onReach}
              />
            </Suspense>
            <div className="absolute top-3 left-3 sm:right-14 sm:left-auto">
              <StyleSwitcher value={styleId} onChange={setStyleId} />
            </div>
            <ReplayOverlay
              replay={replay}
              distanceM={track.profile[track.profile.length - 1]?.[0]}
              photos={photos}
              highlights={highlights}
              timeZone={trip.timezone}
              onOpenPhoto={(p) => {
                replay.pause()
                openPhoto(p)
              }}
            />
            <div
              className={`absolute right-3 bottom-9 left-3 flex justify-center sm:right-12 sm:left-[27rem] ${
                replay.active ? 'hidden' : ''
              }`}
            >
              <PhotoStrip
                photos={photos}
                onOpen={openPhoto}
                onHover={(f) =>
                  setHoverIndex(f == null ? null : profileIndexAtFraction(track.profile, f))
                }
              />
            </div>
          </div>
          {track.profile.length > 1 && (
            <div className="border-b border-line bg-card">
              <div className="mx-auto max-w-6xl px-4 pt-4 pb-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                  <h2 className="flex items-baseline gap-3 font-bold">
                    Elevation
                    {hovered && (
                      <span className="text-sm font-semibold text-brand tabular-nums">
                        {formatElevation(hovered[1])} at {formatDistance(hovered[0])}
                      </span>
                    )}
                  </h2>
                  <StatsStrip stats={trip.stats} variant="quiet" />
                </div>
                <ElevationChart
                  profile={track.profile}
                  hoverIndex={chartIndex}
                  onHoverIndex={setHoverIndex}
                  height={CHART_HEIGHT}
                />
                {trip.privacy_zone_m > 0 && (
                  <p className="mt-1 text-xs text-muted">
                    The first and last {formatDistance(trip.privacy_zone_m)} of the route are hidden
                    for privacy.
                  </p>
                )}
              </div>
            </div>
          )}
        </section>
      ) : (
        <header>{header}</header>
      )}

      <StoryThread
        readOnly
        // The story only reads display fields; its rail draws the public profile's heights.
        trip={
          {
            ...trip,
            elevation_preview: (track?.profile ?? []).map((r) => r[1] ?? 0),
          } as unknown as Trip
        }
        highlights={highlights}
        photos={photos}
        profile={track?.profile}
        onOpenPhoto={openPhoto}
        onShowOnMap={showStop}
      />

      {otherPhotos.length > 0 && (
        <section className="mx-auto mt-16 w-full max-w-6xl px-4">
          <h2 className="text-2xl font-extrabold tracking-tight">
            {highlights.length ? 'More photos' : 'Photos'}
          </h2>
          <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {otherPhotos.map((p) => (
              <li key={p.id} className="relative">
                <button
                  onClick={() => openPhoto(p)}
                  aria-label={`Open ${p.caption || 'photo'}`}
                  className="group block aspect-[4/3] w-full overflow-hidden rounded-2xl bg-wash"
                >
                  <img
                    src={p.thumb_url ?? undefined}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                  />
                </button>
                {p.location && track && (
                  <button
                    onClick={() => showOnMap(p.location![0], p.location![1])}
                    aria-label="Show on map"
                    className="absolute right-2 bottom-2 flex h-8 w-8 items-center justify-center rounded-full bg-card/90 text-brand shadow"
                  >
                    <MapPinned className="h-4 w-4" aria-hidden />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {!me && (
        <section className="mx-auto mt-20 w-full max-w-6xl px-4">
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-3xl bg-ink px-6 py-7 text-white sm:px-8">
            <div>
              <p className="text-xl font-extrabold">Been somewhere worth remembering?</p>
              <p className="mt-1 text-white/75">
                Turn your own GPS track and photos into a story like this one.
              </p>
            </div>
            <Link to="/signup" className={`${btn.primary} px-6 py-3`}>
              Start your own trip
            </Link>
          </div>
        </section>
      )}

      <Lightbox
        photos={photos}
        index={lightboxIndex != null && lightboxIndex >= 0 ? lightboxIndex : null}
        onIndex={setLightboxIndex}
        timeZone={trip.timezone}
        onShowOnMap={
          track
            ? (p) => {
                if (!p.location) return
                setLightboxIndex(null)
                showOnMap(p.location[0], p.location[1])
              }
            : undefined
        }
      />
    </div>
  )
}
