import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { deleteAllData } from '../../storage/db'
import { seedDefaults } from '../../storage/seed'
import { Button, TextInput } from '../components/forms'
import { useDb } from '../useDb'
import { SettingsSection } from './SettingsSection'

const CONFIRM_WORD = 'DELETE'

function ConfirmDialog({ onCancel, onConfirm, busy, error }: {
  onCancel: () => void
  onConfirm: () => void
  busy: boolean
  error: string
}) {
  const [typed, setTyped] = useState('')
  const titleId = useId()
  const bodyId = useId()
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    box.current?.querySelector<HTMLInputElement>('input')?.focus()
  }, [])

  /** Escape cancels; Tab stays inside the dialog. */
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.stopPropagation()
      if (!busy) onCancel()
      return
    }
    if (e.key !== 'Tab') return
    const items = [...(box.current?.querySelectorAll<HTMLElement>('input, button:not(:disabled)') ?? [])]
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
          Delete all data?
        </h2>
        <p className="dialog-body" id={bodyId}>
          This removes every account, transaction, budget and setting stored on this device, and puts the app back to
          its first-run state. It can&apos;t be undone. A backup file you saved earlier is not affected.
        </p>
        <TextInput label={`Type ${CONFIRM_WORD} to confirm`} value={typed} onChange={setTyped} />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={typed !== CONFIRM_WORD || busy}>
            Delete everything
          </Button>
        </div>
      </div>
    </div>
  )
}

export default function DeleteSection() {
  const db = useDb()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const opener = useRef<HTMLButtonElement>(null)

  function close() {
    setOpen(false)
    setError('')
    opener.current?.focus()
  }

  async function confirm() {
    setBusy(true)
    try {
      await deleteAllData(db)
      // Defaults come straight back (settings.onboardingDone is false), so the setup wizard returns.
      await seedDefaults(db)
      setOpen(false)
    } catch {
      setError("Couldn't delete everything. Try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsSection title="Delete all data">
      <p className="settings-note">Removes everything stored in this browser. Make a backup first if you may want it back.</p>
      <Button variant="danger" onClick={() => setOpen(true)} ref={opener}>
        Delete all data…
      </Button>
      {open && <ConfirmDialog onCancel={close} onConfirm={() => void confirm()} busy={busy} error={error} />}
    </SettingsSection>
  )
}
