import type { Feature, FeatureCollection, Point as GeoPoint } from 'geojson'
import {
  AttributionControl,
  type ExpressionSpecification,
  type GeoJSONSource,
  Map as MLMap,
  type MapLayerMouseEvent,
  type MapSourceDataEvent,
  NavigationControl,
  Popup,
  ScaleControl,
  setWorkerUrl,
} from 'maplibre-gl'
// MapLibre builds its worker URL at runtime, which bundlers can't see. Importing the worker
// with ?worker&url makes Vite bundle it (with its shared chunk) and hand us the final URL.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import {
  type Ref,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import {
  PHOTO_HOLD_MS,
  REPLAY_MS,
  cumulative,
  followZoom,
  lerpAngle,
  lookAhead,
  passed,
  pointAlong,
} from '../lib/flythrough'
import { bearingDeg, cameraBearingForRoute } from '../lib/geo'
import {
  type BaseStyleId,
  RELIEF_RAMP,
  hasRelief,
  isDarkStyle,
  MAP_PITCH,
  TERRAIN_EXAGGERATION,
  TERRAIN_SOURCE,
  styleFor,
} from '../lib/mapStyles'
import { nearestProfileIndex } from '../lib/profile'
import type { Photo, TrackData } from '../lib/types'
import { PALETTE } from '../lib/palette'

interface Props {
  track: TrackData
  styleId: BaseStyleId
  hoverIndex: number | null
  onHoverIndex: (i: number | null) => void
  /** Extra padding (px) so the route stays clear of panels laid over the map. */
  inset?: Inset
  /** Landing-page mode: no controls or hover, and the camera turns slowly around the route. */
  showcase?: boolean
  /** Ready photos; those with a location get a (clustered) marker. */
  photos?: Photo[]
  onPhotoClick?: (photoId: string) => void
  /** While true, the next map click calls onPlace with that position (manual placement). */
  placing?: boolean
  onPlace?: (lng: number, lat: number) => void
  /** Fly to this photo; `nonce` lets the same photo be focused twice. */
  focus?: { lng: number; lat: number; nonce: number } | null
  /** Story stops, pinned and labelled on the map. */
  stops?: MapStop[]
  /** Flythrough controls for the page (play, pause, seek, speed, exit). */
  controllerRef?: Ref<FlyController>
  /** Replay progress along the route (0..1) and play state, about 10 times a second. */
  onPlayback?: (state: PlaybackState) => void
  /** The replay just passed a photo or a stop. */
  onReach?: (item: { kind: 'photo' | 'stop'; id: string }) => void
}

export interface MapStop {
  id: string
  label: string
  lng: number
  lat: number
  /** Position along the route (0..1), for the replay; null if unknown. */
  fraction: number | null
}

export interface FlyController {
  play(): void
  pause(): void
  /** Jump the replay camera to a position along the route (0..1). */
  seek(fraction: number): void
  setSpeed(speed: number): void
  /** Leave the replay and return to the overview. */
  exit(): void
}

export interface PlaybackState {
  fraction: number
  playing: boolean
  /** Set once when the replay is left (by the viewer, or after reaching the end). */
  ended?: boolean
}

type Inset = Partial<Record<'top' | 'bottom' | 'left' | 'right', number>>

const ROUTE_COLOR = PALETTE.route // highlighter raspberry, same as the cards
const FLY_PITCH = 64
const UNTRAVELLED = 'rgba(255,255,255,0.9)'
// The route runs from atlas blue at the start to raspberry at the finish.
const IDLE_GRADIENT: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['line-progress'],
  0,
  PALETTE.brand,
  1,
  ROUTE_COLOR,
]

/** During a replay: the travelled part keeps its colours, the rest of the route is white. */
function progressGradient(fraction: number): ExpressionSpecification {
  const p = Math.min(0.9998, Math.max(0.0001, fraction))
  return [
    'interpolate',
    ['linear'],
    ['line-progress'],
    0,
    PALETTE.brand,
    p,
    ROUTE_COLOR,
    p + 0.0001,
    UNTRAVELLED,
    1,
    UNTRAVELLED,
  ]
}

// Production only: in dev, Vite serves MapLibre unbundled (optimizeDeps.exclude) and its
// default worker path works, while Vite's dev worker wrapper does not.
if (import.meta.env.PROD) setWorkerUrl(workerUrl)

/** Base padding around the route plus any panel insets. */
function pad(inset: Inset, extra = 0) {
  return {
    top: 60 + (inset.top ?? 0),
    bottom: 40 + extra + (inset.bottom ?? 0),
    left: 60 + (inset.left ?? 0),
    right: 60 + (inset.right ?? 0),
  }
}

/**
 * 3D terrain map with the route, start/end markers and a cursor that follows the
 * elevation chart. Chart -> map sync arrives via `hoverIndex`; map -> chart via `onHoverIndex`.
 */
export default function TripMap({
  track,
  styleId,
  hoverIndex,
  onHoverIndex,
  inset = {},
  showcase = false,
  photos = [],
  onPhotoClick,
  placing = false,
  onPlace,
  focus,
  stops = [],
  controllerRef,
  onPlayback,
  onReach,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MLMap | null>(null)
  const [loading, setLoading] = useState(true)
  // Round photo thumbnails drawn for the map, kept across style switches.
  const thumbCache = useRef(new Map<string, ImageData>())
  // Keep the latest values for map event handlers without re-binding them.
  const latest = useRef({
    track,
    onHoverIndex,
    styleId,
    photos,
    onPhotoClick,
    placing,
    onPlace,
    stops,
    onPlayback,
    onReach,
  })
  useLayoutEffect(() => {
    latest.current = {
      track,
      onHoverIndex,
      styleId,
      photos,
      onPhotoClick,
      placing,
      onPlace,
      stops,
      onPlayback,
      onReach,
    }
  })

  // Create the map once.
  useEffect(() => {
    if (!containerRef.current) return
    const [minX, minY, maxX, maxY] = track.bbox
    const map = new MLMap({
      container: containerRef.current,
      style: styleFor(styleId),
      center: [(minX + maxX) / 2, (minY + maxY) / 2],
      zoom: 10,
      maxPitch: 80,
      // One finger scrolls the page on phones; two fingers (or Ctrl/⌘ + scroll) move the map.
      // Without this, a large map traps the page scroll on touch screens.
      cooperativeGestures: !showcase,
      interactive: !showcase,
      attributionControl: false,
    })
    // Frame the route: lay its main direction across the wide map, then tilt for 3D.
    const camera = map.cameraForBounds(
      [
        [minX, minY],
        [maxX, maxY],
      ],
      {
        padding: pad(inset, 10),
        bearing: cameraBearingForRoute(track.geometry.coordinates),
      },
    )
    if (camera) map.jumpTo({ ...camera, pitch: MAP_PITCH })
    map.addControl(new AttributionControl({ compact: true }), 'bottom-right')
    if (!showcase) {
      map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right')
      map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left')
    }
    mapRef.current = map
    // Dev-only handle for debugging and end-to-end tests; stripped from production builds.
    if (import.meta.env.DEV) (window as unknown as { __traillogMap?: MLMap }).__traillogMap = map

    // setStyle() wipes custom sources, so overlays are (re)added on every style load.
    map.on('style.load', () => {
      addOverlays(map, latest.current.track, latest.current.styleId)
      ;(map.getSource('photos') as GeoJSONSource).setData(photoFeatures(latest.current.photos))
      ;(map.getSource('stops') as GeoJSONSource).setData(stopFeatures(latest.current.stops))
      addPhotoThumbs(map, latest.current.photos, thumbCache.current)
    })
    // Fit once the terrain heights are in (terrain lifts the route, so fitting earlier would
    // over-zoom). Don't wait for 'idle': with a tilted view that waits for every tile out to
    // the horizon (~20 s). Base-map tiles keep streaming in after the reveal.
    let revealed = false
    const fitAndReveal = () => {
      if (revealed) return
      revealed = true
      map.off('sourcedata', onSourceData)
      fitRouteToView(map, latest.current.track.geometry.coordinates, pad(inset))
      setLoading(false)
      // Showcase: the camera drifts slowly round the route; skipped when motion is reduced.
      if (showcase && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        map.easeTo({ bearing: map.getBearing() + 25, duration: 40_000, easing: (t) => t })
      }
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
      map.getCanvas().style.cursor = latest.current.placing ? 'crosshair' : ''
      latest.current.onHoverIndex(null)
    })

    // Thumbnails arrive asynchronously: hold their place so MapLibre doesn't warn meanwhile.
    map.on('styleimagemissing', (e) => {
      if (e.id.startsWith('thumb-') && !map.hasImage(e.id))
        map.addImage(e.id, new ImageData(THUMB_PX, THUMB_PX), { pixelRatio: 2 })
    })

    // Photos: click a marker to open it, click a cluster to zoom into it, hover for a preview.
    const preview = new Popup({ closeButton: false, offset: 14, className: 'photo-popup' })
    map.on('click', (e) => {
      if (latest.current.placing) {
        latest.current.onPlace?.(e.lngLat.lng, e.lngLat.lat)
        return
      }
      const [hit] = map.queryRenderedFeatures(e.point, {
        layers: ['photo-thumbs', 'photo-points', 'photo-clusters'],
      })
      if (!hit) return
      if (hit.properties.cluster) {
        const src = map.getSource('photos') as GeoJSONSource
        src.getClusterExpansionZoom(hit.properties.cluster_id).then((zoom) =>
          map.easeTo({
            center: (hit.geometry as GeoPoint).coordinates as [number, number],
            zoom: zoom + 0.5,
          }),
        )
      } else {
        preview.remove()
        latest.current.onPhotoClick?.(hit.properties.id)
      }
    })
    for (const layer of ['photo-thumbs', 'photo-points', 'photo-clusters']) {
      map.on('mouseenter', layer, () => {
        if (!latest.current.placing) map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', layer, () => {
        map.getCanvas().style.cursor = latest.current.placing ? 'crosshair' : ''
        preview.remove()
      })
    }
    const showPreview = (e: MapLayerMouseEvent) => {
      const f = e.features?.[0]
      if (!f || latest.current.placing) return
      const photo = latest.current.photos.find((p) => p.id === f.properties.id)
      if (!photo?.thumb_url) return
      const img = document.createElement('img')
      img.src = photo.thumb_url
      img.alt = ''
      img.className = 'block h-28 w-40 rounded-lg object-cover'
      preview
        .setLngLat((f.geometry as GeoPoint).coordinates as [number, number])
        .setDOMContent(img)
        .addTo(map)
    }
    map.on('mousemove', 'photo-points', showPreview)
    map.on('mousemove', 'photo-thumbs', showPreview)

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
    map.setStyle(styleFor(styleId), { diff: false })
    map.once('style.load', () => setLoading(false))
  }, [styleId])

  // Keep photo markers in sync with the photo list.
  useEffect(() => {
    const map = mapRef.current
    const src = map?.getSource('photos') as GeoJSONSource | undefined
    src?.setData(photoFeatures(photos))
    if (map && src) addPhotoThumbs(map, photos, thumbCache.current)
  }, [photos])

  // Stops change rarely; compare by content so a re-render with a new array is free.
  const stopsKey = JSON.stringify(stops)
  useEffect(() => {
    const src = mapRef.current?.getSource('stops') as GeoJSONSource | undefined
    src?.setData(stopFeatures(latest.current.stops))
  }, [stopsKey])

  // --- Flythrough (SPEC F7) -------------------------------------------------------------
  // The camera follows the route at a tilt, the travelled part lights up, and the replay
  // holds briefly on each photo. Runs in requestAnimationFrame and writes straight to the
  // map; the page hears about progress ~10×/s through onPlayback.
  const fly = useMemo(() => {
    const coords = track.geometry.coordinates
    const cum = cumulative(coords)
    const total = cum[cum.length - 1] || 1
    const zoom = followZoom(total)
    const ahead = lookAhead(total)
    const s = {
      playing: false,
      d: 0,
      speed: 1,
      last: 0,
      raf: 0,
      hold: 0,
      bearing: 0,
      reported: 0,
      saved: null as null | {
        center: [number, number]
        zoom: number
        bearing: number
        pitch: number
      },
    }

    const emit = (force = false) => {
      const now = performance.now()
      if (!force && now - s.reported < 100) return
      s.reported = now
      latest.current.onPlayback?.({ fraction: s.d / total, playing: s.playing })
    }
    const setLook = (map: MLMap, replaying: boolean) => {
      if (!map.getLayer('route-line')) return
      map.setPaintProperty(
        'route-line',
        'line-gradient',
        replaying ? progressGradient(s.d / total) : IDLE_GRADIENT,
      )
      map.setLayoutProperty('cursor', 'visibility', replaying ? 'none' : 'visible')
      const pos = pointAlong(coords, cum, s.d)
      ;(map.getSource('traveller') as GeoJSONSource | undefined)?.setData(
        replaying
          ? { type: 'Feature', geometry: { type: 'Point', coordinates: pos }, properties: {} }
          : emptyCollection(),
      )
    }
    const placeCamera = (map: MLMap, smoothing: number) => {
      const pos = pointAlong(coords, cum, s.d)
      if (s.d < total - 1) {
        const target = bearingDeg(pos, pointAlong(coords, cum, s.d + ahead))
        s.bearing = lerpAngle(s.bearing, target, smoothing)
      }
      map.jumpTo({ center: pos, bearing: s.bearing, pitch: FLY_PITCH, zoom })
    }
    const remember = (map: MLMap) => {
      if (s.saved) return
      const c = map.getCenter()
      s.saved = {
        center: [c.lng, c.lat],
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        pitch: map.getPitch(),
      }
    }
    const marks = (kind: 'photo' | 'stop') =>
      kind === 'photo'
        ? latest.current.photos
            .filter((p) => p.route_fraction != null && p.location)
            .map((p) => ({ id: p.id, fraction: p.route_fraction! }))
        : latest.current.stops
            .filter((x) => x.fraction != null)
            .map((x) => ({ id: x.id, fraction: x.fraction! }))

    const frame = (t: number) => {
      const map = mapRef.current
      if (!map || !s.playing) return
      const dt = s.last ? Math.min(t - s.last, 100) : 16
      s.last = t
      if (s.hold > 0) {
        s.hold -= dt
      } else {
        const prev = s.d / total
        s.d = Math.min(total, s.d + (dt * s.speed * total) / REPLAY_MS)
        const next = s.d / total
        for (const stop of passed(marks('stop'), prev, next))
          latest.current.onReach?.({ kind: 'stop', id: stop.id })
        const shots = passed(marks('photo'), prev, next)
        if (shots.length) {
          latest.current.onReach?.({ kind: 'photo', id: shots[shots.length - 1].id })
          s.hold = PHOTO_HOLD_MS
        }
      }
      placeCamera(map, 1 - Math.exp(-dt / 650))
      setLook(map, true)
      emit()
      if (s.d >= total) {
        s.playing = false
        emit(true)
        // Back out to the whole route once the end is reached.
        window.setTimeout(() => controller.exit(), 1200)
        return
      }
      s.raf = requestAnimationFrame(frame)
    }

    const controller = {
      play() {
        const map = mapRef.current
        if (!map || s.playing) return
        // Pressed before the map finished loading: start as soon as it has.
        if (!map.getLayer('route-line')) {
          // Our overlays are added by the first 'style.load' handler, which runs before this.
          map.once('style.load', () => controller.play())
          return
        }
        if (s.d >= total - 1) s.d = 0
        remember(map)
        s.playing = true
        s.last = 0
        s.hold = 0
        const pos = pointAlong(coords, cum, s.d)
        s.bearing = bearingDeg(pos, pointAlong(coords, cum, s.d + ahead))
        setLook(map, true)
        emit(true)
        // Swoop in from the overview, then start moving.
        map.flyTo({ center: pos, zoom, pitch: FLY_PITCH, bearing: s.bearing, duration: 1600 })
        map.once('moveend', () => {
          if (s.playing) s.raf = requestAnimationFrame(frame)
        })
      },
      pause() {
        if (!s.playing) return
        s.playing = false
        cancelAnimationFrame(s.raf)
        emit(true)
      },
      seek(fraction: number) {
        const map = mapRef.current
        if (!map) return
        s.d = Math.max(0, Math.min(1, fraction)) * total
        s.hold = 0
        remember(map)
        placeCamera(map, 1)
        setLook(map, true)
        emit(true)
      },
      setSpeed(speed: number) {
        s.speed = speed
      },
      exit() {
        const map = mapRef.current
        s.playing = false
        cancelAnimationFrame(s.raf)
        s.d = 0
        if (map) {
          setLook(map, false)
          if (s.saved) map.easeTo({ ...s.saved, duration: 1500 })
        }
        s.saved = null
        s.reported = performance.now()
        latest.current.onPlayback?.({ fraction: 0, playing: false, ended: true })
      },
      dispose() {
        s.playing = false
        cancelAnimationFrame(s.raf)
      },
    }
    return controller
  }, [track])
  useEffect(() => () => fly.dispose(), [fly])
  // Moving the map by hand pauses a replay, so people can look around.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const userMove = (e: { originalEvent?: unknown }) => {
      if (e.originalEvent) fly.pause()
    }
    const events = ['dragstart', 'zoomstart', 'rotatestart', 'pitchstart'] as const
    for (const ev of events) map.on(ev, userMove)
    return () => {
      for (const ev of events) map.off(ev, userMove)
    }
  }, [fly])
  useImperativeHandle(controllerRef, () => fly, [fly])

  useEffect(() => {
    const map = mapRef.current
    if (map) map.getCanvas().style.cursor = placing ? 'crosshair' : ''
  }, [placing])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !focus) return
    map.flyTo({ center: [focus.lng, focus.lat], zoom: Math.max(map.getZoom(), 14.5) })
  }, [focus])

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
    <div className="relative h-full w-full bg-wash">
      <div ref={containerRef} className="h-full w-full" aria-label="3D map of the route" />
      <div
        aria-hidden={!loading}
        className={`pointer-events-none absolute inset-0 flex items-center justify-center bg-wash transition-opacity duration-700 ${
          loading ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <div className="absolute inset-0 animate-pulse contours-hero opacity-60" />
        <p className="map-panel relative rounded-full px-4 py-2 text-sm font-semibold text-brand">
          Loading 3D terrain…
        </p>
      </div>
    </div>
  )
}

const THUMB_PX = 80 // drawn at 2× for sharp 40 px markers

/** A photo as a round, white-ringed thumbnail for the map (null if it can't be drawn). */
async function thumbImage(url: string): Promise<ImageData | null> {
  try {
    const img = new Image()
    img.crossOrigin = 'anonymous' // the bucket allows GET from the app's origin (ADR-28)
    img.src = url
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = THUMB_PX
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    const r = THUMB_PX / 2
    ctx.beginPath()
    ctx.arc(r, r, r - 1, 0, 2 * Math.PI)
    ctx.fillStyle = '#ffffff'
    ctx.fill()
    ctx.save()
    ctx.beginPath()
    ctx.arc(r, r, r - 7, 0, 2 * Math.PI)
    ctx.clip()
    const k = Math.max(THUMB_PX / img.width, THUMB_PX / img.height)
    const w = img.width * k
    const h = img.height * k
    ctx.drawImage(img, (THUMB_PX - w) / 2, (THUMB_PX - h) / 2, w, h)
    ctx.restore()
    return ctx.getImageData(0, 0, THUMB_PX, THUMB_PX)
  } catch {
    return null // CORS or decode failure: the plain dot stays
  }
}

/** Draw (or reuse) a thumbnail for every placed photo and register it with the map. */
function addPhotoThumbs(map: MLMap, photos: Photo[], cache: Map<string, ImageData>) {
  for (const p of photos) {
    if (!p.location || !p.thumb_url) continue
    const id = `thumb-${p.id}`
    const put = (data: ImageData) => {
      if (!map.getStyle()) return // map removed meanwhile
      if (map.hasImage(id)) map.updateImage(id, data)
      else map.addImage(id, data, { pixelRatio: 2 })
    }
    const cached = cache.get(p.id)
    if (cached) {
      put(cached)
      continue
    }
    thumbImage(p.thumb_url).then((data) => {
      if (!data) return
      cache.set(p.id, data)
      put(data)
    })
  }
}

function stopFeatures(stops: MapStop[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: stops.map((s) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
      properties: { id: s.id, label: s.label },
    })),
  }
}

function emptyCollection(): FeatureCollection {
  return { type: 'FeatureCollection', features: [] }
}

function photoFeatures(photos: Photo[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: photos
      .filter((p) => p.status === 'ready' && p.location)
      .map((p) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.location![0], p.location![1]] },
        properties: { id: p.id, hidden: !p.is_public },
      })),
  }
}

/** The base style's own label font, so cluster counts render with glyphs it really has. */
function labelFont(map: MLMap): string[] {
  const fonts: string[][] = []
  for (const layer of map.getStyle().layers) {
    const font = layer.type === 'symbol' ? layer.layout?.['text-font'] : undefined
    if (Array.isArray(font) && font.every((f) => typeof f === 'string'))
      fonts.push(font as string[])
  }
  // Prefer a bold, then a regular face; water labels often come first and are italic.
  return (
    fonts.find((f) => /bold/i.test(f[0])) ??
    fonts.find((f) => /regular/i.test(f[0])) ??
    fonts[0] ?? ['Noto Sans Regular']
  )
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

/**
 * Relief shading lit from four directions (MapLibre's multidirectional method): ridges and
 * valleys read clearly whichever way they face, unlike a single north-west light that
 * flattens slopes facing it. Dark bases get light highlights, light bases soft navy shadows.
 */
function hillshadePaint(dark: boolean) {
  const four = <T,>(v: T) => [v, v, v, v]
  return {
    'hillshade-method': 'multidirectional' as const,
    'hillshade-illumination-direction': [270, 315, 0, 45],
    'hillshade-illumination-altitude': [35, 35, 35, 35],
    'hillshade-exaggeration': dark ? 0.5 : 0.7,
    'hillshade-highlight-color': four(dark ? 'rgba(255,248,235,0.22)' : 'rgba(255,255,255,0.2)'),
    // Warm brown shadows, deepest from the west: they read as earth, not as grey haze.
    'hillshade-shadow-color': dark
      ? four('rgba(0,0,0,0.42)')
      : ['rgba(40,30,20,0.5)', 'rgba(40,30,20,0.38)', 'rgba(40,30,20,0.26)', 'rgba(40,30,20,0.38)'],
  }
}

/** First layer that should sit above the relief: water, roads, labels. */
function reliefAnchor(map: MLMap): string | undefined {
  return map
    .getStyle()
    .layers.find((l) => l.id === 'water' || l.type === 'line' || l.type === 'symbol')?.id
}

function addOverlays(map: MLMap, track: TrackData, styleId: BaseStyleId) {
  if (!map.getSource('terrain')) map.addSource('terrain', TERRAIN_SOURCE)
  map.setTerrain({ source: 'terrain', exaggeration: TERRAIN_EXAGGERATION })
  const below = reliefAnchor(map)
  // Terrain style: land tinted by height (green valleys, tan slopes, rock, snow).
  if (hasRelief(styleId) && !map.getLayer('relief')) {
    map.addLayer(
      {
        id: 'relief',
        type: 'color-relief',
        source: 'terrain',
        paint: {
          'color-relief-opacity': 0.9,
          'color-relief-color': [
            'interpolate',
            ['linear'],
            ['elevation'],
            ...RELIEF_RAMP,
          ] as ExpressionSpecification,
        },
      },
      below,
    )
  }
  // The base style paints glaciers flat white above the tint; let the relief show through.
  if (hasRelief(styleId) && map.getLayer('landcover_glacier'))
    map.setPaintProperty('landcover_glacier', 'fill-opacity', 0.55)
  if (!map.getLayer('hillshade')) {
    map.addLayer(
      {
        id: 'hillshade',
        type: 'hillshade',
        source: 'terrain',
        paint: hillshadePaint(isDarkStyle(styleId)),
      },
      below,
    )
  }
  map.setSky?.({
    'sky-color': '#d6e2f3',
    'horizon-color': PALETTE.paper,
    'fog-color': PALETTE.paper,
  })

  const coords = track.geometry.coordinates
  map.addSource('route', {
    type: 'geojson',
    lineMetrics: true, // needed for the start-to-finish colour gradient
    data: { type: 'Feature', geometry: track.geometry, properties: {} },
  })
  // A soft glow under the route so it reads on busy terrain and satellite imagery.
  map.addLayer({
    id: 'route-glow',
    type: 'line',
    source: 'route',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': ROUTE_COLOR, 'line-width': 18, 'line-blur': 12, 'line-opacity': 0.28 },
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
    paint: { 'line-width': 4.5, 'line-gradient': IDLE_GRADIENT },
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
      'circle-color': ['match', ['get', 'kind'], 'start', PALETTE.brand, PALETTE.route],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 3,
    },
  })

  // Story stops: a pin each, labelled once there's room (labels are added after photos).
  map.addSource('stops', { type: 'geojson', data: emptyCollection() })
  map.addLayer({
    id: 'stop-pins',
    type: 'circle',
    source: 'stops',
    paint: {
      'circle-radius': 7,
      'circle-color': PALETTE.ink,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 3,
    },
  })

  // Photo markers cluster when zoomed out (SPEC F6); data is set by the caller.
  map.addSource('photos', {
    type: 'geojson',
    data: emptyCollection(),
    cluster: true,
    // Small radius: photos show as thumbnails at normal zoom and only merge when truly crowded.
    clusterRadius: 22,
    clusterMaxZoom: 13,
  })
  map.addLayer({
    id: 'photo-clusters',
    type: 'circle',
    source: 'photos',
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': PALETTE.brand,
      'circle-radius': ['step', ['get', 'point_count'], 14, 10, 18, 50, 22],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 3,
    },
  })
  map.addLayer({
    id: 'photo-cluster-count',
    type: 'symbol',
    source: 'photos',
    filter: ['has', 'point_count'],
    layout: {
      'text-field': ['get', 'point_count_abbreviated'],
      'text-font': labelFont(map),
      'text-size': 13,
      'text-allow-overlap': true,
    },
    paint: { 'text-color': '#ffffff' },
  })
  map.addLayer({
    id: 'photo-points',
    type: 'circle',
    source: 'photos',
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-color': ['case', ['get', 'hidden'], PALETTE.muted, PALETTE.brand],
      'circle-radius': 8,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 3,
    },
  })
  // Each photo as a round thumbnail over its dot (the dot shows until the image is drawn).
  map.addLayer({
    id: 'photo-thumbs',
    type: 'symbol',
    source: 'photos',
    filter: ['!', ['has', 'point_count']],
    layout: {
      'icon-image': ['concat', 'thumb-', ['get', 'id']],
      'icon-size': ['interpolate', ['linear'], ['zoom'], 9, 0.75, 15, 1.1],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
    paint: { 'icon-opacity': ['case', ['get', 'hidden'], 0.5, 1] },
  })
  map.addLayer({
    id: 'stop-labels',
    type: 'symbol',
    source: 'stops',
    layout: {
      'text-field': ['get', 'label'],
      'text-font': labelFont(map),
      'text-size': 13,
      'text-anchor': 'bottom',
      'text-offset': [0, -0.9],
      'text-max-width': 12,
    },
    paint: { 'text-color': PALETTE.ink, 'text-halo-color': '#ffffff', 'text-halo-width': 2 },
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

  // The replay's traveller: a raspberry dot with a halo, moved every frame.
  map.addSource('traveller', { type: 'geojson', data: emptyCollection() })
  map.addLayer({
    id: 'traveller-halo',
    type: 'circle',
    source: 'traveller',
    paint: { 'circle-radius': 20, 'circle-color': ROUTE_COLOR, 'circle-opacity': 0.22 },
  })
  map.addLayer({
    id: 'traveller',
    type: 'circle',
    source: 'traveller',
    paint: {
      'circle-radius': 8,
      'circle-color': ROUTE_COLOR,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 4,
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
