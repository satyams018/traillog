import { Clock } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { formatOffset } from '../lib/format'

const RANGE_S = 3 * 3600

interface Props {
  value: number
  saving: boolean
  onChange: (seconds: number) => void
  /** How many photos were placed by time (the ones this control moves). */
  timeMatched: number
}

/**
 * Fix a camera clock that was wrong. Photos without GPS are placed by their time, so a
 * camera running 10 minutes slow puts every photo 10 minutes back along the route.
 * Saves when the slider is released; the server re-matches in the same request.
 */
export default function CameraOffset({ value, saving, onChange, timeMatched }: Props) {
  // The parent remounts this with key={value}, so a saved offset resets the draft.
  const [draft, setDraft] = useState(value)
  const keyTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(keyTimer.current), [])

  const commit = (s: number) => {
    const clamped = Math.max(-48 * 3600, Math.min(48 * 3600, s))
    setDraft(clamped)
    if (clamped !== value) onChange(clamped)
  }

  return (
    <div className="rounded-2xl border border-line bg-card p-4">
      <div className="flex items-center gap-2">
        <Clock className="h-4 w-4 text-brand" aria-hidden />
        <label htmlFor="camera-offset" className="font-semibold">
          Camera clock
        </label>
        <span className="ml-auto text-sm font-semibold text-brand tabular-nums" aria-live="polite">
          {saving ? 'Moving photos…' : formatOffset(draft)}
        </span>
      </div>
      <p className="mt-1 text-sm text-muted">
        {timeMatched
          ? `${timeMatched === 1 ? '1 photo was' : `${timeMatched} photos were`} placed by the time on your camera. If ${timeMatched === 1 ? 'it sits' : 'they sit'} in the wrong spot, your camera clock was off: slide to fix it.`
          : 'Photos without GPS are placed by the time they were taken. If your camera clock was wrong, correct it here.'}
      </p>
      <input
        id="camera-offset"
        type="range"
        min={-RANGE_S}
        max={RANGE_S}
        step={60}
        value={Math.max(-RANGE_S, Math.min(RANGE_S, draft))}
        onChange={(e) => setDraft(Number(e.target.value))}
        onPointerUp={() => commit(draft)}
        onKeyUp={() => {
          // Arrow keys step one minute at a time: save once the user pauses.
          window.clearTimeout(keyTimer.current)
          keyTimer.current = window.setTimeout(() => commit(draft), 600)
        }}
        className="mt-3 w-full accent-brand"
        aria-valuetext={formatOffset(draft)}
      />
      <div className="mt-2 flex flex-wrap gap-2 text-sm">
        {[
          ['−1 h', -3600],
          ['−1 min', -60],
          ['+1 min', 60],
          ['+1 h', 3600],
        ].map(([label, d]) => (
          <button
            key={label}
            type="button"
            onClick={() => commit(draft + (d as number))}
            className="rounded-full border border-line px-3 py-1 font-semibold text-ink hover:border-brand/40"
          >
            {label}
          </button>
        ))}
        {draft !== 0 && (
          <button
            type="button"
            onClick={() => commit(0)}
            className="rounded-full px-3 py-1 font-semibold text-brand hover:bg-wash/60"
          >
            Reset
          </button>
        )}
      </div>
    </div>
  )
}
