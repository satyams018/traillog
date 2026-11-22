import { Link, useLocation, useNavigate } from 'react-router'

import AuthForm from '../components/AuthForm'
import { useAuthActions } from '../lib/auth'
import { useDocumentTitle } from '../lib/useDocumentTitle'

export default function Login() {
  useDocumentTitle('Log in')
  const { login } = useAuthActions()
  const navigate = useNavigate()
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/trips'
  return (
    <AuthForm
      title="Welcome back"
      subtitle="Log in to see your trips."
      submitLabel="Log in"
      busyLabel="Logging in…"
      fields={[
        { name: 'email', label: 'Email', type: 'email', autoComplete: 'email' },
        { name: 'password', label: 'Password', type: 'password', autoComplete: 'current-password' },
      ]}
      onSubmit={async (v) => {
        await login(v.email, v.password)
        navigate(from, { replace: true })
      }}
      footer={
        <>
          New here?{' '}
          <Link
            to="/signup"
            className="font-semibold text-forest underline-offset-2 hover:underline"
          >
            Create an account
          </Link>
        </>
      }
    />
  )
}
