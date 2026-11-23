import { describe, expect, it } from 'vitest'

import { shareUrl } from './visibility'

describe('shareUrl', () => {
  const trip = { slug: 'goa-december', share_token: 'abc123', visibility: 'public' as const }

  it('is the plain path for public trips', () => {
    expect(shareUrl(trip, 'asha')).toBe(`${window.location.origin}/u/asha/goa-december`)
  })

  it('carries the secret key for link trips', () => {
    expect(shareUrl({ ...trip, visibility: 'link' }, 'asha')).toMatch(
      /\/u\/asha\/goa-december\?k=abc123$/,
    )
  })
})
