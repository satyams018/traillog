import { Check } from 'lucide-react'
import { type FormEvent, useEffect, useRef, useState } from 'react'

import type { Highlight, HighlightInput, HighlightKind, Photo } from '../lib/types'
import { KIND } from './storyKinds'
import { btn, field } from './ui'

interface Props {
  /** The stop being edited, or null for a new one. */
  highlight: Highlight | null
  /** Ready photos of the trip, in route order. */
  photos: Photo[]
  /** Labels of the other stops, to say where a photo will move from. */
  stopLabels: Record<string, string>
  saving: boolean
  error: string
  onSave: (input: HighlightInput) => void
  onCancel: () => void
}

/** Inline form for one story stop: type, title, a few words and the photos taken there. */
export default function HighlightEditor({
  highlight,
  photos,
  stopLabels,
  saving,
  error,
  onSave,
  onCancel,
}: Props) {
  const [kind, setKind] = useState<HighlightKind>(highlight?.kind ?? 'sight')
  const [label, setLabel] = useState(highlight?.label ?? '')
  const [body, setBody] = useState(highlight?.body ?? '')
  const [picked, setPicked] = useState<string[]>(highlight?.photo_ids ?? [])
  const [missingTitle, setMissingTitle] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLFormElement>(null)

  // Bring the form into view and put the cursor in the title.
  useEffect(() => {
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    titleRef.current?.focus({ preventScroll: true })
  }, [])

  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!label.trim()) {
      setMissingTitle(true)
      titleRef.current?.focus()
      return
    }
    onSave({ kind, label: label.trim(), body, photo_ids: picked })
  }

  const moving = picked.filter((id) => {
    const from = photos.find((p) => p.id === id)?.highlight
    return from && from !== highlight?.id
  }).length

  return (
    <form
      ref={formRef}
      onSubmit={submit}
      onKeyDown={(e) => e.key === 'Escape' && onCancel()}
      className="scroll-mt-24 rounded-3xl border border-line bg-card p-5 shadow-[var(--shadow-lift)] sm:p-6"
      aria-label={highlight ? `Edit “${highlight.label}”` : 'New stop'}
    >
      <fieldset>
        <legend className="text-sm font-semibold text-muted">What kind of place</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {(Object.keys(KIND) as HighlightKind[]).map((k) => {
            const { label: name, icon: Icon } = KIND[k]
            return (
              <button
                key={k}
                type="button"
                aria-pressed={kind === k}
                onClick={() => setKind(k)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors ${
                  kind === k
                    ? 'border-brand bg-brand text-white'
                    : 'border-line bg-card text-ink hover:border-brand/40'
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {name}
              </button>
            )
          })}
        </div>
      </fieldset>

      <label className="mt-5 block">
        <span className="text-sm font-semibold text-muted">Title</span>
        <input
          ref={titleRef}
          value={label}
          maxLength={120}
          onChange={(e) => {
            setLabel(e.target.value)
            setMissingTitle(false)
          }}
          placeholder="e.g. Sunset at the old fort"
          aria-invalid={missingTitle}
          className={`${field} mt-1.5 text-lg font-semibold ${missingTitle ? 'border-danger' : ''}`}
        />
        {missingTitle && (
          <span role="alert" className="mt-1 block text-sm text-danger">
            Give this stop a title.
          </span>
        )}
      </label>

      <label className="mt-4 block">
        <span className="text-sm font-semibold text-muted">What happened here (optional)</span>
        <textarea
          value={body}
          maxLength={5000}
          rows={4}
          onChange={(e) => setBody(e.target.value)}
          placeholder="What you saw, what you ate, who you met…"
          className={`${field} mt-1.5 resize-y leading-relaxed`}
        />
      </label>

      <div className="mt-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-sm font-semibold text-muted">
            Photos from this stop{' '}
            <span className="font-normal">
              ({picked.length} chosen{moving ? `, ${moving} moving from another stop` : ''})
            </span>
          </span>
          {picked.length > 0 && (
            <button type="button" onClick={() => setPicked([])} className={btn.ghost}>
              Clear
            </button>
          )}
        </div>
        {photos.length ? (
          <ul className="mt-2 grid max-h-80 grid-cols-3 gap-2 overflow-y-auto p-1 sm:grid-cols-5 lg:grid-cols-6">
            {photos.map((p) => {
              const on = picked.includes(p.id)
              const elsewhere = p.highlight && p.highlight !== highlight?.id
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    aria-pressed={on}
                    aria-label={`${on ? 'Remove' : 'Add'} ${p.caption || p.filename}`}
                    onClick={() => toggle(p.id)}
                    className={`relative block aspect-square w-full overflow-hidden rounded-xl bg-wash transition-[box-shadow,transform] duration-150 active:scale-95 ${
                      on
                        ? 'ring-[3px] ring-route ring-offset-2'
                        : 'hover:ring-2 hover:ring-brand/40'
                    }`}
                  >
                    <img
                      src={p.thumb_url ?? undefined}
                      alt=""
                      loading="lazy"
                      className={`h-full w-full object-cover transition-opacity ${
                        elsewhere && !on ? 'opacity-50' : ''
                      }`}
                    />
                    {on && (
                      <span className="absolute top-1.5 right-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-route text-white shadow">
                        <Check className="h-4 w-4" aria-hidden />
                      </span>
                    )}
                    {elsewhere && (
                      <span className="absolute inset-x-1 bottom-1 truncate rounded-md bg-ink/70 px-1.5 py-0.5 text-[11px] font-semibold text-white">
                        {stopLabels[p.highlight!] ?? 'Another stop'}
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted">
            Add photos to this trip first; you can still save a stop with just words.
          </p>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-4 text-sm font-medium text-danger">
          {error}
        </p>
      )}
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onCancel} className={btn.secondary}>
          Cancel
        </button>
        <button disabled={saving} className={btn.primary}>
          {saving ? 'Saving…' : highlight ? 'Save stop' : 'Add stop'}
        </button>
      </div>
    </form>
  )
}
