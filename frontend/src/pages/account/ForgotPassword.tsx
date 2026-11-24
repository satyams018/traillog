import { MailCheck } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'

import AuthForm, { AuthCard } from '../../components/AuthForm'
import { btn } from '../../components/ui'
import { requestPasswordReset } from '../../lib/account'
import { useDocumentTitle } from '../../lib/useDocumentTitle'

const linkClass = 'font-semibold text-brand underline-offset-2 hover:underline'

/** Step 1 of a password reset: ask for the email and send a link (ADR-37). */
export default function ForgotPassword() {
  useDocumentTitle('Reset your password')
  const [sentTo, setSentTo] = useState('')

  if (sentTo) {
    return (
      <AuthCard
        title="Check your email"
        subtitle={
          <>
            If <strong className="text-ink">{sentTo}</strong> has a TrailLog account, a link to
            choose a new password is on its way. It can take a minute; check your spam folder too.
          </>
        }
        footer={
          <>
            Wrong address?{' '}
            <button onClick={() => setSentTo('')} className={linkClass}>
              Try another
            </button>
          </>
        }
      >
        <span className="mt-6 flex h-12 w-12 items-center justify-center rounded-2xl bg-wash text-brand">
          <MailCheck className="h-6 w-6" aria-hidden />
        </span>
        <Link to="/login" className={`${btn.secondary} mt-6 w-full py-3`}>
          Back to log in
        </Link>
      </AuthCard>
    )
  }

  return (
    <AuthForm
      title="Forgot your password?"
      subtitle="Enter the email you signed up with and we'll send you a link to choose a new one."
      submitLabel="Send reset link"
      busyLabel="Sending…"
      fields={[{ name: 'email', label: 'Email', type: 'email', autoComplete: 'email' }]}
      onSubmit={async (v) => {
        const email = v.email.trim()
        await requestPasswordReset(email)
        setSentTo(email)
      }}
      footer={
        <>
          Remembered it?{' '}
          <Link to="/login" className={linkClass}>
            Log in
          </Link>
        </>
      }
    />
  )
}
