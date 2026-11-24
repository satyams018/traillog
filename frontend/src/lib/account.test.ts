import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { deleteAccount, resendVerification, resetPassword, verifyEmail } from './account'

const fetchMock = vi.fn()

function reply(status: number, body: unknown = {}) {
  fetchMock.mockResolvedValueOnce(
    new Response(status === 204 ? null : JSON.stringify(body), { status }),
  )
}

beforeEach(() => {
  document.cookie = 'csrftoken=test-token'
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  fetchMock.mockReset()
  vi.unstubAllGlobals()
})

describe('steps allauth answers with 401 when the visitor is logged out', () => {
  it('treat 401 as done but not logged in', async () => {
    reply(401, { flows: [] })
    await expect(resetPassword('k', 'new-pass')).resolves.toEqual({ loggedIn: false })
    reply(401, { flows: [] })
    await expect(verifyEmail('k')).resolves.toEqual({ loggedIn: false })
  })

  it('report logged in on 200', async () => {
    reply(200, { data: {} })
    await expect(resetPassword('k', 'new-pass')).resolves.toEqual({ loggedIn: true })
  })

  it('still throw real errors, such as an expired key', async () => {
    reply(400, { errors: [{ code: 'invalid_password_reset', message: 'Expired.', param: 'key' }] })
    await expect(resetPassword('k', 'new-pass')).rejects.toMatchObject({
      status: 400,
      fields: { key: ['Expired.'] },
    })
  })
})

it('maps a refused resend to the cooldown state', async () => {
  reply(403)
  await expect(resendVerification('a@example.com')).resolves.toBe('cooldown')
  reply(200, { data: [] })
  await expect(resendVerification('a@example.com')).resolves.toBe('sent')
})

it('sends the password with the delete request, with the CSRF header', async () => {
  reply(204)
  await deleteAccount('secret-pass')
  const [url, init] = fetchMock.mock.calls[0]
  expect(url).toBe('/api/me')
  expect(init.method).toBe('DELETE')
  expect(JSON.parse(init.body)).toEqual({ password: 'secret-pass' })
  expect(new Headers(init.headers).get('X-CSRFToken')).toBe('test-token')
})
