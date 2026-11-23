import { Link } from 'react-router'

/** A dotted route ending at a map pin, matching the favicon. */
export default function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-ink">
      <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden>
        <rect width="32" height="32" rx="9" fill="#2449C8" />
        <path
          d="M7 25 C9 18, 15 22, 16 16 S21 11, 21.5 12"
          stroke="#FFFFFF"
          strokeWidth="2.2"
          strokeDasharray="0.1 4"
          strokeLinecap="round"
          fill="none"
        />
        <path
          d="M22 19.5 C22 19.5, 17.2 14.6, 17.2 11.2 a4.8 4.8 0 0 1 9.6 0 C26.8 14.6, 22 19.5, 22 19.5 Z"
          fill="#E33A6E"
          stroke="#FFFFFF"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <circle cx="22" cy="11.3" r="1.7" fill="#FFFFFF" />
      </svg>
      TrailLog
    </Link>
  )
}
