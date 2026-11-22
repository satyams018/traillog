export type BaseStyleId = 'satellite' | 'topo' | 'dark' | 'light'

const KEY = import.meta.env.VITE_MAPTILER_KEY as string | undefined
const OFM = 'https://tiles.openfreemap.org/styles'

function maptiler(name: string) {
  return `https://api.maptiler.com/maps/${name}/style.json?key=${KEY}`
}

/**
 * Base map styles. Without a MapTiler key the app still has three keyless OpenFreeMap styles
 * (topo suits the light, outdoorsy design); a key adds satellite imagery (ADR-17).
 */
export const BASE_STYLES: { id: BaseStyleId; label: string; url: string }[] = [
  ...(KEY ? [{ id: 'satellite' as const, label: 'Satellite', url: maptiler('hybrid') }] : []),
  { id: 'topo', label: 'Topo', url: KEY ? maptiler('outdoor-v2') : `${OFM}/liberty` },
  { id: 'light', label: 'Light', url: `${OFM}/positron` },
  { id: 'dark', label: 'Dark', url: `${OFM}/dark` },
]

/** Styles with dark imagery, which need light hillshade highlights to show relief. */
export function isDarkStyle(id: BaseStyleId): boolean {
  return id === 'dark' || id === 'satellite'
}

export const DEFAULT_STYLE: BaseStyleId = KEY ? 'satellite' : 'topo'

export function styleUrl(id: BaseStyleId): string {
  return (BASE_STYLES.find((s) => s.id === id) ?? BASE_STYLES[0]).url
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

export const TERRAIN_EXAGGERATION = 1.3
export const MAP_PITCH = 50
