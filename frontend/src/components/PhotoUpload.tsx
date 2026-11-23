import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ImagePlus, TriangleAlert } from 'lucide-react'
import { useRef, useState } from 'react'

import { ApiError, api } from '../lib/api'
import { formatBytes } from '../lib/format'
import { rejectReason, type UploadState, uploadPhotos } from '../lib/photoUpload'
import type { Me } from '../lib/types'
import { btn } from './ui'

interface Row {
  name: string
  state: UploadState
}

/** Drop zone + per-file progress + storage usage bar (SPEC F3). */
export default function PhotoUpload({ tripId }: { tripId: string }) {
  const qc = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [rows, setRows] = useState<Row[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>('/api/me') })

  async function start(list: FileList | null) {
    if (!list?.length || busy) return
    setError('')
    const all = Array.from(list)
    const ok = all.filter((f) => !rejectReason(f))
    const initial: Row[] = all.map((f) => {
      const reason = rejectReason(f)
      return {
        name: f.name,
        state: reason ? { kind: 'error', message: reason } : { kind: 'queued' },
      }
    })
    setRows(initial)
    if (!ok.length) return
    // Map each accepted file back to its row.
    const rowIndex = all.map((f, i) => (rejectReason(f) ? -1 : i)).filter((i) => i >= 0)
    setBusy(true)
    try {
      await uploadPhotos(tripId, ok, (i, state) =>
        setRows((prev) => prev.map((r, j) => (j === rowIndex[i] ? { ...r, state } : r))),
      )
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Couldn't start the upload. Check your connection and try again.",
      )
      setRows((prev) => prev.filter((r) => r.state.kind !== 'queued'))
    } finally {
      setBusy(false)
      qc.invalidateQueries({ queryKey: ['photos', tripId] })
      qc.invalidateQueries({ queryKey: ['trip', tripId] })
      qc.invalidateQueries({ queryKey: ['me'] })
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const done = rows.filter((r) => r.state.kind === 'done').length
  const used = me.data?.storage_used_bytes ?? 0
  const quota = me.data?.storage_quota_bytes ?? 0
  const pct = quota ? Math.min(100, (used / quota) * 100) : 0

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        start(e.dataTransfer.files)
      }}
      className={`rounded-3xl border-2 border-dashed p-5 transition-colors sm:p-6 ${
        dragging ? 'border-brand bg-wash/60' : 'border-brand/25 bg-card'
      }`}
    >
      <div className="flex flex-wrap items-center gap-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-wash text-brand">
          <ImagePlus className="h-6 w-6" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-bold">Add photos from this trip</p>
          <p className="text-sm text-muted">
            JPEG or HEIC, up to 25 MB each. We keep small copies without location data. Your
            originals stay on your phone.
          </p>
        </div>
        <button className={btn.primary} onClick={() => inputRef.current?.click()} disabled={busy}>
          {busy ? 'Uploading…' : 'Choose photos'}
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/jpeg,image/heic,image/heif,.jpg,.jpeg,.heic,.heif"
          className="hidden"
          onChange={(e) => start(e.target.files)}
        />
      </div>

      {quota > 0 && (
        <div className="mt-4">
          <div className="flex justify-between text-xs font-medium text-muted">
            <span>Storage</span>
            <span className="tabular-nums">
              {formatBytes(used)} of {formatBytes(quota)} used
            </span>
          </div>
          <div
            className="mt-1 h-1.5 overflow-hidden rounded-full bg-wash"
            role="progressbar"
            aria-label="Storage used"
            aria-valuenow={Math.round(pct)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className={`h-full rounded-full ${pct > 90 ? 'bg-danger' : 'bg-brand'}`}
              style={{ width: `${Math.max(pct, used ? 1 : 0)}%` }}
            />
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-4 text-sm font-medium text-danger">
          {error}
        </p>
      )}

      {rows.length > 0 && (
        <div className="mt-4">
          <p className="text-sm font-semibold" aria-live="polite">
            {busy ? `Uploading ${done} of ${rows.length}…` : `${done} of ${rows.length} uploaded`}
          </p>
          <ul className="mt-2 max-h-48 space-y-1.5 overflow-y-auto pr-1 text-sm">
            {rows.map((r, i) => (
              <li key={i} className="flex items-center gap-3">
                <span className="min-w-0 flex-1 truncate text-muted">{r.name}</span>
                {r.state.kind === 'done' && (
                  <Check className="h-4 w-4 text-brand" aria-label="Uploaded" />
                )}
                {r.state.kind === 'error' && (
                  <span className="flex items-center gap-1 text-xs font-medium text-danger">
                    <TriangleAlert className="h-3.5 w-3.5" aria-hidden />
                    {r.state.message}
                  </span>
                )}
                {(r.state.kind === 'uploading' || r.state.kind === 'queued') && (
                  <span className="h-1.5 w-24 overflow-hidden rounded-full bg-wash">
                    <span
                      className="block h-full rounded-full bg-route transition-[width]"
                      style={{
                        width: `${r.state.kind === 'uploading' ? Math.round(r.state.progress * 100) : 0}%`,
                      }}
                    />
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
