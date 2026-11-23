import type { StyleSpecification } from 'maplibre-gl'

export type BaseStyleId = 'terrain' | 'satellite' | 'topo' | 'dark'

const KEY = import.meta.env.VITE_MAPTILER_KEY as string | undefined
const OFM = 'https://tiles.openfreemap.org/styles'

function maptiler(name: string) {
  return `https://api.maptiler.com/maps/${name}/style.json?key=${KEY}`
}

/**
 * Keyless satellite: EOX's Sentinel-2 cloudless mosaic (10 m, cloud-free). Free for
 * non-commercial use with this credit; a commercial deployment needs an EOX licence or the
 * MapTiler key below (ADR-36). Labels come from our own layers, so only glyphs are needed.
 */
const SENTINEL_STYLE: StyleSpecification = {
  version: 8,
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: {
    sentinel: {
      type: 'raster',
      tiles: [
        'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg',
      ],
      tileSize: 256,
      maxzoom: 15,
      attribution:
        '<a href="https://s2maps.eu" target="_blank" rel="noreferrer">Sentinel-2 cloudless</a> by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2024)',
    },
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#1b2a2f' } },
    {
      id: 'sentinel',
      type: 'raster',
      source: 'sentinel',
      // A touch more contrast and less saturation reads as "real" rather than garish.
      paint: { 'raster-contrast': 0.12, 'raster-saturation': -0.08, 'raster-fade-duration': 200 },
    },
  ],
}

/**
 * Base map styles (ADR-17, ADR-36). All work without a key:
 * - Terrain: a quiet light base with the land tinted by height and multi-light shading.
 * - Satellite: Sentinel-2 cloudless (or MapTiler's sharper hybrid when a key is set).
 * - Topo: the full OpenStreetMap style with paths, huts and names.
 * - Dark: for night viewing; the route glows on it.
 */
export const BASE_STYLES: {
  id: BaseStyleId
  label: string
  style: string | StyleSpecification
}[] = [
  { id: 'terrain', label: 'Terrain', style: `${OFM}/positron` },
  { id: 'satellite', label: 'Satellite', style: KEY ? maptiler('hybrid') : SENTINEL_STYLE },
  { id: 'topo', label: 'Topo', style: KEY ? maptiler('outdoor-v2') : `${OFM}/liberty` },
  { id: 'dark', label: 'Dark', style: `${OFM}/dark` },
]

/** Styles with dark imagery, which need light hillshade highlights to show relief. */
export function isDarkStyle(id: BaseStyleId): boolean {
  return id === 'dark' || id === 'satellite'
}

/** Only the Terrain style gets the height tint; the others have their own colours. */
export function hasRelief(id: BaseStyleId): boolean {
  return id === 'terrain'
}

export const DEFAULT_STYLE: BaseStyleId = 'terrain'

export function styleFor(id: BaseStyleId): string | StyleSpecification {
  return (BASE_STYLES.find((s) => s.id === id) ?? BASE_STYLES[0]).style
}

/** Free open elevation tiles (AWS Terrain Tiles, Terrarium encoding), no key needed (ADR-11). */
export const TERRAIN_SOURCE = {
  type: 'raster-dem' as const,
  tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
  encoding: 'terrarium' as const,
  tileSize: 256,
  maxzoom: 15,
  attribution:
    '<a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md">Terrain: Mapzen, AWS</a>',
}

/**
 * Hypsometric tint for the Terrain style (metres → colour): green lowlands, olive and tan
 * foothills, warm brown slopes, grey rock, then snow. Tuned by eye on a Himalayan trek, where a
 * paler ramp washed everything above 3,000 m out to white.
 */
const RELIEF_STOPS: [metres: number, colour: string][] = [
  [-100, '#cfe2d6'],
  [0, '#c6dfbd'],
  [500, '#b5d49f'],
  [1200, '#cbd594'],
  [2000, '#e0cb8c'],
  [2800, '#cfad84'],
  [3600, '#b89f8f'],
  [4400, '#d6cec7'],
  [5200, '#f2f0ec'],
  [6500, '#ffffff'],
]
export const RELIEF_RAMP = RELIEF_STOPS.flat()

export const TERRAIN_EXAGGERATION = 1.4
export const MAP_PITCH = 50
