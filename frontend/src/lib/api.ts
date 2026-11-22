/** Small fetch wrapper: same-origin session cookies + Django CSRF header (ADR-3). */

export class ApiError extends Error {
  status: number
  code: string
  fields?: Record<string, string[]>

  constructor(status: number, code: string, message: string, fields?: Record<string, string[]>) {
    super(message)
    this.status = status
    this.code = code
    this.fields = fields
  }
}

function getCookie(name: string): string | undefined {
  return document.cookie
    .split('; ')
    .find((c) => c.startsWith(`${name}=`))
    ?.split('=')[1]
}

let csrfReady: Promise<void> | null = null
async function ensureCsrf() {
  if (getCookie('csrftoken')) return
  csrfReady ??= fetch('/api/csrf', { credentials: 'same-origin' }).then(() => undefined)
  await csrfReady
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase()
  const headers = new Headers(init.headers)
  if (!['GET', 'HEAD'].includes(method)) {
    await ensureCsrf()
    headers.set('X-CSRFToken', getCookie('csrftoken') ?? '')
  }
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const res = await fetch(path, { ...init, method, headers, credentials: 'same-origin' })
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw toApiError(res.status, data)
  return data as T
}

/** Normalise both our DRF error shape and allauth's `{errors: [...]}` shape. */
function toApiError(status: number, data: any): ApiError {
  if (data?.error) {
    return new ApiError(status, data.error.code, data.error.message, data.error.fields)
  }
  if (Array.isArray(data?.errors) && data.errors.length) {
    const fields: Record<string, string[]> = {}
    for (const e of data.errors) {
      if (e.param) (fields[e.param] ??= []).push(e.message)
    }
    return new ApiError(status, data.errors[0].code ?? 'error', data.errors[0].message, fields)
  }
  return new ApiError(status, 'error', `Request failed (${status})`)
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'POST',
      body: body instanceof FormData ? body : JSON.stringify(body ?? {}),
    }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: (path: string) => request<void>(path, { method: 'DELETE' }),
}
