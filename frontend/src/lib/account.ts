/**
 * Account self-service on top of allauth's headless API (ADR-37): password reset, email
 * verification, password change, plus deleting the account through our own API.
 */
import { ApiError, request } from './api'

const AUTH = '/_allauth/browser/v1/auth'
const ACCOUNT = '/_allauth/browser/v1/account'

/**
 * allauth answers some successful steps with 401: the step worked, but the visitor isn't
 * logged in (for example a password reset opened on another device). Treat that as done.
 */
async function doneEvenIf401(promise: Promise<unknown>): Promise<{ loggedIn: boolean }> {
  try {
    await promise
    return { loggedIn: true }
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return { loggedIn: false }
    throw e
  }
}

const json = (body: unknown) => JSON.stringify(body)

export function requestPasswordReset(email: string) {
  return request(`${AUTH}/password/request`, { method: 'POST', body: json({ email }) })
}

/** Throws ApiError (400) when the link is expired, already used or made up. */
export function checkResetKey(key: string) {
  return request(`${AUTH}/password/reset`, { headers: { 'X-Password-Reset-Key': key } })
}

export function resetPassword(key: string, password: string) {
  return doneEvenIf401(
    request(`${AUTH}/password/reset`, { method: 'POST', body: json({ key, password }) }),
  )
}

/** The address a verification link is for; throws ApiError (400) for a bad link. */
export async function checkEmailKey(key: string): Promise<string> {
  const res = await request<{ data: { email: string } }>(`${AUTH}/email/verify`, {
    headers: { 'X-Email-Verification-Key': key },
  })
  return res.data.email
}

export function verifyEmail(key: string) {
  return doneEvenIf401(request(`${AUTH}/email/verify`, { method: 'POST', body: json({ key }) }))
}

export interface EmailAddress {
  email: string
  verified: boolean
  primary: boolean
}

export async function emailAddresses(): Promise<EmailAddress[]> {
  return (await request<{ data: EmailAddress[] }>(`${ACCOUNT}/email`)).data
}

/**
 * Send the verification email again. 'cooldown' means one went out a few minutes ago and
 * allauth won't send another yet.
 */
export async function resendVerification(email: string): Promise<'sent' | 'cooldown'> {
  try {
    await request(`${ACCOUNT}/email`, { method: 'PUT', body: json({ email }) })
    return 'sent'
  } catch (e) {
    if (e instanceof ApiError && (e.status === 403 || e.status === 429)) return 'cooldown'
    throw e
  }
}

export function changePassword(current_password: string, new_password: string) {
  return request(`${ACCOUNT}/password/change`, {
    method: 'POST',
    body: json({ current_password, new_password }),
  })
}

export function deleteAccount(password: string) {
  return request<void>('/api/me', { method: 'DELETE', body: json({ password }) })
}
