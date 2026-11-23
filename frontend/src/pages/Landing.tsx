import { Camera, Flag, MapPinned, Route } from 'lucide-react'
import { Suspense, lazy } from 'react'
import { Link } from 'react-router'

import { btn } from '../components/ui'
import { useSession } from '../lib/auth'
import { useDocumentTitle } from '../lib/useDocumentTitle'
import { useMediaQuery } from '../lib/useMediaQuery'
import { useReplay } from '../lib/useReplay'

// MapLibre and the sample track are large, so they load in their own chunk after the page
// text (SPEC §11).
const LandingMap = lazy(() => import('../components/LandingMap'))

const STEPS = [
  {
    icon: Route,
    title: 'Upload your GPS track',
    body: 'Drop in a GPX file from your phone, watch or GPS app: Strava, Garmin, Komoot, OsmAnd and more. Distance, time and elevation are worked out for you.',
  },
  {
    icon: Camera,
    title: 'Add your photos',
    body: 'Each photo lands on the map where you took it, using its location or the time on your camera. Group them into stops with a few words.',
  },
  {
    icon: Flag,
    title: 'Share the story',
    body: 'Send one link. Friends open your route on a 3D map with your photos and stops, no app or account needed. Keep it private, share it by link, or make it public; the start and end of the route stay hidden.',
  },
]

export default function Landing() {
  useDocumentTitle(null)
  const { data: user } = useSession()
  const wide = useMediaQuery('(min-width: 768px)')
  const replay = useReplay()

  return (
    <>
      {/* The hero is the product: a live 3D map of a real trip, with the pitch beside it. */}
      <section className="relative flex flex-col md:block md:h-[calc(100svh-4rem)] md:max-h-[880px] md:min-h-[600px]">
        <div className="relative order-2 h-[52svh] min-h-[340px] md:absolute md:inset-0 md:h-auto">
          <Suspense fallback={<div className="h-full w-full animate-pulse bg-wash" />}>
            <LandingMap wide={wide} replay={replay} />
          </Suspense>
          {/* Fades the map into the page behind the text so the headline stays readable. */}
          <div
            className={`pointer-events-none absolute inset-y-0 left-0 hidden w-[44rem] bg-gradient-to-r from-paper via-paper/90 to-transparent transition-opacity duration-700 md:block ${
              replay.active ? 'opacity-0' : ''
            }`}
            aria-hidden
          />
        </div>

        <div
          className={`relative order-1 mx-auto flex h-full w-full max-w-6xl items-center px-4 py-10 transition-opacity duration-700 md:pointer-events-none md:py-0 ${
            replay.active ? 'md:opacity-0' : ''
          }`}
        >
          {/* Only the text takes clicks, so the map's own buttons stay reachable. */}
          <div className={`max-w-xl ${replay.active ? '' : 'md:pointer-events-auto'}`}>
            <h1 className="text-[2.6rem] leading-[1.02] font-extrabold tracking-[-0.035em] text-ink sm:text-6xl lg:text-7xl">
              Turn any trip into a story friends can relive.
            </h1>
            <p className="mt-6 max-w-md text-lg leading-relaxed text-ink/75">
              City walks, road trips, treks or a week by the sea. Upload your GPS track and photos,
              and TrailLog draws the route on a 3D map and pins every photo where you took it.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link
                to={user ? '/trips' : '/signup'}
                className={`${btn.primary} px-6 py-3 text-base shadow-[var(--shadow-soft)]`}
              >
                <MapPinned className="h-5 w-5" aria-hidden />
                {user ? 'Go to my trips' : 'Start your first trip'}
              </Link>
              <a href="#how-it-works" className={`${btn.secondary} px-5 py-3 text-base`}>
                How it works
              </a>
            </div>
          </div>
        </div>
      </section>

      <section id="how-it-works" className="border-t border-line bg-card">
        <div className="mx-auto max-w-6xl scroll-mt-20 px-4 pt-20 pb-24">
          <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">How it works</h2>
          <p className="mt-2 max-w-xl text-muted">
            From a GPS file on your phone to a trip worth sharing.
          </p>
          <ol className="mt-12 grid gap-10 md:grid-cols-3 md:gap-8">
            {STEPS.map(({ icon: Icon, title, body }, i) => (
              <li key={title} className="relative flex gap-5 md:block">
                {/* Route to the next step: down the side on phones, across on wider screens. */}
                {i < STEPS.length - 1 && (
                  <span
                    className="absolute top-12 -bottom-9 left-[21px] border-l-2 border-dashed border-route/70 md:top-[21px] md:-right-7 md:bottom-auto md:left-14 md:border-t-2 md:border-l-0"
                    aria-hidden
                  />
                )}
                <span
                  className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-[3px] border-white text-white shadow-[var(--shadow-soft)] ${
                    i === STEPS.length - 1 ? 'bg-route' : 'bg-brand'
                  }`}
                >
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                <div className="md:mt-5 md:pr-6">
                  <h3 className="flex flex-wrap items-center gap-2 text-lg font-bold">
                    <span className="text-muted tabular-nums">{i + 1}.</span>
                    {title}
                  </h3>
                  <p className="mt-2 max-w-sm leading-relaxed text-muted">{body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </>
  )
}
