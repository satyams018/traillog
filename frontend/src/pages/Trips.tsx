import { useMutation, useQuery } from '@tanstack/react-query'
import { Camera, CalendarDays, Clock, Plus, Route, TrendingUp } from 'lucide-react'
import { type FormEvent, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'

import RidgeBand from '../components/RidgeBand'
import RoutePreview from '../components/RoutePreview'
import { btn, field } from '../components/ui'
import { ApiError, api } from '../lib/api'
import { formatDateRange, formatDistance, formatDuration, formatElevation } from '../lib/format'
import { isHilly } from '../lib/stats'
import type { Page, Totals, Trip } from '../lib/types'
import { useDocumentTitle } from '../lib/useDocumentTitle'

const STATUS: Record<Trip['status'], { label: string; className: string }> = {
  draft: { label: 'Needs a GPX file', className: 'bg-wash text-brand' },
  processing: { label: 'Processing', className: 'bg-route/15 text-route-dark' },
  ready: { label: 'Ready', className: 'bg-brand text-white' }, // not shown: the normal state
  failed: { label: 'Upload failed', className: 'bg-danger/10 text-danger' },
}

export default function Trips() {
  useDocumentTitle('My trips')
  const navigate = useNavigate()
  const { data, isLoading } = useQuery({
    queryKey: ['trips'],
    queryFn: () => api.get<Page<Trip>>('/api/trips'),
  })
  const [title, setTitle] = useState('')
  const [needsName, setNeedsName] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const create = useMutation({
    mutationFn: (t: string) => api.post<Trip>('/api/trips', { title: t }),
    onSuccess: (trip) => navigate(`/trips/${trip.id}`),
  })

  // The button is always clickable: with no name yet it explains what's needed instead of
  // silently doing nothing (a disabled button looked broken).
  function submit(e: FormEvent) {
    e.preventDefault()
    const name = title.trim()
    if (!name) {
      setNeedsName(true)
      inputRef.current?.focus()
      return
    }
    create.mutate(name)
  }

  const errorMessage = needsName
    ? 'Give your trip a name first, e.g. “Goa, December 2026”.'
    : create.error instanceof ApiError
      ? (create.error.fields?.title?.[0] ?? create.error.message)
      : create.error
        ? "Couldn't create the trip. Check your connection and try again."
        : ''

  const trips = data?.results ?? []
  const totals = useQuery({
    queryKey: ['trips', 'totals'],
    queryFn: () => api.get<Totals>('/api/trips/totals'),
  }).data

  return (
    <>
      <div className="border-b border-line bg-card">
        <div className="mx-auto max-w-6xl px-4 pt-10 pb-8 sm:pt-12">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">My trips</h1>
              {totals && totals.trips > 0 ? (
                <TotalsRow totals={totals} />
              ) : (
                <p className="mt-1 text-muted">
                  {trips.length
                    ? 'Your trips are being processed.'
                    : 'Your trips will appear here.'}
                </p>
              )}
            </div>
            <form onSubmit={submit} className="w-full sm:w-auto">
              <div className="flex gap-2">
                <input
                  ref={inputRef}
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value)
                    setNeedsName(false)
                  }}
                  placeholder="Name your trip"
                  maxLength={120}
                  aria-label="New trip name"
                  aria-invalid={needsName}
                  aria-describedby={errorMessage ? 'new-trip-error' : undefined}
                  className={`${field} min-w-0 flex-1 sm:w-72 ${needsName ? 'border-danger' : ''}`}
                />
                <button disabled={create.isPending} className={btn.primary}>
                  <Plus className="h-4 w-4" aria-hidden />
                  {create.isPending ? 'Creating…' : 'New trip'}
                </button>
              </div>
              {errorMessage && (
                <p id="new-trip-error" role="alert" className="mt-2 text-sm text-danger">
                  {errorMessage}
                </p>
              )}
            </form>
          </div>
        </div>
      </div>
      <div className="mx-auto max-w-6xl px-4 pb-14">
        {isLoading ? (
          <p className="mt-8 text-muted">Loading your trips…</p>
        ) : !trips.length ? (
          <div className="contours-hero relative mt-8 overflow-hidden rounded-3xl border border-dashed border-brand/30 px-6 py-16 text-center">
            <div className="absolute inset-0 bg-paper/75" aria-hidden />
            <div className="relative">
              <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-card text-brand shadow-[var(--shadow-soft)]">
                <Route className="h-7 w-7" aria-hidden />
              </span>
              <h2 className="mt-5 text-xl font-bold">Start with your last trip</h2>
              <p className="mx-auto mt-2 max-w-sm text-muted">
                Name it above, then upload the GPX file from your phone, watch or GPS app.
              </p>
              <button className={`${btn.primary} mt-6`} onClick={() => inputRef.current?.focus()}>
                <Plus className="h-4 w-4" aria-hidden />
                Name your first trip
              </button>
            </div>
          </div>
        ) : (
          <ul className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {trips.map((t) => (
              <li key={t.id}>
                <Link
                  to={`/trips/${t.id}`}
                  className="group flex h-full flex-col overflow-hidden rounded-3xl border border-line bg-card shadow-[var(--shadow-soft)] transition-shadow hover:shadow-[var(--shadow-lift)]"
                >
                  {/* Cover: the trip's first photo with its route as a small map, or the route alone. */}
                  <div className="relative h-48 overflow-hidden bg-wash">
                    {t.cover_url && (
                      <img
                        src={t.cover_url}
                        alt=""
                        loading="lazy"
                        className="absolute inset-0 h-full w-full object-cover"
                      />
                    )}
                    {t.preview.length > 1 ? (
                      <div
                        className={
                          t.cover_url
                            ? 'absolute right-3 bottom-3 h-20 w-28 overflow-hidden rounded-xl border-2 border-white bg-wash shadow-[var(--shadow-soft)]'
                            : 'relative h-full'
                        }
                      >
                        <RoutePreview points={t.preview} />
                      </div>
                    ) : (
                      <div className="flex h-full items-center justify-center text-sm font-medium text-muted">
                        {t.status === 'processing' ? 'Drawing your route…' : 'No route yet'}
                      </div>
                    )}
                    {t.status !== 'ready' && (
                      <span
                        className={`absolute top-3 right-3 rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS[t.status].className}`}
                      >
                        {STATUS[t.status].label}
                      </span>
                    )}
                  </div>
                  <div className="flex-1 p-5">
                    <h2 className="text-lg font-bold group-hover:text-brand">{t.title}</h2>
                    {t.start_date && (
                      <p className="mt-1 flex items-center gap-1.5 text-sm text-muted">
                        <CalendarDays className="h-4 w-4" aria-hidden />
                        {formatDateRange(t.start_date, t.end_date)}
                      </p>
                    )}
                    {t.status === 'ready' && (
                      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-sm font-semibold">
                        <span className="flex items-center gap-1.5">
                          <Route className="h-4 w-4 text-muted" aria-hidden />
                          {formatDistance(t.stats.distance_m)}
                        </span>
                        {t.stats.total_s != null && (
                          <span className="flex items-center gap-1.5">
                            <Clock className="h-4 w-4 text-muted" aria-hidden />
                            {formatDuration(t.stats.total_s)}
                          </span>
                        )}
                        {isHilly(t.stats) && (
                          <span className="flex items-center gap-1.5">
                            <TrendingUp className="h-4 w-4 text-muted" aria-hidden />
                            {formatElevation(t.stats.gain_m)} climb
                          </span>
                        )}
                        {t.photo_count > 0 && (
                          <span className="flex items-center gap-1.5">
                            <Camera className="h-4 w-4 text-muted" aria-hidden />
                            {t.photo_count}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  {/* The climb as a small ridge, only where there is a climb to show. */}
                  {isHilly(t.stats) && t.elevation_preview.length > 1 && (
                    <RidgeBand values={t.elevation_preview} height={34} variant="mini" />
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}

/** Lifetime numbers, the way travel trackers sum up everywhere you've been. */
function TotalsRow({ totals }: { totals: Totals }) {
  const items = [
    { label: totals.trips === 1 ? 'trip' : 'trips', value: totals.trips.toLocaleString('en-IN') },
    { label: 'travelled', value: formatDistance(totals.distance_m) },
    {
      label: totals.days === 1 ? 'day out' : 'days out',
      value: String(totals.days),
      show: totals.days > 0,
    },
    { label: 'photos', value: totals.photos.toLocaleString('en-IN'), show: totals.photos > 0 },
    {
      label: 'highest point',
      value: formatElevation(totals.highest_m),
      show: (totals.highest_m ?? 0) >= 500,
    },
  ]
  return (
    <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-3">
      {items
        .filter((i) => i.show !== false)
        .map(({ label, value }) => (
          <div key={label} className="flex flex-col-reverse">
            <dt className="text-sm text-muted">{label}</dt>
            <dd className="text-2xl font-extrabold tracking-[-0.03em] text-brand tabular-nums">
              {value}
            </dd>
          </div>
        ))}
    </dl>
  )
}
