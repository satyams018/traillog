import { BASE_STYLES, type BaseStyleId } from '../lib/mapStyles'

interface Props {
  value: BaseStyleId
  onChange: (id: BaseStyleId) => void
}

export default function StyleSwitcher({ value, onChange }: Props) {
  if (BASE_STYLES.length < 2) return null
  return (
    <div
      role="radiogroup"
      aria-label="Map style"
      className="map-panel flex rounded-full p-1 text-sm"
    >
      {BASE_STYLES.map((s) => (
        <button
          key={s.id}
          role="radio"
          aria-checked={value === s.id}
          onClick={() => onChange(s.id)}
          className={`rounded-full px-3 py-1.5 font-semibold transition-colors ${
            value === s.id ? 'bg-forest text-white' : 'text-ink hover:bg-lichen'
          }`}
        >
          {s.label}
        </button>
      ))}
    </div>
  )
}
