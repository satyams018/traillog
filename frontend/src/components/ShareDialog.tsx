import { Check, Copy, ExternalLink, RefreshCw, Share2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { PRIVACY_ZONES, VISIBILITY, shareUrl } from '../lib/visibility'
import type { Trip, Visibility } from '../lib/types'
import { btn } from './ui'

interface Props {
  open: boolean
  trip: Trip
  username: string
  saving: boolean
  error: string
  onChange: (body: Partial<Pick<Trip, 'visibility' | 'privacy_zone_m'>>) => void
  onNewLink: () => void
  onClose: () => void
}

function zoneLabel(m: number) {
  if (m === 0) return 'Off'
  return m >= 1000 ? `${m / 1000} km` : `${m} m`
}

/** Everything about sharing a trip in one place: who can see it, its link, and privacy. */
export default function ShareDialog({
  open,
  trip,
  username,
  saving,
  error,
  onChange,
  onNewLink,
  onClose,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const [copied, setCopied] = useState(false)
  const [confirmNewLink, setConfirmNewLink] = useState(false)

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  const shared = trip.visibility !== 'private'
  const url = shareUrl(trip, username)
  const previewUrl = `/u/${encodeURIComponent(username)}/${trip.slug}${
    trip.visibility === 'link' ? `?k=${trip.share_token}` : ''
  }`

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      // Clipboard blocked (http, permissions): select the text so the user can copy it.
      document.getElementById('share-url')?.focus()
      return
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  return (
    <dialog
      ref={ref}
      onClose={() => {
        setConfirmNewLink(false)
        onClose()
      }}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-labelledby="share-title"
      className="m-auto w-[min(94vw,32rem)] rounded-3xl bg-card p-6 text-ink shadow-[var(--shadow-lift)] backdrop:bg-ink/40 backdrop:backdrop-blur-sm sm:p-7"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-wash text-brand">
            <Share2 className="h-5 w-5" aria-hidden />
          </span>
          <h2 id="share-title" className="text-xl font-extrabold">
            Share “{trip.title}”
          </h2>
        </div>
        <button onClick={onClose} className={`${btn.ghost} -mt-1 -mr-2 px-2`} aria-label="Close">
          <X className="h-5 w-5" aria-hidden />
        </button>
      </div>

      <fieldset className="mt-6">
        <legend className="text-sm font-semibold text-muted">Who can see it</legend>
        <div className="mt-2 space-y-2">
          {(Object.keys(VISIBILITY) as Visibility[]).map((v) => {
            const { label, icon: Icon, help } = VISIBILITY[v]
            const on = trip.visibility === v
            return (
              <label
                key={v}
                className={`flex cursor-pointer gap-3 rounded-2xl border p-3.5 transition-colors ${
                  on ? 'border-brand bg-wash/60' : 'border-line hover:border-brand/40'
                }`}
              >
                <input
                  type="radio"
                  name="visibility"
                  value={v}
                  checked={on}
                  disabled={saving}
                  onChange={() => onChange({ visibility: v })}
                  className="mt-1 accent-[var(--color-brand)]"
                />
                <span>
                  <span className="flex items-center gap-1.5 font-semibold">
                    <Icon className="h-4 w-4 text-brand" aria-hidden />
                    {label}
                  </span>
                  <span className="mt-0.5 block text-sm text-muted">{help}</span>
                </span>
              </label>
            )
          })}
        </div>
      </fieldset>

      {shared && (
        <div className="mt-5">
          <label htmlFor="share-url" className="text-sm font-semibold text-muted">
            Link
          </label>
          <div className="mt-1.5 flex gap-2">
            <input
              id="share-url"
              readOnly
              value={url}
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 flex-1 rounded-xl border border-line bg-paper px-3 py-2.5 text-sm text-ink"
            />
            <button onClick={copy} className={btn.primary}>
              {copied ? (
                <Check className="h-4 w-4" aria-hidden />
              ) : (
                <Copy className="h-4 w-4" aria-hidden />
              )}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="sr-only" aria-live="polite">
            {copied ? 'Link copied' : ''}
          </p>
          {trip.visibility === 'link' &&
            (confirmNewLink ? (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-wash/70 p-3 text-sm">
                <span className="flex-1">The current link will stop working.</span>
                <button onClick={() => setConfirmNewLink(false)} className={btn.ghost}>
                  Keep it
                </button>
                <button
                  onClick={() => {
                    onNewLink()
                    setConfirmNewLink(false)
                  }}
                  disabled={saving}
                  className={btn.secondary}
                >
                  Make a new link
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmNewLink(true)}
                className={`${btn.ghost} mt-2 -ml-3 text-sm`}
              >
                <RefreshCw className="h-4 w-4" aria-hidden />
                Make a new link
              </button>
            ))}
        </div>
      )}

      <div className="mt-6 border-t border-line pt-5">
        <label htmlFor="privacy-zone" className="text-sm font-semibold">
          Hide the start and end of the route
        </label>
        <p className="mt-0.5 text-sm text-muted">
          So your home or hotel isn&apos;t shown. Photos taken there stay, but without a pin.
        </p>
        <select
          id="privacy-zone"
          value={trip.privacy_zone_m}
          disabled={saving}
          onChange={(e) => onChange({ privacy_zone_m: Number(e.target.value) })}
          className="mt-2 h-10 rounded-xl border border-line bg-card px-3 font-semibold"
        >
          {PRIVACY_ZONES.map((m) => (
            <option key={m} value={m}>
              {zoneLabel(m)}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <p role="alert" className="mt-4 text-sm font-medium text-danger">
          {error}
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <a href={previewUrl} target="_blank" rel="noreferrer" className={`${btn.ghost} -ml-3`}>
          <ExternalLink className="h-4 w-4" aria-hidden />
          {shared ? 'Open share page' : 'Preview share page'}
        </a>
        <button onClick={onClose} className={btn.secondary}>
          Done
        </button>
      </div>
    </dialog>
  )
}
