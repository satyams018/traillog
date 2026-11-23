import { MoreHorizontal } from 'lucide-react'
import { type ComponentType, useEffect, useRef, useState } from 'react'

export interface MenuAction {
  label: string
  onSelect: () => void
  icon?: ComponentType<{ className?: string }>
  danger?: boolean
}

/** "⋯" menu for secondary and destructive actions, kept away from the title. */
export default function ActionsMenu({ actions, label }: { actions: MenuAction[]; label: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (
        e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)
      )
        setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-card text-ink hover:border-brand/40"
      >
        <MoreHorizontal className="h-5 w-5" aria-hidden />
      </button>
      {open && (
        <ul
          role="menu"
          className="absolute right-0 z-30 mt-2 min-w-48 overflow-hidden rounded-2xl border border-line bg-card p-1.5 text-sm shadow-[var(--shadow-lift)]"
        >
          {actions.map(({ label: text, onSelect, icon: Icon, danger }) => (
            <li key={text} role="none">
              <button
                role="menuitem"
                onClick={() => {
                  setOpen(false)
                  onSelect()
                }}
                className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left font-medium hover:bg-paper ${
                  danger ? 'text-danger' : 'text-ink'
                }`}
              >
                {Icon && <Icon className="h-4 w-4" />}
                {text}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
