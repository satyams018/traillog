import { useQuery, useQueryClient } from '@tanstack/react-query'

import { ApiError, api, request } from './api'

const BASE = '/_allauth/browser/v1/auth'

export interface SessionUser {
  id: string
  username: string
  email: string
  display: string
}

/** Current session, or null when logged out (allauth answers 401). */
async function fetchSession(): Promise<SessionUser | null> {
  try {
    const res = await api.get<{ data: { user: SessionUser } }>(`${BASE}/session`)
    return res.data.user
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return null
    throw e
  }
}

export function useSession() {
  return useQuery({ queryKey: ['session'], queryFn: fetchSession, staleTime: 60_000 })
}

export function useAuthActions() {
  const qc = useQueryClient()
  const refresh = () => qc.invalidateQueries({ queryKey: ['session'] })

  return {
    async login(email: string, password: string) {
      await api.post(`${BASE}/login`, { email, password })
      await refresh()
    },
    async signup(email: string, username: string, password: string) {
      await api.post(`${BASE}/signup`, { email, username, password })
      await refresh()
    },
    async logout() {
      // allauth replies 401 ("no longer authenticated") on a successful logout.
      await request(`${BASE}/session`, { method: 'DELETE' }).catch((e) => {
        if (!(e instanceof ApiError && e.status === 401)) throw e
      })
      qc.clear()
      await refresh()
    },
  }
}
