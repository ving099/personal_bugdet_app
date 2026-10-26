import { useEffect, useId, useRef, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { Button } from './forms'

interface FormDialogProps {
  title: string
  children: ReactNode
  submitLabel: string
  onCancel: () => void
  onSubmit: () => void
  busy: boolean
  error?: string
  /** Element id to focus on close when the element that opened the dialog is gone. */
  fallbackFocusId?: string
}

const FOCUSABLE = 'button:not(:disabled), select:not(:disabled), input:not(:disabled), textarea:not(:disabled)'

/** A modal with fields. Focus starts on the first field, Tab stays inside, Escape cancels (unless busy). */
export default function FormDialog({
  title, children, submitLabel, onCancel, onSubmit, busy, error, fallbackFocusId,
}: FormDialogProps) {
  const titleId = useId()
  const box = useRef<HTMLDivElement>(null)
  const opener = useRef<Element | null>(null)

  useEffect(() => {
    const active = document.activeElement
    if (!opener.current && active && active !== document.body) opener.current = active
    box.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus()
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
    const items = [...(box.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])]
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

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!busy) onSubmit()
  }

  return (
    <div className="dialog-backdrop">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={box} onKeyDown={onKeyDown}>
        <h2 className="dialog-title" id={titleId}>
          {title}
        </h2>
        <form noValidate onSubmit={submit}>
          <div className="dialog-body">{children}</div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <Button variant="secondary" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={busy} aria-busy={busy}>
              {submitLabel}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
