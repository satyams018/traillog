import { Play } from 'lucide-react'

import sample from '../assets/sample-trek.json'
import { DEFAULT_STYLE } from '../lib/mapStyles'
import type { TrackData } from '../lib/types'
import type { Replay } from '../lib/useReplay'
import { ReplayOverlay } from './ReplayControls'
import StatsStrip from './StatsStrip'
import TripMap from './TripMap'

// A real trip (samples/demo-trek.gpx, exported by samples/make_landing_track.py), so the
// hero shows exactly what a finished trip looks like. Loaded lazily with the map itself.
const SAMPLE_TRACK = sample as unknown as TrackData
const noop = () => {}

/**
 * The landing page's live 3D map of the sample trip, with its numbers in a corner and a
 * replay visitors can watch: the product's main feature, shown rather than described.
 */
export default function LandingMap({ wide, replay }: { wide: boolean; replay: Replay }) {
  return (
    <>
      <TripMap
        showcase
        track={SAMPLE_TRACK}
        styleId={DEFAULT_STYLE}
        hoverIndex={null}
        onHoverIndex={noop}
        inset={wide ? { left: 520, bottom: 60 } : {}}
        controllerRef={replay.controllerRef}
        onPlayback={replay.onPlayback}
        onReach={replay.onReach}
      />
      <div className="relative z-10">
        <ReplayOverlay replay={replay} distanceM={sample.stats.distance_m} photos={[]} />
      </div>
      {!replay.active && (
        <div className="map-panel absolute right-4 bottom-9 left-4 z-10 rounded-2xl px-5 py-3.5 md:left-auto">
          <p className="text-sm font-semibold">Example trip: the Hampta Pass trek, Himachal</p>
          <div className="mt-1.5 hidden md:block">
            <StatsStrip stats={sample.stats} variant="lead" />
          </div>
          <button
            onClick={() => replay.play()}
            className="mt-3 inline-flex items-center gap-2 text-sm font-bold text-brand hover:underline"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand text-white">
              <Play className="h-3.5 w-3.5 fill-current" aria-hidden />
            </span>
            Watch the replay
          </button>
        </div>
      )}
    </>
  )
}
