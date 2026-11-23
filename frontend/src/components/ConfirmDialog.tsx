import { Trash2 } from 'lucide-react'
import { useEffect, useRef } from 'react'

import { btn } from './ui'

interface Props {
  open: boolean
  title: string
  body: string
  confirmLabel: string
  busyLabel: string
  busy?: boolean
  onConfirm: () => void
  onClose: () => void
}

/** Accessible confirm dialog using native <dialog> (focus trap + Esc to close for free). */
export default function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  busyLabel,
  busy,
  onConfirm,
  onClose,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-auto w-[min(92vw,26rem)] rounded-3xl bg-card p-7 text-ink shadow-[var(--shadow-lift)] backdrop:bg-ink/40 backdrop:backdrop-blur-sm"
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-danger/10 text-danger">
        <Trash2 className="h-5 w-5" aria-hidden />
      </span>
      <h2 className="mt-4 text-xl font-extrabold">{title}</h2>
      <p className="mt-2 text-muted">{body}</p>
      <div className="mt-7 flex justify-end gap-2">
        <button onClick={onClose} className={btn.secondary} autoFocus>
          Cancel
        </button>
        <button onClick={onConfirm} disabled={busy} className={btn.danger}>
          {busy ? busyLabel : confirmLabel}
        </button>
      </div>
    </dialog>
  )
}
