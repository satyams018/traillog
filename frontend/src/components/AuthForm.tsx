import { type FormEvent, type ReactNode, useState } from 'react'

import { ApiError } from '../lib/api'
import Logo from './Logo'
import { btn, field } from './ui'

interface Field {
  name: string
  label: string
  type: string
  autoComplete: string
  hint?: string
}

interface Props {
  title: string
  subtitle: string
  fields: Field[]
  submitLabel: string
  busyLabel: string
  onSubmit: (values: Record<string, string>) => Promise<void>
  footer: ReactNode
}

export default function AuthForm({
  title,
  subtitle,
  fields,
  submitLabel,
  busyLabel,
  onSubmit,
  footer,
}: Props) {
  const [error, setError] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)

  async function handle(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await onSubmit(Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>)
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err
          : new ApiError(0, 'network', "Couldn't reach TrailLog. Check your connection."),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="contours-hero relative min-h-[calc(100vh-4rem)] px-4 py-12 sm:py-20">
      <div className="absolute inset-0 bg-paper/75" aria-hidden />
      <div className="relative mx-auto max-w-md rounded-3xl border border-line bg-card p-7 shadow-[var(--shadow-lift)] sm:p-9">
        <Logo />
        <h1 className="mt-6 text-3xl font-extrabold tracking-tight">{title}</h1>
        <p className="mt-1.5 text-moss">{subtitle}</p>
        <form onSubmit={handle} className="mt-7 space-y-5" noValidate>
          {fields.map((f) => {
            const errors = error?.fields?.[f.name]
            return (
              <label key={f.name} className="block">
                <span className="text-sm font-semibold">{f.label}</span>
                <input
                  name={f.name}
                  type={f.type}
                  autoComplete={f.autoComplete}
                  required
                  aria-invalid={!!errors}
                  className={`${field} mt-1.5 ${errors ? 'border-danger' : ''}`}
                />
                {errors?.map((m) => (
                  <span key={m} className="mt-1.5 block text-sm text-danger">
                    {m}
                  </span>
                ))}
                {f.hint && !errors && (
                  <span className="mt-1.5 block text-sm text-moss">{f.hint}</span>
                )}
              </label>
            )
          })}
          {error && !Object.keys(error.fields ?? {}).length && (
            <p role="alert" className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">
              {error.message}
            </p>
          )}
          <button disabled={busy} className={`${btn.primary} w-full py-3 text-base`}>
            {busy ? busyLabel : submitLabel}
          </button>
        </form>
        <p className="mt-6 text-sm text-moss">{footer}</p>
      </div>
    </div>
  )
}
