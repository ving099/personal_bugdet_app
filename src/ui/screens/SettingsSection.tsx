import { useId, type ReactNode } from 'react'
import { Button } from '../components/forms'

/** A named region of the Settings screen. Sentence-case heading, flat, separated by a rule. */
export function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  const id = useId()
  return (
    <section className="settings-section" aria-labelledby={id}>
      <h2 className="settings-heading" id={id}>
        {title}
      </h2>
      {children}
    </section>
  )
}

interface SaveRowProps {
  onSave: () => void
  status: string
  label?: string
  disabled?: boolean
}

/** The section's Save button and a polite status line ('Saved'). The status element is always present. */
export function SaveRow({ onSave, status, label = 'Save', disabled }: SaveRowProps) {
  return (
    <div className="save-row">
      <Button variant="primary" onClick={onSave} disabled={disabled}>
        {label}
      </Button>
      <p className="save-status" role="status">
        {status}
      </p>
    </div>
  )
}
