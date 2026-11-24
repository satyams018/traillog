import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router'

import AuthForm, { AuthCard } from '../../components/AuthForm'
import { btn } from '../../components/ui'
import { checkResetKey, resetPassword } from '../../lib/account'
import { useDocumentTitle } from '../../lib/useDocumentTitle'

/** Step 2 of a password reset: the page the emailed link opens (ADR-37). */
export default function ResetPassword() {
  useDocumentTitle('Choose a new password')
  const { key = '' } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  // Check the link first, so an old one says so before the user types a new password.
  const check = useQuery({
    queryKey: ['reset-key', key],
    queryFn: () => checkResetKey(key),
    retry: false,
    staleTime: Infinity,
  })

  if (check.isPending)
    return <AuthCard title="Choose a new password" subtitle="Checking your link…" />

  if (check.isError) {
    return (
      <AuthCard
        title="This link has expired"
        subtitle="Reset links work once and only for a few days. Ask for a new one and use the latest email."
      >
        <Link to="/account/password/reset" className={`${btn.primary} mt-7 w-full py-3`}>
          Send a new link
        </Link>
      </AuthCard>
    )
  }

  return (
    <AuthForm
      title="Choose a new password"
      subtitle="Use at least 8 characters, and not one you use on other sites."
      submitLabel="Save new password"
      busyLabel="Saving…"
      fields={[
        { name: 'password', label: 'New password', type: 'password', autoComplete: 'new-password' },
      ]}
      onSubmit={async (v) => {
        const { loggedIn } = await resetPassword(key, v.password)
        await qc.invalidateQueries({ queryKey: ['session'] })
        if (loggedIn) navigate('/trips', { replace: true })
        else
          navigate('/login', {
            replace: true,
            state: { notice: 'Password changed. Log in with your new password.' },
          })
      }}
    />
  )
}
