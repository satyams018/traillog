import { Link, useNavigate } from 'react-router'

import AuthForm from '../components/AuthForm'
import { useAuthActions } from '../lib/auth'
import { useDocumentTitle } from '../lib/useDocumentTitle'

export default function Signup() {
  useDocumentTitle('Sign up')
  const { signup } = useAuthActions()
  const navigate = useNavigate()
  return (
    <AuthForm
      title="Create your account"
      subtitle="Free, and it takes a minute."
      submitLabel="Create account"
      busyLabel="Creating account…"
      fields={[
        { name: 'email', label: 'Email', type: 'email', autoComplete: 'email' },
        {
          name: 'username',
          label: 'Username',
          type: 'text',
          autoComplete: 'username',
          hint: 'Lowercase letters, numbers, - or _. It appears in your share links.',
        },
        { name: 'password', label: 'Password', type: 'password', autoComplete: 'new-password' },
      ]}
      onSubmit={async (v) => {
        await signup(v.email, v.username.trim().toLowerCase(), v.password)
        navigate('/trips', { replace: true })
      }}
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-semibold text-brand underline-offset-2 hover:underline">
            Log in
          </Link>
        </>
      }
    />
  )
}
