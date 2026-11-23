/**
 * Photo uploads go straight from the browser to storage (ADR-4): ask the API for presigned
 * PUT URLs, PUT each file with progress, then tell the API it's done so processing starts.
 */
import { ApiError, api } from './api'
import type { PresignedUpload } from './types'

export const MAX_PHOTO_BYTES = 25 * 1024 * 1024
const PRESIGN_BATCH = 50 // the API's per-call limit
const PARALLEL_PUTS = 3 // enough to fill a phone uplink without starving the UI

export type UploadState =
  | { kind: 'queued' }
  | { kind: 'uploading'; progress: number }
  | { kind: 'done' }
  | { kind: 'error'; message: string }

/** Browsers often report HEIC as '' (everything except Safari), so fall back to the name. */
export function photoContentType(file: Pick<File, 'name' | 'type'>): string | null {
  const type = file.type.toLowerCase()
  if (type === 'image/jpeg' || type === 'image/heic' || type === 'image/heif') return type
  const ext = file.name.toLowerCase().split('.').pop()
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'heic') return 'image/heic'
  if (ext === 'heif') return 'image/heif'
  return null
}

/** Reason a file can't be uploaded, or null if it's fine. */
export function rejectReason(file: Pick<File, 'name' | 'type' | 'size'>): string | null {
  if (!photoContentType(file)) return 'Only JPEG and HEIC photos can be uploaded.'
  if (file.size > MAX_PHOTO_BYTES) return 'Photos must be 25 MB or smaller.'
  if (file.size === 0) return 'This file is empty.'
  return null
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function put(
  url: string,
  file: File,
  headers: Record<string, string>,
  onProgress: (p: number) => void,
) {
  return new Promise<void>((resolve, reject) => {
    // XHR rather than fetch: fetch still has no upload progress events.
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v)
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total)
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`HTTP ${xhr.status}`))
    xhr.onerror = () => reject(new Error('network'))
    xhr.send(file)
  })
}

/** Run `fn` over items with at most `limit` in flight. */
async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++])
  })
  await Promise.all(workers)
}

/**
 * Upload files (already filtered with rejectReason). `onState(index, state)` reports each
 * file's progress. Throws ApiError if the API refuses a whole batch (e.g. quota_exceeded).
 */
export async function uploadPhotos(
  tripId: string,
  files: File[],
  onState: (index: number, state: UploadState) => void,
) {
  const indexed = files.map((file, index) => ({ file, index }))
  for (const batch of chunk(indexed, PRESIGN_BATCH)) {
    const signed = await api.post<PresignedUpload[]>(
      `/api/trips/${tripId}/photos/presign`,
      batch.map(({ file }) => ({
        filename: file.name,
        content_type: photoContentType(file),
        bytes: file.size,
      })),
    )
    const jobs = batch.map((item, i) => ({ ...item, signed: signed[i] }))
    await pool(jobs, PARALLEL_PUTS, async ({ file, index, signed: s }) => {
      onState(index, { kind: 'uploading', progress: 0 })
      try {
        await put(s.put_url, file, s.headers, (p) =>
          onState(index, { kind: 'uploading', progress: p }),
        )
        await api.post(`/api/photos/${s.photo_id}/complete`)
        onState(index, { kind: 'done' })
      } catch (err) {
        const message =
          err instanceof ApiError ? err.message : 'Upload failed. Check your connection and retry.'
        onState(index, { kind: 'error', message })
      }
    })
  }
}
