import { flushSync } from 'react-dom'

/**
 * Apply a React state change inside a View Transition, so elements with a
 * `view-transition-name` glide to their new places (e.g. reordered story stops). Falls back
 * to an instant update where the API is missing or motion is reduced.
 */
export function withViewTransition(update: () => void): void {
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  if (!document.startViewTransition || reduce) {
    update()
    return
  }
  document.startViewTransition(() => flushSync(update))
}
