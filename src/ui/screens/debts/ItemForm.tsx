import type { ReactNode } from 'react'
import { Button } from '../../components/forms'
import { useFocusFirst } from '../../useFocusFirst'

interface Props {
  title: string
  submitLabel: string
  busy: boolean
  error?: string
  onSubmit: () => void
  onCancel: () => void
  children: ReactNode
}

/** An inline form that opens under its list. The first field takes focus. */
export default function ItemForm({ title, submitLabel, busy, error, onSubmit, onCancel, children }: Props) {
  const ref = useFocusFirst<HTMLFormElement>()
  return (
    <form
      ref={ref}
      className="item-form"
      aria-label={title}
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit()
      }}
    >
      <h3 className="import-subheading">{title}</h3>
      {children}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="import-actions">
        <Button variant="primary" type="submit" disabled={busy} aria-busy={busy}>
          {submitLabel}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
