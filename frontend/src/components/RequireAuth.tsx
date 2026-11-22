import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'

import { useSession } from '../lib/auth'

export default function RequireAuth({ children }: { children: ReactNode }) {
  const { data: user, isLoading } = useSession()
  const location = useLocation()
  if (isLoading) return <p className="p-8 text-moss">Loading…</p>
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <>{children}</>
}
