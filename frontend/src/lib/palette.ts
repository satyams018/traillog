/**
 * Palette values for code that can't read CSS variables (MapLibre layers, the uPlot canvas,
 * inline SVG). Keep in sync with the @theme tokens in index.css.
 */
export const PALETTE = {
  paper: '#F4F6F9',
  ink: '#131C2E',
  muted: '#556074',
  line: '#DCE2EB',
  brand: '#2449C8', // atlas blue: actions, route start, chart
  route: '#E33A6E', // highlighter: the route itself and your place on it
  white: '#FFFFFF',
} as const

/** `rgba()` of a palette hex, for canvas gradients. */
export function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`
}
