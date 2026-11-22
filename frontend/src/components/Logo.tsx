import { Link } from 'react-router'

/** Mountain + trail mark, matching the favicon. */
export default function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-ink">
      <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden>
        <rect width="32" height="32" rx="9" fill="#1F5C3F" />
        <path d="M5 23 L13 11 L18 18 L21 14 L27 23 Z" fill="#F6F7F2" />
        <path
          d="M6 26.5 C11 23, 15 27.5, 20 24.5 S26 22.5, 27 23"
          stroke="#F07C1E"
          strokeWidth="2.2"
          fill="none"
          strokeLinecap="round"
        />
      </svg>
      TrailLog
    </Link>
  )
}
