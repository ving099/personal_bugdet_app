import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { Button } from './forms'

interface ConfirmDialogProps {
  title: string
  children: ReactNode
  confirmLabel: string
  onCancel: () => void
  onConfirm: () => void
  busy: boolean
  error?: string
  /** Element id to focus on close when the element that opened the dialog is gone. */
  fallbackFocusId?: string
}

/** A modal yes/no. Focus starts on Cancel, Tab stays inside, Escape cancels (unless busy). */
export default function ConfirmDialog({ title, children, confirmLabel, onCancel, onConfirm, busy, error, fallbackFocusId }: ConfirmDialogProps) {
  const titleId = useId()
  const bodyId = useId()
  const box = useRef<HTMLDivElement>(null)

  const opener = useRef<Element | null>(null)

  useEffect(() => {
    if (!opener.current) opener.current = document.activeElement
    box.current?.querySelector<HTMLElement>('button')?.focus()
    return () => {
      const back = opener.current
      if (back instanceof HTMLElement && back.isConnected) back.focus()
      else if (fallbackFocusId) document.getElementById(fallbackFocusId)?.focus()
    }
  }, [fallbackFocusId])

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.stopPropagation()
      if (!busy) onCancel()
      return
    }
    if (e.key !== 'Tab') return
    const items = [...(box.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? [])]
    if (items.length === 0) return
    const first = items[0]
    const last = items[items.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return (
    <div className="dialog-backdrop">
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        ref={box}
        onKeyDown={onKeyDown}
      >
        <h2 className="dialog-title" id={titleId}>
          {title}
        </h2>
        <div className="dialog-body" id={bodyId}>
          {children}
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={busy} aria-busy={busy}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
