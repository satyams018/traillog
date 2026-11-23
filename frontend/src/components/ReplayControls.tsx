import { Pause, Play, X } from 'lucide-react'

import { formatDistance } from '../lib/format'
import type { Highlight, Photo } from '../lib/types'
import type { Replay } from '../lib/useReplay'
import Polaroid from './Polaroid'
import { KIND } from './storyKinds'
import { btn } from './ui'

const SPEEDS = [1, 2, 4]

/** The call to action that starts a replay. */
export function PlayButton({ replay, className = '' }: { replay: Replay; className?: string }) {
  return (
    <button onClick={() => replay.play()} className={`${btn.primary} ${className}`}>
      <Play className="h-4 w-4 fill-current" aria-hidden />
      Play the trip
    </button>
  )
}

interface OverlayProps {
  replay: Replay
  /** Route length in metres, for the "12.4 of 28.2 km" readout. */
  distanceM?: number
  photos: Photo[]
  highlights?: Highlight[]
  timeZone?: string
  onOpenPhoto?: (p: Photo) => void
}

/**
 * Laid over the map while a replay runs: the photo or stop just passed, and a control bar
 * with play/pause, a scrubber, speed and close. Keyboard and screen-reader friendly.
 */
export function ReplayOverlay({
  replay,
  distanceM,
  photos,
  highlights = [],
  timeZone,
  onOpenPhoto,
}: OverlayProps) {
  if (!replay.active) return null
  const { playback, stopCard, photoCard } = replay
  const photo = photoCard ? photos.find((p) => p.id === photoCard.id) : null
  const stopIndex = stopCard ? highlights.findIndex((h) => h.id === stopCard.id) : -1
  const stop = stopIndex >= 0 ? highlights[stopIndex] : null

  return (
    <>
      {/* What the camera just passed. Keyed so each new one animates in. */}
      <div className="pointer-events-none absolute inset-x-3 bottom-28 flex flex-col items-center gap-3 sm:inset-x-auto sm:left-6 sm:items-start">
        {stop && (
          <div
            key={stopCard!.key}
            className="replay-card map-panel pointer-events-auto flex items-center gap-3 rounded-2xl px-4 py-3"
          >
            {(() => {
              const Icon = KIND[stop.kind].icon
              return (
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-route text-white">
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
              )
            })()}
            <span>
              <span className="block text-xs text-muted">
                Stop {stopIndex + 1} of {highlights.length}
              </span>
              <span className="block text-lg leading-tight font-extrabold">{stop.label}</span>
            </span>
          </div>
        )}
        {photo && (
          <div key={photoCard!.key} className="replay-card pointer-events-auto hidden sm:block">
            <Polaroid
              photo={photo}
              tilt={-2.5}
              size="small"
              timeZone={timeZone}
              onOpen={() => onOpenPhoto?.(photo)}
            />
          </div>
        )}
      </div>

      <div
        className="map-panel absolute inset-x-3 bottom-9 flex items-center gap-3 rounded-2xl px-3 py-2.5 sm:inset-x-auto sm:left-1/2 sm:w-[min(40rem,calc(100%-6rem))] sm:-translate-x-1/2"
        role="group"
        aria-label="Trip replay"
      >
        <button
          onClick={() => (playback.playing ? replay.pause() : replay.play())}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand text-white hover:bg-brand-dark"
          aria-label={playback.playing ? 'Pause' : 'Play'}
        >
          {playback.playing ? (
            <Pause className="h-4 w-4 fill-current" aria-hidden />
          ) : (
            <Play className="h-4 w-4 fill-current" aria-hidden />
          )}
        </button>
        <input
          type="range"
          min={0}
          max={1000}
          value={Math.round(playback.fraction * 1000)}
          onChange={(e) => replay.seek(Number(e.target.value) / 1000)}
          aria-label="Position along the route"
          aria-valuetext={
            distanceM
              ? `${formatDistance(playback.fraction * distanceM)} along the route`
              : undefined
          }
          className="min-w-0 flex-1 accent-[var(--color-route)]"
        />
        {distanceM != null && (
          <span className="hidden w-24 shrink-0 text-right text-sm font-semibold tabular-nums sm:block">
            {formatDistance(playback.fraction * distanceM)}
          </span>
        )}
        <div
          className="flex shrink-0 rounded-full bg-wash p-0.5"
          role="radiogroup"
          aria-label="Speed"
        >
          {SPEEDS.map((s) => (
            <button
              key={s}
              role="radio"
              aria-checked={replay.speed === s}
              onClick={() => replay.setSpeed(s)}
              className={`rounded-full px-2 py-1 text-xs font-bold tabular-nums ${
                replay.speed === s ? 'bg-card text-ink shadow-sm' : 'text-muted'
              }`}
            >
              {s}×
            </button>
          ))}
        </div>
        <button
          onClick={() => replay.exit()}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted hover:bg-wash hover:text-ink"
          aria-label="Close replay"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </>
  )
}
