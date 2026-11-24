import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BadgeCheck, MailWarning, Trash2 } from 'lucide-react'
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'

import { btn, field } from '../components/ui'
import { changePassword, deleteAccount, emailAddresses, resendVerification } from '../lib/account'
import { ApiError, api } from '../lib/api'
import { formatBytes } from '../lib/format'
import type { Me } from '../lib/types'
import { useDocumentTitle } from '../lib/useDocumentTitle'

const NETWORK = "Couldn't reach TrailLog. Check your connection."

function errorOf(e: unknown): ApiError {
  return e instanceof ApiError ? e : new ApiError(0, 'network', NETWORK)
}

function Section({
  title,
  intro,
  children,
  tone,
}: {
  title: string
  intro?: ReactNode
  children: ReactNode
  tone?: 'danger'
}) {
  return (
    <section
      className={`rounded-3xl border bg-card p-6 sm:p-7 ${tone === 'danger' ? 'border-danger/30' : 'border-line'}`}
    >
      <h2 className="text-lg font-extrabold">{title}</h2>
      {intro && <p className="mt-1 text-sm text-muted">{intro}</p>}
      <div className="mt-5">{children}</div>
    </section>
  )
}

function FieldErrors({ messages }: { messages?: string[] }) {
  return messages?.map((m) => (
    <span key={m} className="mt-1.5 block text-sm text-danger">
      {m}
    </span>
  ))
}

/** Account settings: name, email status, password, storage, and deleting the account. */
export default function Settings() {
  useDocumentTitle('Account settings')
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>('/api/me') })

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:py-14">
      <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Account settings</h1>
      {me.isPending ? (
        <p className="mt-8 text-muted">Loading your account…</p>
      ) : me.isError ? (
        <p role="alert" className="mt-8 text-danger">
          {errorOf(me.error).message}
        </p>
      ) : (
        <div className="mt-8 space-y-6">
          <ProfileSection me={me.data} />
          <PasswordSection />
          <StorageSection me={me.data} />
          <DeleteSection username={me.data.username} />
        </div>
      )}
    </div>
  )
}

function ProfileSection({ me }: { me: Me }) {
  const qc = useQueryClient()
  const [name, setName] = useState(me.display_name)
  const save = useMutation({
    mutationFn: () => api.patch<Me>('/api/me', { display_name: name }),
    onSuccess: (data) => {
      qc.setQueryData(['me'], data)
      setName(data.display_name)
    },
  })
  const changed = name.trim() !== me.display_name
  const error = save.error ? errorOf(save.error) : null

  return (
    <Section title="Profile" intro="Your name shows on the trips you share.">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        <label className="block">
          <span className="text-sm font-semibold">Display name</span>
          <div className="mt-1.5 flex gap-2">
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                save.reset()
              }}
              maxLength={60}
              placeholder={me.username}
              autoComplete="name"
              aria-invalid={!!error?.fields?.display_name}
              className={`${field} min-w-0 flex-1`}
            />
            <button disabled={!changed || save.isPending} className={btn.primary}>
              {save.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
          <FieldErrors messages={error?.fields?.display_name} />
          {error && !error.fields && (
            <span role="alert" className="mt-1.5 block text-sm text-danger">
              {error.message}
            </span>
          )}
          {save.isSuccess && (
            <span role="status" className="mt-1.5 block text-sm text-muted">
              Saved.
            </span>
          )}
          {!error && !save.isSuccess && (
            <span className="mt-1.5 block text-sm text-muted">
              Leave it empty to show your username instead.
            </span>
          )}
        </label>
      </form>

      <dl className="mt-6 grid gap-4 border-t border-line pt-5 text-sm sm:grid-cols-[8rem_1fr]">
        <dt className="font-semibold text-muted">Username</dt>
        <dd>
          <span className="font-semibold">@{me.username}</span>
          <span className="block text-muted">
            It's part of your share links, so it can't be changed.
          </span>
        </dd>
        <dt className="font-semibold text-muted">Email</dt>
        <dd>
          <span className="font-semibold break-all">{me.email}</span>
          <EmailStatus email={me.email} />
        </dd>
      </dl>
    </Section>
  )
}

function EmailStatus({ email }: { email: string }) {
  const emails = useQuery({ queryKey: ['emails'], queryFn: emailAddresses })
  const resend = useMutation({ mutationFn: () => resendVerification(email) })
  const verified = emails.data?.find((e) => e.email === email)?.verified
  if (emails.isPending || verified === undefined) return null

  if (verified) {
    return (
      <span className="mt-1 flex items-center gap-1.5 text-muted">
        <BadgeCheck className="h-4 w-4 text-brand" aria-hidden />
        Confirmed
      </span>
    )
  }
  return (
    <span className="mt-1 block">
      <span className="flex items-center gap-1.5 text-muted">
        <MailWarning className="h-4 w-4 text-route-dark" aria-hidden />
        Not confirmed yet. Confirm it so you can reset your password.
      </span>
      {resend.data === 'sent' ? (
        <span role="status" className="mt-1 block font-semibold">
          Sent. Open the link in the email.
        </span>
      ) : resend.data === 'cooldown' ? (
        <span role="status" className="mt-1 block font-semibold">
          We sent one a few minutes ago. Check your inbox and spam folder.
        </span>
      ) : (
        <button
          onClick={() => resend.mutate()}
          disabled={resend.isPending}
          className={`${btn.ghost} -ml-3 text-sm`}
        >
          {resend.isPending ? 'Sending…' : 'Send the confirmation email again'}
        </button>
      )}
      {resend.isError && (
        <span role="alert" className="block text-danger">
          {errorOf(resend.error).message}
        </span>
      )}
    </span>
  )
}

function PasswordSection() {
  const formRef = useRef<HTMLFormElement>(null)
  const change = useMutation({
    mutationFn: (v: { current: string; next: string }) => changePassword(v.current, v.next),
    onSuccess: () => formRef.current?.reset(),
  })
  const error = change.error ? errorOf(change.error) : null
  const shown = ['current_password', 'new_password']
  const other = error && !shown.some((f) => error.fields?.[f])

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const data = new FormData(e.currentTarget)
    change.mutate({ current: String(data.get('current')), next: String(data.get('next')) })
  }

  return (
    <Section title="Password" intro="You'll stay logged in on this device.">
      <form ref={formRef} onSubmit={submit} className="space-y-4" noValidate>
        {/* Lets password managers file the new password under the right account. */}
        <input type="text" autoComplete="username" hidden readOnly />
        <label className="block">
          <span className="text-sm font-semibold">Current password</span>
          <input
            name="current"
            type="password"
            autoComplete="current-password"
            required
            onChange={() => change.reset()}
            aria-invalid={!!error?.fields?.current_password}
            className={`${field} mt-1.5`}
          />
          <FieldErrors messages={error?.fields?.current_password} />
        </label>
        <label className="block">
          <span className="text-sm font-semibold">New password</span>
          <input
            name="next"
            type="password"
            autoComplete="new-password"
            required
            onChange={() => change.reset()}
            aria-invalid={!!error?.fields?.new_password}
            className={`${field} mt-1.5`}
          />
          <FieldErrors messages={error?.fields?.new_password} />
        </label>
        {other && (
          <p role="alert" className="text-sm text-danger">
            {error.message}
          </p>
        )}
        {change.isSuccess && (
          <p role="status" className="text-sm font-semibold">
            Password changed.
          </p>
        )}
        <button disabled={change.isPending} className={btn.primary}>
          {change.isPending ? 'Changing…' : 'Change password'}
        </button>
      </form>
    </Section>
  )
}

function StorageSection({ me }: { me: Me }) {
  const pct = me.storage_quota_bytes
    ? Math.min(100, (me.storage_used_bytes / me.storage_quota_bytes) * 100)
    : 0
  return (
    <Section
      title="Photo storage"
      intro="We keep small copies of your photos without location data. Your originals stay on your device."
    >
      <div
        role="meter"
        aria-label="Photo storage used"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        className="h-2.5 overflow-hidden rounded-full bg-wash"
      >
        <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 text-sm text-muted tabular-nums">
        {formatBytes(me.storage_used_bytes)} of {formatBytes(me.storage_quota_bytes)} used
      </p>
    </Section>
  )
}

function DeleteSection({ username }: { username: string }) {
  const [open, setOpen] = useState(false)
  return (
    <Section
      title="Delete account"
      tone="danger"
      intro="This deletes every trip, photo and story, and frees your username. Share links stop working. It can't be undone."
    >
      <button onClick={() => setOpen(true)} className={btn.danger}>
        <Trash2 className="h-4 w-4" aria-hidden />
        Delete my account
      </button>
      <DeleteDialog open={open} username={username} onClose={() => setOpen(false)} />
    </Section>
  )
}

function DeleteDialog({
  open,
  username,
  onClose,
}: {
  open: boolean
  username: string
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const remove = useMutation({
    mutationFn: () => deleteAccount(password),
    onSuccess: () => {
      qc.clear()
      qc.setQueryData(['session'], null) // logged out; skip the refetch
      navigate('/', { replace: true })
    },
  })
  const error = remove.error ? errorOf(remove.error) : null

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  function close() {
    setPassword('')
    remove.reset()
    onClose()
  }

  return (
    <dialog
      ref={ref}
      onClose={close}
      onClick={(e) => e.target === ref.current && close()}
      aria-labelledby="delete-account-title"
      className="m-auto w-[min(92vw,28rem)] rounded-3xl bg-card p-7 text-ink shadow-[var(--shadow-lift)] backdrop:bg-ink/40 backdrop:backdrop-blur-sm"
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-danger/10 text-danger">
        <Trash2 className="h-5 w-5" aria-hidden />
      </span>
      <h2 id="delete-account-title" className="mt-4 text-xl font-extrabold">
        Delete @{username} for good?
      </h2>
      <p className="mt-2 text-muted">
        All your trips, photos and stories will be deleted, and links you've shared will stop
        working. There's no undo.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          remove.mutate()
        }}
        className="mt-5"
      >
        <label className="block">
          <span className="text-sm font-semibold">Type your password to confirm</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
              remove.reset()
            }}
            aria-invalid={!!error}
            className={`${field} mt-1.5`}
          />
        </label>
        {error && (
          <p role="alert" className="mt-2 text-sm text-danger">
            {error.fields?.password?.[0] ?? error.message}
          </p>
        )}
        <div className="mt-7 flex justify-end gap-2">
          <button type="button" onClick={close} className={btn.secondary} autoFocus>
            Cancel
          </button>
          <button disabled={!password || remove.isPending} className={btn.danger}>
            {remove.isPending ? 'Deleting…' : 'Delete everything'}
          </button>
        </div>
      </form>
    </dialog>
  )
}
