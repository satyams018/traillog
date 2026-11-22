import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FileUp, UploadCloud } from 'lucide-react'
import { useRef, useState } from 'react'

import { ApiError, api } from '../lib/api'
import type { Trip } from '../lib/types'
import { btn } from './ui'

const MAX_MB = 20

export default function GpxUpload({ trip }: { trip: Trip }) {
  const qc = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [localError, setLocalError] = useState('')

  const mutation = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData()
      form.append('file', file)
      return api.post<Trip>(`/api/trips/${trip.id}/gpx`, form)
    },
    onSuccess: (updated) => qc.setQueryData(['trip', trip.id], updated),
  })

  function pick(file: File | undefined) {
    setLocalError('')
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.gpx')) return setLocalError('Choose a .gpx file.')
    if (file.size > MAX_MB * 1024 * 1024)
      return setLocalError(`That file is over ${MAX_MB} MB. Export a shorter track.`)
    mutation.mutate(file)
  }

  const serverError =
    mutation.error instanceof ApiError
      ? (mutation.error.fields?.file?.[0] ?? mutation.error.message)
      : mutation.error
        ? 'Upload failed. Check your connection and try again.'
        : ''

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
        pick(e.dataTransfer.files[0])
      }}
      className={`rounded-3xl border-2 border-dashed px-6 py-12 text-center transition-colors ${
        dragging ? 'border-forest bg-lichen/60' : 'border-forest/25 bg-card'
      }`}
    >
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-lichen text-forest">
        <UploadCloud className="h-7 w-7" aria-hidden />
      </span>
      <p className="mt-4 text-xl font-bold">Add your GPS track</p>
      <p className="mx-auto mt-1.5 max-w-sm text-moss">
        Drag a GPX file here, or choose one. Export it from Strava, Garmin, OsmAnd or any GPS app
        (up to {MAX_MB} MB).
      </p>
      <button
        className={`${btn.primary} mt-6`}
        onClick={() => inputRef.current?.click()}
        disabled={mutation.isPending}
      >
        <FileUp className="h-4 w-4" aria-hidden />
        {mutation.isPending ? 'Uploading…' : 'Choose GPX file'}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".gpx,application/gpx+xml"
        className="hidden"
        onChange={(e) => pick(e.target.files?.[0])}
      />
      {(localError || serverError) && (
        <p role="alert" className="mt-4 text-sm font-medium text-danger">
          {localError || serverError}
        </p>
      )}
    </div>
  )
}
