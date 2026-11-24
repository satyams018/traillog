import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BadgeCheck } from 'lucide-react'
import { Link, useParams } from 'react-router'

import { AuthCard } from '../../components/AuthForm'
import { btn } from '../../components/ui'
import { ApiError } from '../../lib/api'
import { checkEmailKey, verifyEmail } from '../../lib/account'
import { useSession } from '../../lib/auth'
import { useDocumentTitle } from '../../lib/useDocumentTitle'

/**
 * The page the signup email links to. Confirming takes a click rather than happening on load,
 * because mail scanners open links in emails and would confirm addresses nobody checked.
 */
export default function VerifyEmail() {
  useDocumentTitle('Confirm your email')
  const { key = '' } = useParams()
  const qc = useQueryClient()
  const { data: user } = useSession()
  const check = useQuery({
    queryKey: ['email-key', key],
    queryFn: () => checkEmailKey(key),
    retry: false,
    staleTime: Infinity,
  })
  const confirm = useMutation({
    mutationFn: () => verifyEmail(key),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['emails'] }),
  })
  const next = user ? { to: '/trips', label: 'Go to my trips' } : { to: '/login', label: 'Log in' }

  if (check.isPending) return <AuthCard title="Confirm your email" subtitle="Checking your link…" />

  if (confirm.isSuccess) {
    return (
      <AuthCard
        title="Email confirmed"
        subtitle="Thanks. You'll get password reset links at this address."
      >
        <span className="mt-6 flex h-12 w-12 items-center justify-center rounded-2xl bg-wash text-brand">
          <BadgeCheck className="h-6 w-6" aria-hidden />
        </span>
        <Link to={next.to} className={`${btn.primary} mt-6 w-full py-3`}>
          {next.label}
        </Link>
      </AuthCard>
    )
  }

  if (check.isError) {
    return (
      <AuthCard
        title="This link doesn't work any more"
        subtitle={
          user
            ? 'It may have expired or already been used. You can send a new one from your account settings.'
            : 'It may have expired or already been used. Log in and send a new one from your account settings.'
        }
      >
        <Link to={user ? '/settings' : '/login'} className={`${btn.primary} mt-7 w-full py-3`}>
          {user ? 'Open account settings' : 'Log in'}
        </Link>
      </AuthCard>
    )
  }

  return (
    <AuthCard
      title="Confirm your email"
      subtitle={
        <>
          Is <strong className="text-ink">{check.data}</strong> your address? Confirm it so you can
          reset your password if you ever forget it.
        </>
      }
    >
      <button
        onClick={() => confirm.mutate()}
        disabled={confirm.isPending}
        className={`${btn.primary} mt-7 w-full py-3 text-base`}
      >
        {confirm.isPending ? 'Confirming…' : 'Confirm my email'}
      </button>
      {confirm.isError && (
        <p role="alert" className="mt-4 rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">
          {confirm.error instanceof ApiError
            ? confirm.error.message
            : "Couldn't reach TrailLog. Check your connection."}
        </p>
      )}
    </AuthCard>
  )
}
