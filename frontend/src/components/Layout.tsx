import { LogOut, Map } from 'lucide-react'
import { NavLink, Outlet, useNavigate } from 'react-router'

import { useAuthActions, useSession } from '../lib/auth'
import Logo from './Logo'
import { btn } from './ui'

export default function Layout() {
  const { data: user } = useSession()
  const { logout } = useAuthActions()
  const navigate = useNavigate()

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-line bg-card/90 backdrop-blur">
        <nav className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:gap-6">
          <Logo />
          {user && (
            <NavLink
              to="/trips"
              className={({ isActive }) =>
                `flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold whitespace-nowrap ${
                  isActive ? 'bg-wash text-brand' : 'text-muted hover:text-ink'
                }`
              }
            >
              <Map className="h-4 w-4" aria-hidden />
              My trips
            </NavLink>
          )}
          <div className="ml-auto flex items-center gap-2 text-sm">
            {user ? (
              <>
                <span
                  className="hidden h-8 w-8 items-center justify-center rounded-full bg-route/15 font-bold text-route-dark sm:flex"
                  title={`Signed in as @${user.username}`}
                  aria-hidden
                >
                  {user.username.slice(0, 1).toUpperCase()}
                </span>
                <button
                  className={`${btn.ghost} whitespace-nowrap`}
                  aria-label="Log out"
                  onClick={async () => {
                    await logout()
                    navigate('/')
                  }}
                >
                  <LogOut className="h-4 w-4" aria-hidden />
                  <span className="hidden sm:inline">Log out</span>
                </button>
              </>
            ) : (
              <>
                <NavLink to="/login" className={`${btn.ghost} whitespace-nowrap`}>
                  Log in
                </NavLink>
                <NavLink to="/signup" className={`${btn.primary} whitespace-nowrap px-4`}>
                  Sign up free
                </NavLink>
              </>
            )}
          </div>
        </nav>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
      <footer className="border-t border-line bg-card">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-6 text-sm text-muted">
          <span>TrailLog: turn your trips into stories.</span>
          <span>Map data © OpenStreetMap contributors</span>
        </div>
      </footer>
    </div>
  )
}
