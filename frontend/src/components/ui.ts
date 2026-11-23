/** Shared class names so buttons and fields look the same everywhere. */
const base =
  'inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60'

export const btn = {
  primary: `${base} bg-brand px-5 py-2.5 text-white hover:bg-brand-dark`,
  secondary: `${base} border border-line bg-card px-4 py-2 text-ink hover:border-brand/40 hover:bg-wash/40`,
  ghost: `${base} px-3 py-2 text-brand hover:bg-wash/60`,
  danger: `${base} bg-danger px-4 py-2 text-white hover:brightness-110`,
}

export const field =
  'w-full rounded-xl border border-line bg-card px-3.5 py-2.5 text-ink placeholder:text-muted/70 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/10'
