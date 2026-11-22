import type { Feature, FeatureCollection } from 'geojson'
import {
  AttributionControl,
  type GeoJSONSource,
  Map as MLMap,
  type MapLayerMouseEvent,
  type MapSourceDataEvent,
  NavigationControl,
  ScaleControl,
  setWorkerUrl,
} from 'maplibre-gl'
// MapLibre builds its worker URL at runtime, which bundlers can't see. Importing the worker
// with ?worker&url makes Vite bundle it (with its shared chunk) and hand us the final URL.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { cameraBearingForRoute } from '../lib/geo'
import {
  type BaseStyleId,
  isDarkStyle,
  MAP_PITCH,
  TERRAIN_EXAGGERATION,
  TERRAIN_SOURCE,
  styleUrl,
} from '../lib/mapStyles'
import { nearestProfileIndex } from '../lib/profile'
import type { TrackData } from '../lib/types'

interface Props {
  track: TrackData
  styleId: BaseStyleId
  hoverIndex: number | null
  onHoverIndex: (i: number | null) => void
  /** Extra bottom padding (px) so the route stays clear of overlays such as the chart. */
  bottomInset?: number
}

const ROUTE_COLOR = '#F07C1E' // trail-blaze orange, same as the cards

// Production only: in dev, Vite serves MapLibre unbundled (optimizeDeps.exclude) and its
// default worker path works, while Vite's dev worker wrapper does not.
if (import.meta.env.PROD) setWorkerUrl(workerUrl)

/**
 * 3D terrain map with the route, start/end markers and a cursor that follows the
 * elevation chart. Chart -> map sync arrives via `hoverIndex`; map -> chart via `onHoverIndex`.
 */
export default function TripMap({
  track,
  styleId,
  hoverIndex,
  onHoverIndex,
  bottomInset = 0,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MLMap | null>(null)
  const [loading, setLoading] = useState(true)
  // Keep the latest values for map event handlers without re-binding them.
  const latest = useRef({ track, onHoverIndex, styleId })
  useLayoutEffect(() => {
    latest.current = { track, onHoverIndex, styleId }
  })

  // Create the map once.
  useEffect(() => {
    if (!containerRef.current) return
    const [minX, minY, maxX, maxY] = track.bbox
    const map = new MLMap({
      container: containerRef.current,
      style: styleUrl(styleId),
      center: [(minX + maxX) / 2, (minY + maxY) / 2],
      zoom: 10,
      maxPitch: 80,
      // One finger scrolls the page on phones; two fingers (or Ctrl/⌘ + scroll) move the map.
      // Without this, a large map traps the page scroll on touch screens.
      cooperativeGestures: true,
      attributionControl: false,
    })
    // Frame the route: lay its main direction across the wide map, then tilt for 3D.
    const camera = map.cameraForBounds(
      [
        [minX, minY],
        [maxX, maxY],
      ],
      {
        padding: { top: 60, bottom: 50 + bottomInset, left: 60, right: 60 },
        bearing: cameraBearingForRoute(track.geometry.coordinates),
      },
    )
    if (camera) map.jumpTo({ ...camera, pitch: MAP_PITCH })
    map.addControl(new AttributionControl({ compact: true }), 'bottom-right')
    map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right')
    map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left')
    mapRef.current = map
    // Dev-only handle for debugging and end-to-end tests; stripped from production builds.
    if (import.meta.env.DEV) (window as unknown as { __traillogMap?: MLMap }).__traillogMap = map

    // setStyle() wipes custom sources, so overlays are (re)added on every style load.
    map.on('style.load', () =>
      addOverlays(map, latest.current.track, isDarkStyle(latest.current.styleId)),
    )
    // Fit once the terrain heights are in (terrain lifts the route, so fitting earlier would
    // over-zoom). Don't wait for 'idle': with a tilted view that waits for every tile out to
    // the horizon (~20 s). Base-map tiles keep streaming in after the reveal.
    let revealed = false
    const fitAndReveal = () => {
      if (revealed) return
      revealed = true
      map.off('sourcedata', onSourceData)
      fitRouteToView(map, latest.current.track.geometry.coordinates, {
        top: 60,
        bottom: 40 + bottomInset,
        left: 60,
        right: 60,
      })
      setLoading(false)
      // Compact attribution starts expanded and re-expands whenever a new source adds credits.
      // Keep it collapsed to its (i) button until the initial load settles so it never covers
      // the chart; the credits stay one tap away, as the tile licences require.
      const collapse = () =>
        containerRef.current
          ?.querySelector('.maplibregl-ctrl-attrib')
          ?.classList.remove('maplibregl-compact-show')
      collapse()
      map.on('sourcedata', collapse)
      map.once('idle', () => map.off('sourcedata', collapse))
    }
    const onSourceData = (e: MapSourceDataEvent) => {
      if (e.sourceId === 'terrain' && map.isSourceLoaded('terrain')) fitAndReveal()
    }
    map.on('sourcedata', onSourceData)
    const safety = window.setTimeout(fitAndReveal, 6000)

    const hitLayer = 'route-hit'
    map.on('mousemove', hitLayer, (e: MapLayerMouseEvent) => {
      map.getCanvas().style.cursor = 'crosshair'
      const { profile } = latest.current.track
      latest.current.onHoverIndex(nearestProfileIndex(profile, e.lngLat.lng, e.lngLat.lat))
    })
    map.on('mouseleave', hitLayer, () => {
      map.getCanvas().style.cursor = ''
      latest.current.onHoverIndex(null)
    })

    return () => {
      window.clearTimeout(safety)
      map.remove()
      mapRef.current = null
    }
    // The map is created once per track; style changes are handled below.
  }, [track]) // eslint-disable-line react-hooks/exhaustive-deps

  // Switch base style without recreating the map (skips the style it was created with).
  const appliedStyle = useRef(styleId)
  useEffect(() => {
    const map = mapRef.current
    if (!map || appliedStyle.current === styleId) return
    appliedStyle.current = styleId
    setLoading(true)
    // diff:false forces a full reload so 'style.load' fires and overlays are re-added.
    map.setStyle(styleUrl(styleId), { diff: false })
    map.once('style.load', () => setLoading(false))
  }, [styleId])

  // Move the cursor point when the chart is hovered.
  useEffect(() => {
    const src = mapRef.current?.getSource('cursor') as GeoJSONSource | undefined
    if (!src) return
    const row = hoverIndex == null ? null : track.profile[hoverIndex]
    src.setData(
      row
        ? {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [row[3], row[4]] },
            properties: {},
          }
        : emptyCollection(),
    )
  }, [hoverIndex, track])

  return (
    <div className="relative h-full w-full bg-lichen">
      <div ref={containerRef} className="h-full w-full" aria-label="3D map of the route" />
      <div
        aria-hidden={!loading}
        className={`pointer-events-none absolute inset-0 flex items-center justify-center bg-lichen transition-opacity duration-700 ${
          loading ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <div className="absolute inset-0 animate-pulse contours-hero opacity-60" />
        <p className="map-panel relative rounded-full px-4 py-2 text-sm font-semibold text-forest">
          Loading 3D terrain…
        </p>
      </div>
    </div>
  )
}

function emptyCollection(): FeatureCollection {
  return { type: 'FeatureCollection', features: [] }
}

/**
 * Zoom/centre so the route itself (not its bounding box) fills the free part of the map.
 * Works in screen pixels: pan by the pixel offset, then zoom around the free area's centre.
 * Pixel space handles the tilted perspective correctly (lat/lng offsets don't), and a few
 * passes converge because perspective changes slightly with each correction.
 */
function fitRouteToView(
  map: MLMap,
  coords: [number, number, number][],
  pad: { top: number; bottom: number; left: number; right: number },
) {
  const canvas = map.getCanvas()
  const availW = canvas.clientWidth - pad.left - pad.right
  const availH = canvas.clientHeight - pad.top - pad.bottom
  if (availW <= 0 || availH <= 0) return
  const freeCentre: [number, number] = [pad.left + availW / 2, pad.top + availH / 2]
  const step = Math.max(1, Math.floor(coords.length / 300))

  const extents = () => {
    let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity]
    for (let i = 0; i < coords.length; i += step) {
      const p = map.project([coords[i][0], coords[i][1]])
      minX = Math.min(minX, p.x)
      maxX = Math.max(maxX, p.x)
      minY = Math.min(minY, p.y)
      maxY = Math.max(maxY, p.y)
    }
    return { minX, minY, maxX, maxY }
  }

  for (let pass = 0; pass < 3; pass++) {
    let e = extents()
    map.panBy([(e.minX + e.maxX) / 2 - freeCentre[0], (e.minY + e.maxY) / 2 - freeCentre[1]], {
      animate: false,
    })
    e = extents()
    const scale = Math.min(
      availW / Math.max(e.maxX - e.minX, 1),
      availH / Math.max(e.maxY - e.minY, 1),
    )
    map.zoomTo(Math.min(map.getZoom() + Math.log2(scale * 0.92), 16), {
      around: map.unproject(freeCentre),
      animate: false,
    })
  }
}

function hillshadePaint(dark: boolean) {
  // Dark bases need light highlights to show relief; light bases need soft shadows.
  return dark
    ? {
        'hillshade-exaggeration': 0.45,
        'hillshade-shadow-color': '#000000',
        'hillshade-highlight-color': 'rgba(244,239,230,0.35)',
        'hillshade-accent-color': '#000000',
      }
    : {
        'hillshade-exaggeration': 0.2,
        'hillshade-shadow-color': '#0b1210',
        'hillshade-highlight-color': 'rgba(255,255,255,0)',
      }
}

function addOverlays(map: MLMap, track: TrackData, darkBase: boolean) {
  if (!map.getSource('terrain')) map.addSource('terrain', TERRAIN_SOURCE)
  map.setTerrain({ source: 'terrain', exaggeration: TERRAIN_EXAGGERATION })
  if (!map.getLayer('hillshade')) {
    map.addLayer({
      id: 'hillshade',
      type: 'hillshade',
      source: 'terrain',
      paint: hillshadePaint(darkBase),
    })
  }
  map.setSky?.({ 'sky-color': '#cfe3ec', 'horizon-color': '#f6f7f2', 'fog-color': '#f6f7f2' })

  const coords = track.geometry.coordinates
  map.addSource('route', {
    type: 'geojson',
    data: { type: 'Feature', geometry: track.geometry, properties: {} },
  })
  map.addLayer({
    id: 'route-casing',
    type: 'line',
    source: 'route',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': '#ffffff', 'line-width': 8, 'line-opacity': 0.95 },
  })
  map.addLayer({
    id: 'route-line',
    type: 'line',
    source: 'route',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': ROUTE_COLOR, 'line-width': 4 },
  })
  // Wide invisible line so the route is easy to hover on touch and mouse.
  map.addLayer({
    id: 'route-hit',
    type: 'line',
    source: 'route',
    paint: { 'line-color': '#000', 'line-width': 24, 'line-opacity': 0 },
  })

  map.addSource('endpoints', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: [point(coords[0], 'start'), point(coords[coords.length - 1], 'end')],
    },
  })
  map.addLayer({
    id: 'endpoints',
    type: 'circle',
    source: 'endpoints',
    paint: {
      'circle-radius': 7,
      'circle-color': ['match', ['get', 'kind'], 'start', '#1F5C3F', '#F07C1E'],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 3,
    },
  })

  map.addSource('cursor', { type: 'geojson', data: emptyCollection() })
  map.addLayer({
    id: 'cursor',
    type: 'circle',
    source: 'cursor',
    paint: {
      'circle-radius': 8,
      'circle-color': '#ffffff',
      'circle-stroke-color': ROUTE_COLOR,
      'circle-stroke-width': 3,
    },
  })
}

function point(c: [number, number, number], kind: string): Feature {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [c[0], c[1]] },
    properties: { kind },
  }
}
