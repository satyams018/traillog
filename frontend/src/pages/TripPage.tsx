import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarDays, FileUp, Globe, Link2, Lock, Trash2 } from 'lucide-react'
import { Suspense, lazy, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import ActionsMenu from '../components/ActionsMenu'
import ConfirmDialog from '../components/ConfirmDialog'
import ElevationChart from '../components/ElevationChart'
import GpxUpload from '../components/GpxUpload'
import StatsStrip from '../components/StatsStrip'
import StatusMessage from '../components/StatusMessage'
import StyleSwitcher from '../components/StyleSwitcher'
import { btn } from '../components/ui'
import { ApiError, api } from '../lib/api'
import { formatDateRange, formatDistance, formatElevation } from '../lib/format'
import { type BaseStyleId, DEFAULT_STYLE } from '../lib/mapStyles'
import type { TrackData, Trip, Visibility } from '../lib/types'
import { useDocumentTitle } from '../lib/useDocumentTitle'

// MapLibre is large, so it loads only on pages that show a map (SPEC §11).
const TripMap = lazy(() => import('../components/TripMap'))

const POLL_MS = 2000
const POLL_LIMIT_MS = 2 * 60 * 1000
const CHART_HEIGHT = 130
// Space the chart panel takes at the bottom of the map (chart + header + margins).
const CHART_INSET = CHART_HEIGHT + 80

const VISIBILITY: Record<Visibility, { label: string; icon: typeof Lock; help: string }> = {
  private: { label: 'Private', icon: Lock, help: 'Only you can see this trip.' },
  link: {
    label: 'Anyone with the link',
    icon: Link2,
    help: 'Share pages are coming in the next update. Until then, only you can see this trip.',
  },
  public: {
    label: 'Public',
    icon: Globe,
    help: 'Share pages are coming in the next update. Until then, only you can see this trip.',
  },
}

export default function TripPage() {
  const { id = '' } = useParams()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const pollStarted = useRef<number | null>(null)

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

  if (tripQuery.isLoading) return <p className="p-8 text-moss">Loading your trip…</p>
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
  const hovered = hoverIndex != null && track ? track.profile[hoverIndex] : null
  const ready = trip.status === 'ready'
  const vis = VISIBILITY[trip.visibility]
  const VisIcon = vis.icon

  return (
    <div className="flex flex-col pb-16">
      <header className="mx-auto w-full max-w-6xl px-4 pt-8 pb-4 sm:pt-10">
        <Link to="/trips" className="text-sm font-semibold text-forest hover:underline">
          My trips
        </Link>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight sm:text-5xl">{trip.title}</h1>
            {trip.start_date && (
              <p className="mt-2 flex items-center gap-1.5 text-moss">
                <CalendarDays className="h-4 w-4" aria-hidden />
                {formatDateRange(trip.start_date, trip.end_date)}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 text-sm">
            <label className="relative flex items-center">
              <span className="sr-only">Who can see this trip</span>
              <VisIcon
                className="pointer-events-none absolute left-3 h-4 w-4 text-forest"
                aria-hidden
              />
              <select
                id="visibility"
                value={trip.visibility}
                onChange={(e) => update.mutate({ visibility: e.target.value as Visibility })}
                className="h-10 appearance-none rounded-full border border-line bg-card pr-9 pl-9 font-semibold text-ink shadow-[var(--shadow-soft)] hover:border-forest/40"
              >
                {(Object.keys(VISIBILITY) as Visibility[]).map((v) => (
                  <option key={v} value={v}>
                    {VISIBILITY[v].label}
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute right-3.5 text-moss" aria-hidden>
                ▾
              </span>
            </label>
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
        </div>
        {update.isError ? (
          <p role="alert" className="mt-3 text-sm font-medium text-danger">
            Couldn't save that change. Check your connection and try again.
          </p>
        ) : (
          trip.visibility !== 'private' && <p className="mt-3 text-sm text-moss">{vis.help}</p>
        )}
      </header>

      {/* On phones the map comes before the stats; on larger screens the stats lead. */}
      {ready && (
        <section className="order-3 mx-auto w-full max-w-6xl px-4 pt-6 sm:order-2 sm:pt-2 sm:pb-6">
          <StatsStrip stats={trip.stats} />
        </section>
      )}

      <section className="order-4 mx-auto w-full max-w-6xl px-4">
        {trip.status === 'processing' && (
          <div className="rounded-3xl border border-line bg-card p-10 text-center shadow-[var(--shadow-soft)]">
            <div className="mx-auto h-9 w-9 animate-spin rounded-full border-[3px] border-forest border-t-transparent" />
            <p className="mt-4 text-xl font-bold">Reading your track…</p>
            <p className="mt-1 text-moss">Working out distance, climb and time.</p>
          </div>
        )}
        {trip.status === 'failed' && (
          <div role="alert" className="mb-6 rounded-2xl bg-danger/10 p-4 text-sm text-danger">
            <strong>We couldn't read that file.</strong> {trip.error || 'Unknown error.'} Try
            another GPX file.
          </div>
        )}
        {(trip.status === 'draft' || trip.status === 'failed' || replacing) && (
          <div className={replacing ? 'mt-6' : ''}>
            <GpxUpload trip={trip} />
          </div>
        )}
      </section>

      {ready && track && (
        <section className="order-2 mx-auto w-full max-w-6xl px-4 sm:order-3">
          <div className="relative h-[62vh] min-h-[440px] overflow-hidden rounded-3xl border border-line bg-lichen shadow-[var(--shadow-soft)] sm:h-[68vh]">
            <Suspense fallback={<div className="h-full w-full animate-pulse bg-lichen" />}>
              <TripMap
                track={track}
                styleId={styleId}
                hoverIndex={hoverIndex}
                onHoverIndex={setHoverIndex}
                bottomInset={CHART_INSET}
              />
            </Suspense>
            <div className="absolute top-3 left-3">
              <StyleSwitcher value={styleId} onChange={setStyleId} />
            </div>
            {/* Sits above a 40px strip so the map's scale bar and attribution stay visible. */}
            <div className="map-panel absolute inset-x-3 bottom-10 rounded-2xl px-3 pt-2.5 pb-1">
              <div className="flex h-5 items-center justify-between px-1 text-sm">
                <span className="font-semibold">Elevation</span>
                {hovered ? (
                  <span className="font-semibold text-forest tabular-nums">
                    {formatDistance(hovered[0])} in, at {formatElevation(hovered[1])}
                  </span>
                ) : (
                  <span className="hidden text-moss sm:inline">Hover to explore the climb</span>
                )}
              </div>
              <ElevationChart
                profile={track.profile}
                hoverIndex={hoverIndex}
                onHoverIndex={setHoverIndex}
                height={CHART_HEIGHT}
              />
            </div>
          </div>
          <p className="mt-3 text-sm text-moss">
            {trip.stats.points_raw?.toLocaleString('en-IN')} GPS points, simplified to{' '}
            {trip.stats.points_simplified?.toLocaleString('en-IN')} for a fast map.
            <span className="hidden sm:inline"> Hold Ctrl or ⌘ and scroll to zoom.</span>
          </p>
        </section>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this trip?"
        body={`“${trip.title}” and its GPS track will be permanently deleted. This can't be undone.`}
        confirmLabel="Delete trip"
        busyLabel="Deleting…"
        busy={remove.isPending}
        onConfirm={() => remove.mutate()}
        onClose={() => setConfirmDelete(false)}
      />
    </div>
  )
}
