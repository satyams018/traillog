import { Camera, Mountain, Route, Share2, TrendingUp } from 'lucide-react'
import { Link } from 'react-router'

import RoutePreview from '../components/RoutePreview'
import { btn } from '../components/ui'
import { useSession } from '../lib/auth'
import { useDocumentTitle } from '../lib/useDocumentTitle'

// A hand-drawn sample trek for the hero postcard ([lng, lat] pairs).
const SAMPLE_ROUTE: [number, number][] = [
  [77.2, 32.26],
  [77.206, 32.262],
  [77.211, 32.259],
  [77.217, 32.263],
  [77.222, 32.268],
  [77.226, 32.266],
  [77.232, 32.27],
  [77.236, 32.276],
  [77.242, 32.275],
  [77.247, 32.279],
  [77.251, 32.285],
  [77.258, 32.283],
  [77.262, 32.288],
  [77.268, 32.292],
  [77.275, 32.29],
  [77.281, 32.295],
  [77.286, 32.301],
  [77.293, 32.299],
  [77.299, 32.304],
]
const SAMPLE_ELEVATION = [
  30, 34, 33, 40, 48, 52, 61, 70, 74, 83, 90, 96, 92, 85, 78, 70, 62, 55, 50,
]

const STEPS = [
  {
    icon: Route,
    title: 'Upload your GPS track',
    body: 'Drop in a GPX file from Strava, Garmin, OsmAnd or any phone app. Distance, climb and time are worked out for you.',
    ready: true,
  },
  {
    icon: Camera,
    title: 'Add your photos',
    body: 'Photos land on the map where you took them, using their location or the time on your camera.',
    ready: false,
  },
  {
    icon: Share2,
    title: 'Share the story',
    body: 'Send one link. Friends replay the trek as a 3D flythrough, no app or account needed.',
    ready: false,
  },
]

export default function Landing() {
  useDocumentTitle(null)
  const { data: user } = useSession()

  return (
    <>
      <section className="contours-hero relative overflow-hidden border-b border-line">
        <div
          className="absolute inset-0 bg-gradient-to-r from-paper via-paper/90 to-paper/40"
          aria-hidden
        />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:py-24 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <h1 className="max-w-xl text-4xl leading-[1.08] font-extrabold tracking-tight text-ink sm:text-6xl">
              Turn your trek into a story friends can relive.
            </h1>
            <p className="mt-6 max-w-lg text-lg leading-relaxed text-moss">
              Upload your GPS track and TrailLog draws it on real 3D terrain, with the climb, the
              distance and every stop along the way.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link
                to={user ? '/trips' : '/signup'}
                className={`${btn.primary} px-6 py-3 text-base`}
              >
                <Mountain className="h-5 w-5" aria-hidden />
                {user ? 'Go to my trips' : 'Start your first trip'}
              </Link>
              <a href="#how-it-works" className={`${btn.secondary} px-5 py-3 text-base`}>
                How it works
              </a>
            </div>
          </div>

          {/* Trip "postcard": shows what a finished trip looks like. */}
          <figure className="mx-auto w-full max-w-md rotate-[1.5deg] rounded-3xl bg-card p-3 shadow-[var(--shadow-lift)]">
            <div className="contours-card relative h-56 overflow-hidden rounded-2xl bg-lichen/60">
              <RoutePreview points={SAMPLE_ROUTE} />
              <span className="absolute top-3 left-3 rounded-full bg-card/90 px-3 py-1 text-xs font-semibold text-forest shadow-sm">
                Hampta Pass trek
              </span>
            </div>
            <figcaption className="px-2 pt-4 pb-2">
              <div className="flex items-baseline justify-between">
                <span className="text-lg font-bold">Hampta Pass</span>
                <span className="text-sm text-moss">May 2026</span>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                <Stat icon={Route} value="26.4 km" label="distance" />
                <Stat icon={TrendingUp} value="1,540 m" label="climb" />
                <Stat icon={Mountain} value="4,270 m" label="highest" />
              </div>
              <svg
                viewBox="0 0 190 40"
                className="mt-4 h-10 w-full"
                aria-hidden
                preserveAspectRatio="none"
              >
                <path
                  d={`M0 40 ${SAMPLE_ELEVATION.map((v, i) => `L${i * 10.5} ${40 - v * 0.38}`).join(' ')} L190 40Z`}
                  fill="#1F5C3F"
                  fillOpacity="0.12"
                />
                <path
                  d={SAMPLE_ELEVATION.map(
                    (v, i) => `${i ? 'L' : 'M'}${i * 10.5} ${40 - v * 0.38}`,
                  ).join(' ')}
                  fill="none"
                  stroke="#1F5C3F"
                  strokeWidth="2"
                />
              </svg>
            </figcaption>
          </figure>
        </div>
      </section>

      <section id="how-it-works" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20">
        <h2 className="text-3xl font-extrabold tracking-tight">How it works</h2>
        <p className="mt-2 max-w-xl text-moss">
          Three steps from a messy GPS file to a trip worth sharing.
        </p>
        <ol className="mt-10 grid gap-5 md:grid-cols-3">
          {STEPS.map(({ icon: Icon, title, body, ready }, i) => (
            <li
              key={title}
              className="rounded-2xl border border-line bg-card p-6 shadow-[var(--shadow-soft)]"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-lichen text-forest">
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                <span className="text-sm font-semibold text-moss">Step {i + 1}</span>
                {!ready && (
                  <span className="ml-auto rounded-full bg-trail/15 px-2.5 py-0.5 text-xs font-semibold text-trail-dark">
                    Coming soon
                  </span>
                )}
              </div>
              <h3 className="mt-5 text-lg font-bold">{title}</h3>
              <p className="mt-2 leading-relaxed text-moss">{body}</p>
            </li>
          ))}
        </ol>
      </section>
    </>
  )
}

function Stat({ icon: Icon, value, label }: { icon: typeof Route; value: string; label: string }) {
  return (
    <div className="rounded-xl bg-paper px-2.5 py-2">
      <Icon className="h-4 w-4 text-trail-dark" aria-hidden />
      <div className="mt-1 font-bold tabular-nums">{value}</div>
      <div className="text-xs text-moss">{label}</div>
    </div>
  )
}
