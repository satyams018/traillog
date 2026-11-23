import { type CSSProperties, useEffect, useRef, useState } from 'react'

import { formatPhotoTime } from '../lib/format'
import type { Photo } from '../lib/types'

interface Props {
  photo: Photo
  /** Degrees; varied per photo so a stop's photos look laid down by hand. */
  tilt: number
  size: 'large' | 'small'
  timeZone?: string
  onOpen: () => void
}

/** A story photo as an instant print: white frame, wide bottom border, handwritten caption. */
export default function Polaroid({ photo, tilt, size, timeZone, onOpen }: Props) {
  const ref = useRef<HTMLButtonElement>(null)
  const [developed, setDeveloped] = useState(false)

  // Develop once, the first time the print is mostly on screen.
  useEffect(() => {
    const el = ref.current
    if (!el || developed) return
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setDeveloped(true)
          io.disconnect()
        }
      },
      { threshold: 0.6 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [developed])

  const caption = photo.caption || formatPhotoTime(photo.taken_at, timeZone)
  return (
    <button
      ref={ref}
      onClick={onOpen}
      aria-label={`Open ${photo.caption || photo.filename}`}
      style={{ '--tilt': `${tilt}deg` } as CSSProperties}
      className={`group/print relative block shrink-0 snap-center rounded-[3px] bg-white p-2.5 pb-0 text-left shadow-[0_1px_2px_rgb(19_28_46/0.12),0_12px_28px_-10px_rgb(19_28_46/0.35)] transition-[transform,box-shadow] duration-300 ease-out [transform:rotate(var(--tilt))] hover:z-10 hover:shadow-[0_2px_4px_rgb(19_28_46/0.12),0_22px_40px_-12px_rgb(19_28_46/0.4)] hover:[transform:rotate(0deg)_translateY(-6px)_scale(1.03)] focus-visible:z-10 focus-visible:[transform:rotate(0deg)_scale(1.03)] ${
        size === 'large' ? 'w-64 sm:w-80' : 'w-48 sm:w-56'
      }`}
    >
      <span className="block aspect-square overflow-hidden bg-[#e9e4d8]">
        <img
          src={photo.web_url ?? photo.thumb_url ?? undefined}
          alt=""
          loading="lazy"
          data-developed={developed}
          className="polaroid-photo h-full w-full object-cover"
        />
      </span>
      <span
        className={`block truncate px-1 font-[family-name:var(--font-hand)] leading-none text-ink/80 ${
          size === 'large' ? 'py-3.5 text-2xl' : 'py-3 text-xl'
        }`}
      >
        {caption || ' '}
      </span>
    </button>
  )
}
