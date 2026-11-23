import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarDays, FileUp, Share2, Trash2 } from 'lucide-react'
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import ActionsMenu from '../components/ActionsMenu'
import ConfirmDialog from '../components/ConfirmDialog'
import CameraOffset from '../components/CameraOffset'
import ElevationChart from '../components/ElevationChart'
import GpxUpload from '../components/GpxUpload'
import Lightbox from '../components/Lightbox'
import PhotoGrid from '../components/PhotoGrid'
import PhotoStrip from '../components/PhotoStrip'
import PhotoUpload from '../components/PhotoUpload'
import { PlayButton, ReplayOverlay } from '../components/ReplayControls'
import ShareDialog from '../components/ShareDialog'
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
import type { Highlight, HighlightInput, Photo, TrackData, Trip } from '../lib/types'
import { useDocumentTitle } from '../lib/useDocumentTitle'
import { useMediaQuery } from '../lib/useMediaQuery'
import { useReplay } from '../lib/useReplay'
import { VISIBILITY } from '../lib/visibility'
import { withViewTransition } from '../lib/viewTransition'

// MapLibre is large, so it loads only on pages that show a map (SPEC §11).
const TripMap = lazy(() => import('../components/TripMap'))

const POLL_MS = 2000
const POLL_LIMIT_MS = 2 * 60 * 1000
const CHART_HEIGHT = 120

export default function TripPage() {
  const { id = '' } = useParams()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const pollStarted = useRef<number | null>(null)
  const photoPollStarted = useRef<number | null>(null)
  const mapSectionRef = useRef<HTMLElement>(null)

  // On wider screens the title panel sits over the map, so the route is framed beside it.
  const wide = useMediaQuery('(min-width: 640px)')
  const tripQuery = useQuery({
    queryKey: ['trip', id],
    queryFn: () => api.get<Trip>(`/api/trips/${id}`),
    // Poll while the background job runs (ADR-19), giving up after 2 minutes.
    refetchInterval: (q) => {
      if (q.state.data?.status !== 'processing') {
        pollStarted.current = null
        return false
      }
      pollStarted.current ??= Date.now()
      return Date.now() - pollStarted.current < POLL_LIMIT_MS ? POLL_MS : false
    },
  })
  const trip = tripQuery.data
  useDocumentTitle(trip?.title)

  const trackQuery = useQuery({
    // Keyed on the track's own timestamp so editing title/visibility doesn't refetch it.
    queryKey: ['track', id, trip?.track_updated_at],
    queryFn: () => api.get<TrackData>(`/api/trips/${id}/track`),
    enabled: trip?.status === 'ready',
  })

  const photosQuery = useQuery({
    queryKey: ['photos', id],
    queryFn: () => api.get<Photo[]>(`/api/trips/${id}/photos`),
    enabled: !!trip,
    // Poll while uploads are being processed, giving up after 3 minutes.
    refetchInterval: (q) => {
      if (!q.state.data?.some((p) => p.status === 'pending')) {
        photoPollStarted.current = null
        return false
      }
      photoPollStarted.current ??= Date.now()
      return Date.now() - photoPollStarted.current < 3 * 60 * 1000 ? POLL_MS : false
    },
  })
  const photos = useMemo(() => photosQuery.data ?? [], [photosQuery.data])
  const readyPhotos = useMemo(() => photos.filter((p) => p.status === 'ready'), [photos])
  // Stored bytes are counted when processing finishes, after the upload itself: refresh
  // the storage bar whenever that total changes.
  const storedBytes = readyPhotos.reduce((sum, p) => sum + p.stored_bytes, 0)
  useEffect(() => {
    qc.invalidateQueries({ queryKey: ['me'] })
  }, [storedBytes, qc])

  const setPhoto = (p: Photo) =>
    qc.setQueryData<Photo[]>(['photos', id], (old) => old?.map((x) => (x.id === p.id ? p : x)))
  const patchPhoto = useMutation({
    mutationFn: ({ photo, body }: { photo: Photo; body: Record<string, unknown> }) =>
      api.patch<Photo>(`/api/photos/${photo.id}`, body),
    onSuccess: (p) => {
      setPhoto(p)
      qc.invalidateQueries({ queryKey: ['highlights', id] }) // a stop's position may move
    },
  })
  const bulk = useMutation({
    mutationFn: (isPublic: boolean) =>
      api.post(`/api/trips/${id}/photos/bulk`, { photo_ids: 'all', is_public: isPublic }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['photos', id] }),
  })
  const deletePhoto = useMutation({
    mutationFn: (photo: Photo) => api.delete(`/api/photos/${photo.id}`),
    onSuccess: (_, photo) => {
      qc.setQueryData<Photo[]>(['photos', id], (old) => old?.filter((x) => x.id !== photo.id))
      qc.invalidateQueries({ queryKey: ['me'] })
      qc.invalidateQueries({ queryKey: ['highlights', id] })
      setPhotoToDelete(null)
    },
  })
  const offset = useMutation({
    mutationFn: (seconds: number) =>
      api.patch<Trip>(`/api/trips/${id}`, { camera_offset_s: seconds }),
    onSuccess: (t) => {
      qc.setQueryData(['trip', id], t)
      qc.invalidateQueries({ queryKey: ['photos', id] })
      qc.invalidateQueries({ queryKey: ['highlights', id] })
    },
  })

  // --- Story stops (highlights) ---------------------------------------------------------
  const highlightsQuery = useQuery({
    queryKey: ['highlights', id],
    queryFn: () => api.get<Highlight[]>(`/api/trips/${id}/highlights`),
    enabled: !!trip,
  })
  const highlights = useMemo(() => highlightsQuery.data ?? [], [highlightsQuery.data])
  const [editingStop, setEditingStop] = useState<string | null>(null)
  const [stopToDelete, setStopToDelete] = useState<Highlight | null>(null)
  const scrollToStop = (stopId: string) =>
    requestAnimationFrame(() =>
      document
        .getElementById(`stop-${stopId}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }),
    )
  const saveStop = useMutation({
    mutationFn: ({ target, input }: { target: string; input: HighlightInput }) =>
      target === 'new'
        ? api.post<Highlight>(`/api/trips/${id}/highlights`, input)
        : api.patch<Highlight>(`/api/highlights/${target}`, input),
    onSuccess: async (saved) => {
      // A new stop is slotted in by route position, and photos may have moved between
      // stops: reload the story, then let the stops glide to their places.
      const list = await api.get<Highlight[]>(`/api/trips/${id}/highlights`)
      withViewTransition(() => {
        qc.setQueryData(['highlights', id], list)
        setEditingStop(null)
      })
      qc.invalidateQueries({ queryKey: ['photos', id] })
      scrollToStop(saved.id)
    },
  })
  const deleteStop = useMutation({
    mutationFn: (h: Highlight) => api.delete(`/api/highlights/${h.id}`),
    onSuccess: (_, h) => {
      setStopToDelete(null)
      withViewTransition(() =>
        qc.setQueryData<Highlight[]>(['highlights', id], (old) =>
          old?.filter((x) => x.id !== h.id),
        ),
      )
      qc.invalidateQueries({ queryKey: ['photos', id] })
    },
  })
  const reorderStops = useMutation({
    mutationFn: (ids: string[]) =>
      api.post<Highlight[]>(`/api/trips/${id}/highlights/order`, { ids }),
    onSuccess: (list) => qc.setQueryData(['highlights', id], list),
    onError: () => qc.invalidateQueries({ queryKey: ['highlights', id] }),
  })
  const moveStop = (h: Highlight, by: -1 | 1) => {
    const list = [...highlights]
    const i = list.findIndex((x) => x.id === h.id)
    const j = i + by
    if (i < 0 || j < 0 || j >= list.length) return
    ;[list[i], list[j]] = [list[j], list[i]]
    // Move it on screen at once; the server confirms the new order in the background.
    withViewTransition(() => qc.setQueryData(['highlights', id], list))
    reorderStops.mutate(list.map((x) => x.id))
    scrollToStop(h.id)
  }
  const saveStopError =
    saveStop.error instanceof ApiError
      ? (Object.values(saveStop.error.fields ?? {})[0]?.[0] ?? saveStop.error.message)
      : saveStop.error
        ? "Couldn't save this stop. Check your connection and try again."
        : ''

  const update = useMutation({
    mutationFn: (body: Partial<Trip>) => api.patch<Trip>(`/api/trips/${id}`, body),
    onSuccess: (t) => qc.setQueryData(['trip', id], t),
  })
  const remove = useMutation({
    mutationFn: () => api.delete(`/api/trips/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trips'] })
      navigate('/trips')
    },
  })

  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const [styleId, setStyleId] = useState<BaseStyleId>(DEFAULT_STYLE)
  const [replacing, setReplacing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [placing, setPlacing] = useState<Photo | null>(null)
  const [focus, setFocus] = useState<{ lng: number; lat: number; nonce: number } | null>(null)
  const [photoToDelete, setPhotoToDelete] = useState<Photo | null>(null)
  const [sharing, setSharing] = useState(false)
  const replay = useReplay()
  const stopPins = useMemo(() => mapStops(highlights, readyPhotos), [highlights, readyPhotos])
  const { data: me } = useSession()
  const newLink = useMutation({
    mutationFn: () => api.post<Trip>(`/api/trips/${id}/share-token/rotate`),
    onSuccess: (t) => qc.setQueryData(['trip', id], t),
  })

  const showMap = () =>
    mapSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  if (tripQuery.isLoading) return <p className="p-8 text-muted">Loading your trip…</p>
  if (!trip) {
    const notFound = tripQuery.error instanceof ApiError && tripQuery.error.status === 404
    return notFound ? (
      <StatusMessage
        title="Trip not found"
        body="It may have been deleted, or the link is wrong."
      />
    ) : (
      <StatusMessage
        title="Couldn't load this trip"
        body="Check your connection and try again."
        action={
          <button onClick={() => tripQuery.refetch()} className={btn.primary}>
            Try again
          </button>
        }
      />
    )
  }

  const track = trackQuery.data
  // While a replay runs, the elevation chart's cursor follows the camera.
  const chartIndex =
    replay.active && track
      ? profileIndexAtFraction(track.profile, replay.playback.fraction)
      : hoverIndex
  const hovered = chartIndex != null && track ? track.profile[chartIndex] : null
  const ready = trip.status === 'ready'
  const vis = VISIBILITY[trip.visibility]
  const VisIcon = vis.icon

  const mapReady = ready && !!track
  // Room the route keeps clear of: the title panel (wide screens) and the photo strip.
  const inset = {
    left: wide ? 430 : 0,
    bottom: readyPhotos.some((p) => p.route_fraction != null) ? 90 : 0,
  }

  // Title, dates, headline numbers and trip controls. Over the map on wider screens; above
  // it on phones and while there's no map yet.
  const header = (
    <div
      className={
        mapReady
          ? `px-4 pt-5 pb-4 transition-opacity duration-500 sm:absolute sm:top-4 sm:left-4 sm:z-10 sm:w-[25rem] sm:rounded-3xl sm:p-5 sm:map-panel ${
              replay.active ? 'sm:pointer-events-none sm:opacity-0' : ''
            }`
          : 'mx-auto w-full max-w-6xl px-4 pt-8 pb-6 sm:pt-12'
      }
    >
      <Link to="/trips" className="text-sm font-semibold text-brand hover:underline">
        My trips
      </Link>
      <h1
        className={`mt-1 font-extrabold tracking-[-0.03em] ${
          mapReady ? 'text-3xl leading-tight sm:text-[2rem]' : 'text-4xl leading-[1.05] sm:text-6xl'
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
      {ready && (
        <div className="mt-4">
          <StatsStrip stats={trip.stats} variant="lead" />
        </div>
      )}
      {mapReady && <PlayButton replay={replay} className="mt-4 w-full py-3" />}
      <div
        className={`flex items-center gap-2 text-sm ${mapReady ? 'mt-4 border-t border-line pt-4' : 'mt-6'}`}
      >
        <button
          onClick={() => setSharing(true)}
          className={`${trip.visibility === 'private' ? btn.primary : btn.secondary} h-9 py-0`}
          aria-haspopup="dialog"
        >
          {trip.visibility === 'private' ? (
            <Share2 className="h-4 w-4" aria-hidden />
          ) : (
            <VisIcon className="h-4 w-4 text-brand" aria-hidden />
          )}
          {trip.visibility === 'private' ? 'Share' : vis.label}
        </button>
        <ActionsMenu
          label="More trip actions"
          actions={[
            ...(ready
              ? [
                  {
                    label: replacing ? 'Cancel replacing GPX' : 'Replace GPX file',
                    icon: FileUp,
                    onSelect: () => setReplacing((r) => !r),
                  },
                ]
              : []),
            {
              label: 'Delete trip',
              icon: Trash2,
              danger: true,
              onSelect: () => setConfirmDelete(true),
            },
          ]}
        />
      </div>
      {update.isError && !sharing && (
        <p role="alert" className="mt-3 text-sm font-medium text-danger">
          Couldn't save that change. Check your connection and try again.
        </p>
      )}
    </div>
  )

  return (
    <div className="pb-16">
      {mapReady ? (
        <section ref={mapSectionRef} className="relative scroll-mt-16">
          {header}
          {/* The map is the page: full width, nearly a full screen tall. */}
          <div className="relative h-[62svh] min-h-[420px] bg-wash sm:h-[calc(100svh-4rem)] sm:max-h-[900px] sm:min-h-[580px]">
            <Suspense fallback={<div className="h-full w-full animate-pulse bg-wash" />}>
              <TripMap
                track={track}
                styleId={styleId}
                hoverIndex={hoverIndex}
                onHoverIndex={setHoverIndex}
                inset={inset}
                photos={readyPhotos}
                onPhotoClick={(pid) => setLightboxIndex(readyPhotos.findIndex((p) => p.id === pid))}
                placing={placing != null}
                onPlace={(lng, lat) => {
                  if (placing) patchPhoto.mutate({ photo: placing, body: { location: [lng, lat] } })
                  setPlacing(null)
                }}
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
              distanceM={trip.stats.distance_m}
              photos={readyPhotos}
              highlights={highlights}
              timeZone={trip.timezone}
              onOpenPhoto={(p) => {
                replay.pause()
                setLightboxIndex(readyPhotos.findIndex((x) => x.id === p.id))
              }}
            />
            {replay.active ? null : placing ? (
              <div className="map-panel absolute bottom-10 left-1/2 flex w-[min(92%,30rem)] -translate-x-1/2 items-center gap-3 rounded-2xl px-4 py-3 text-sm">
                {placing.thumb_url && (
                  <img
                    src={placing.thumb_url}
                    alt=""
                    className="h-10 w-12 rounded-md object-cover"
                  />
                )}
                <p className="flex-1 font-semibold">Click the map where this photo was taken.</p>
                <button onClick={() => setPlacing(null)} className={btn.ghost}>
                  Cancel
                </button>
              </div>
            ) : (
              // Clear of the scale bar (left) and attribution (right) below it.
              <div className="absolute right-3 bottom-9 left-3 flex justify-center sm:right-12 sm:left-[27rem]">
                <PhotoStrip
                  photos={readyPhotos}
                  onOpen={(p) => setLightboxIndex(readyPhotos.findIndex((x) => x.id === p.id))}
                  onHover={(f) =>
                    setHoverIndex(f == null ? null : profileIndexAtFraction(track.profile, f))
                  }
                />
              </div>
            )}
          </div>
          {/* Elevation and the remaining numbers, in a band right under the map. */}
          <div className="border-b border-line bg-card">
            <div className="mx-auto max-w-6xl px-4 pt-4 pb-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                <h2 className="flex items-baseline gap-3 font-bold">
                  Elevation
                  {hovered ? (
                    <span className="text-sm font-semibold text-brand tabular-nums">
                      {formatElevation(hovered[1])} at {formatDistance(hovered[0])}
                    </span>
                  ) : (
                    <span className="hidden text-sm font-normal text-muted sm:inline">
                      Hover the chart, the route or a photo
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
              <p className="mt-1 text-xs text-muted">
                {trip.stats.points_raw?.toLocaleString('en-IN')} GPS points, simplified to{' '}
                {trip.stats.points_simplified?.toLocaleString('en-IN')} for a fast map.
                <span className="hidden sm:inline">
                  {' '}
                  Hold Ctrl or ⌘ and scroll to zoom the map.
                </span>
              </p>
            </div>
          </div>
        </section>
      ) : (
        <header>{header}</header>
      )}

      {ready && !track && (
        <div className="h-[62svh] min-h-[420px] animate-pulse bg-wash sm:h-[calc(100svh-4rem)] sm:max-h-[900px]" />
      )}

      <section className="mx-auto w-full max-w-6xl px-4">
        {trip.status === 'processing' && (
          <div className="rounded-3xl border border-line bg-card p-10 text-center shadow-[var(--shadow-soft)]">
            <div className="mx-auto h-9 w-9 animate-spin rounded-full border-[3px] border-brand border-t-transparent" />
            <p className="mt-4 text-xl font-bold">Reading your track…</p>
            <p className="mt-1 text-muted">Working out distance, time and elevation.</p>
          </div>
        )}
        {trip.status === 'failed' && (
          <div role="alert" className="mb-6 rounded-2xl bg-danger/10 p-4 text-sm text-danger">
            <strong>We couldn't read that file.</strong> {trip.error || 'Unknown error.'} Try
            another GPX file.
          </div>
        )}
        {(trip.status === 'draft' || trip.status === 'failed' || replacing) && (
          <div className={replacing ? 'mt-8' : ''}>
            <GpxUpload trip={trip} />
          </div>
        )}
      </section>

      {ready && (
        <StoryThread
          trip={trip}
          highlights={highlights}
          photos={readyPhotos}
          profile={track?.profile}
          editing={editingStop}
          saving={saveStop.isPending}
          error={saveStopError}
          onEdit={(target) => {
            saveStop.reset()
            setEditingStop(target)
          }}
          onSave={(input) => editingStop && saveStop.mutate({ target: editingStop, input })}
          onDelete={setStopToDelete}
          onMove={moveStop}
          onOpenPhoto={(p) => setLightboxIndex(readyPhotos.findIndex((x) => x.id === p.id))}
          onShowOnMap={(h) => {
            const spots = h.photo_ids
              .map((pid) => readyPhotos.find((p) => p.id === pid)?.location)
              .filter((l) => l != null)
            if (!spots.length) return
            const lng = spots.reduce((t, l) => t + l[0], 0) / spots.length
            const lat = spots.reduce((t, l) => t + l[1], 0) / spots.length
            setFocus({ lng, lat, nonce: Date.now() })
            showMap()
          }}
        />
      )}
      {(deleteStop.isError || reorderStops.isError) && (
        <p role="alert" className="mx-auto mt-4 max-w-6xl px-4 text-sm font-medium text-danger">
          Couldn't save that change to the story. Check your connection and try again.
        </p>
      )}

      {trip.status !== 'processing' && (
        <section className="mx-auto mt-16 w-full max-w-6xl space-y-6 px-4">
          <div
            className={`grid gap-4 ${ready && readyPhotos.length ? 'lg:grid-cols-[1fr_22rem]' : ''}`}
          >
            <PhotoUpload tripId={trip.id} />
            {ready && readyPhotos.length > 0 && (
              <CameraOffset
                key={trip.camera_offset_s}
                value={trip.camera_offset_s}
                saving={offset.isPending}
                onChange={(s) => offset.mutate(s)}
                timeMatched={readyPhotos.filter((p) => p.placement === 'time').length}
              />
            )}
          </div>
          {(patchPhoto.isError || bulk.isError || deletePhoto.isError || offset.isError) && (
            <p role="alert" className="text-sm font-medium text-danger">
              Couldn't save that photo change. Check your connection and try again.
            </p>
          )}
          {photos.length > 0 && (
            <PhotoGrid
              photos={photos}
              canPlace={ready && !!track}
              placingId={placing?.id ?? null}
              bulkBusy={bulk.isPending}
              onOpen={(p) => setLightboxIndex(readyPhotos.findIndex((x) => x.id === p.id))}
              onPatch={(photo, body) => patchPhoto.mutate({ photo, body })}
              onBulk={(isPublic) => bulk.mutate(isPublic)}
              onStartPlacing={(p) => {
                setPlacing(p)
                showMap()
              }}
              onDelete={setPhotoToDelete}
            />
          )}
        </section>
      )}

      <Lightbox
        photos={readyPhotos}
        index={lightboxIndex != null && lightboxIndex >= 0 ? lightboxIndex : null}
        onIndex={setLightboxIndex}
        timeZone={trip.timezone}
        onShowOnMap={
          track
            ? (p) => {
                setLightboxIndex(null)
                setFocus({ lng: p.location![0], lat: p.location![1], nonce: Date.now() })
                showMap()
              }
            : undefined
        }
      />

      {me && (
        <ShareDialog
          open={sharing}
          trip={trip}
          username={me.username}
          saving={update.isPending || newLink.isPending}
          error={
            update.isError || newLink.isError
              ? "Couldn't save that change. Check your connection and try again."
              : ''
          }
          onChange={(body) => update.mutate(body)}
          onNewLink={() => newLink.mutate()}
          onClose={() => {
            update.reset()
            newLink.reset()
            setSharing(false)
          }}
        />
      )}

      <ConfirmDialog
        open={stopToDelete != null}
        title="Delete this stop?"
        body={`“${stopToDelete?.label ?? ''}” and its words will be removed from the story. Its photos stay in the trip.`}
        confirmLabel="Delete stop"
        busyLabel="Deleting…"
        busy={deleteStop.isPending}
        onConfirm={() => stopToDelete && deleteStop.mutate(stopToDelete)}
        onClose={() => setStopToDelete(null)}
      />

      <ConfirmDialog
        open={photoToDelete != null}
        title="Delete this photo?"
        body={`“${photoToDelete?.filename ?? ''}” will be removed from this trip. Your original stays on your device.`}
        confirmLabel="Delete photo"
        busyLabel="Deleting…"
        busy={deletePhoto.isPending}
        onConfirm={() => photoToDelete && deletePhoto.mutate(photoToDelete)}
        onClose={() => setPhotoToDelete(null)}
      />

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this trip?"
        body={`“${trip.title}”, its GPS track and its photos will be permanently deleted. This can't be undone.`}
        confirmLabel="Delete trip"
        busyLabel="Deleting…"
        busy={remove.isPending}
        onConfirm={() => remove.mutate()}
        onClose={() => setConfirmDelete(false)}
      />
    </div>
  )
}
