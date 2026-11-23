import { useCallback, useEffect, useRef, useState } from 'react'

import type { FlyController, PlaybackState } from '../components/TripMap'

export type ReachedItem = { kind: 'photo' | 'stop'; id: string; key: number }

const PHOTO_CARD_MS = 2_600
const STOP_CARD_MS = 4_000

/**
 * State for a trip replay: the map's controller, progress, and the photo or stop card that
 * pops up as the camera passes it. Shared by the trip, share and landing pages.
 */
export function useReplay() {
  const controllerRef = useRef<FlyController>(null)
  const [playback, setPlayback] = useState<PlaybackState>({ fraction: 0, playing: false })
  const [active, setActive] = useState(false)
  const [speed, setSpeedState] = useState(1)
  // A stop and its first photo are often reached together, so each has its own card.
  const [stopCard, setStopCard] = useState<ReachedItem | null>(null)
  const [photoCard, setPhotoCard] = useState<ReachedItem | null>(null)

  const onPlayback = useCallback((s: PlaybackState) => {
    setPlayback(s)
    if (s.ended) {
      setActive(false)
      setStopCard(null)
      setPhotoCard(null)
    }
  }, [])
  const onReach = useCallback((item: { kind: 'photo' | 'stop'; id: string }) => {
    const card = { ...item, key: Date.now() }
    if (item.kind === 'stop') setStopCard(card)
    else setPhotoCard(card)
  }, [])

  // Each card shows for a moment, then makes way for the next one.
  useEffect(() => {
    if (!stopCard) return
    const t = window.setTimeout(() => setStopCard(null), STOP_CARD_MS)
    return () => window.clearTimeout(t)
  }, [stopCard])
  useEffect(() => {
    if (!photoCard) return
    const t = window.setTimeout(() => setPhotoCard(null), PHOTO_CARD_MS)
    return () => window.clearTimeout(t)
  }, [photoCard])

  return {
    controllerRef,
    playback,
    active,
    speed,
    stopCard,
    photoCard,
    onPlayback,
    onReach,
    play() {
      setActive(true)
      controllerRef.current?.play()
    },
    pause: () => controllerRef.current?.pause(),
    seek: (f: number) => controllerRef.current?.seek(f),
    setSpeed(s: number) {
      setSpeedState(s)
      controllerRef.current?.setSpeed(s)
    },
    exit: () => controllerRef.current?.exit(),
  }
}

export type Replay = ReturnType<typeof useReplay>
