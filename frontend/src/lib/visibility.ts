import { Globe, Link2, Lock } from 'lucide-react'

import type { Trip, Visibility } from './types'

/** Who can see a trip, in the owner's words (SPEC §8). */
export const VISIBILITY: Record<Visibility, { label: string; icon: typeof Lock; help: string }> = {
  private: { label: 'Private', icon: Lock, help: 'Only you can see this trip.' },
  link: {
    label: 'Anyone with the link',
    icon: Link2,
    help: 'Not listed anywhere. The link carries a secret key, so only people you send it to can open it.',
  },
  public: {
    label: 'Public',
    icon: Globe,
    help: 'Anyone can open it, and search engines may list it.',
  },
}

/** The trip's share URL. Link trips carry their secret key (ADR-13). */
export function shareUrl(
  trip: Pick<Trip, 'slug' | 'visibility' | 'share_token'>,
  username: string,
) {
  const path = `/u/${encodeURIComponent(username)}/${trip.slug}`
  const key = trip.visibility === 'link' ? `?k=${trip.share_token}` : ''
  return `${window.location.origin}${path}${key}`
}

/** Privacy-zone choices (metres hidden at each end of the route). */
export const PRIVACY_ZONES = [0, 100, 300, 500, 1000, 2000]
