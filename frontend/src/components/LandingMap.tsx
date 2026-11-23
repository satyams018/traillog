import sample from '../assets/sample-trek.json'
import { DEFAULT_STYLE } from '../lib/mapStyles'
import type { TrackData } from '../lib/types'
import StatsStrip from './StatsStrip'
import TripMap from './TripMap'

// A real trip (samples/demo-trek.gpx, exported by samples/make_landing_track.py), so the
// hero shows exactly what a finished trip looks like. Loaded lazily with the map itself.
const SAMPLE_TRACK = sample as unknown as TrackData
const noop = () => {}

/** The landing page's live 3D map of the sample trip, with its numbers in a corner. */
export default function LandingMap({ wide }: { wide: boolean }) {
  return (
    <>
      <TripMap
        showcase
        track={SAMPLE_TRACK}
        styleId={DEFAULT_STYLE}
        hoverIndex={null}
        onHoverIndex={noop}
        inset={wide ? { left: 520, bottom: 60 } : {}}
      />
      <div className="map-panel absolute right-4 bottom-9 hidden rounded-2xl px-5 py-3.5 md:block">
        <p className="text-sm font-semibold">Example trip: the Hampta Pass trek, Himachal</p>
        <div className="mt-1.5">
          <StatsStrip stats={sample.stats} variant="lead" />
        </div>
      </div>
    </>
  )
}
