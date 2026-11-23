import { Compass } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'

import { btn } from './ui'

/** Full-page message for not-found and error states, always with a way forward. */
export default function StatusMessage({
  title,
  body,
  action,
  showTripsLink = true,
}: {
  title: string
  body: string
  action?: ReactNode
  /** Off on public pages, where the visitor may not have an account. */
  showTripsLink?: boolean
}) {
  return (
    <div className="mx-auto max-w-md px-4 py-24 text-center">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-wash text-brand">
        <Compass className="h-7 w-7" aria-hidden />
      </span>
      <h1 className="mt-5 text-3xl font-extrabold tracking-tight">{title}</h1>
      <p className="mt-3 text-muted">{body}</p>
      <div className="mt-8 flex justify-center gap-3">
        {action}
        {showTripsLink && (
          <Link to="/trips" className={btn.secondary}>
            Back to my trips
          </Link>
        )}
      </div>
    </div>
  )
}
