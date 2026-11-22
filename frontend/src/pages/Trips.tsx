import { useMutation, useQuery } from '@tanstack/react-query'
import { CalendarDays, Plus, Route, TrendingUp } from 'lucide-react'
import { type FormEvent, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'

import RoutePreview from '../components/RoutePreview'
import { btn, field } from '../components/ui'
import { ApiError, api } from '../lib/api'
import { formatDateRange, formatDistance, formatElevation } from '../lib/format'
import type { Page, Trip } from '../lib/types'
import { useDocumentTitle } from '../lib/useDocumentTitle'

const STATUS: Record<Trip['status'], { label: string; className: string }> = {
  draft: { label: 'Needs a GPX file', className: 'bg-lichen text-forest' },
  processing: { label: 'Processing', className: 'bg-trail/15 text-trail-dark' },
  ready: { label: 'Ready', className: 'bg-forest text-white' },
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
    ? 'Give your trip a name first, e.g. “Hampta Pass 2026”.'
    : create.error instanceof ApiError
      ? (create.error.fields?.title?.[0] ?? create.error.message)
      : create.error
        ? "Couldn't create the trip. Check your connection and try again."
        : ''

  const trips = data?.results ?? []

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:py-14">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">My trips</h1>
          <p className="mt-1 text-moss">
            {trips.length
              ? `${trips.length} ${trips.length === 1 ? 'trek' : 'treks'} so far.`
              : 'Your treks will appear here.'}
          </p>
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
              placeholder="Name your trek"
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

      {isLoading ? (
        <p className="mt-10 text-moss">Loading your trips…</p>
      ) : !trips.length ? (
        <div className="contours-hero relative mt-10 overflow-hidden rounded-3xl border border-dashed border-forest/30 px-6 py-16 text-center">
          <div className="absolute inset-0 bg-paper/75" aria-hidden />
          <div className="relative">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-card text-forest shadow-[var(--shadow-soft)]">
              <Route className="h-7 w-7" aria-hidden />
            </span>
            <h2 className="mt-5 text-xl font-bold">Start with your last trek</h2>
            <p className="mx-auto mt-2 max-w-sm text-moss">
              Name it above, then upload the GPX file from Strava, Garmin or your phone.
            </p>
            <button className={`${btn.primary} mt-6`} onClick={() => inputRef.current?.focus()}>
              <Plus className="h-4 w-4" aria-hidden />
              Name your first trip
            </button>
          </div>
        </div>
      ) : (
        <ul className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {trips.map((t) => (
            <li key={t.id}>
              <Link
                to={`/trips/${t.id}`}
                className="group block overflow-hidden rounded-3xl border border-line bg-card shadow-[var(--shadow-soft)] transition-shadow hover:shadow-[var(--shadow-lift)]"
              >
                <div className="contours-card relative h-40 bg-lichen/50">
                  {t.preview.length > 1 ? (
                    <RoutePreview points={t.preview} />
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm font-medium text-moss">
                      {t.status === 'processing' ? 'Drawing your route…' : 'No route yet'}
                    </div>
                  )}
                  <span
                    className={`absolute top-3 right-3 rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS[t.status].className}`}
                  >
                    {STATUS[t.status].label}
                  </span>
                </div>
                <div className="p-5">
                  <h2 className="text-lg font-bold group-hover:text-forest">{t.title}</h2>
                  {t.start_date && (
                    <p className="mt-1 flex items-center gap-1.5 text-sm text-moss">
                      <CalendarDays className="h-4 w-4" aria-hidden />
                      {formatDateRange(t.start_date, t.end_date)}
                    </p>
                  )}
                  {t.status === 'ready' && (
                    <div className="mt-4 flex gap-5 text-sm font-semibold">
                      <span className="flex items-center gap-1.5">
                        <Route className="h-4 w-4 text-trail-dark" aria-hidden />
                        {formatDistance(t.stats.distance_m)}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <TrendingUp className="h-4 w-4 text-trail-dark" aria-hidden />
                        {formatElevation(t.stats.gain_m)} climb
                      </span>
                    </div>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
