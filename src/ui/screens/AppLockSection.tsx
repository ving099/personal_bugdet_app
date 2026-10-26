import { useState } from 'react'
import { hashPasscode, verifyPasscode } from '../../backup/lock'
import { Button, TextInput } from '../components/forms'
import { useDb } from '../useDb'
import { SettingsSection } from './SettingsSection'
import { validatePasscode } from './settingsValidation'

export default function AppLockSection({ appLock }: { appLock: { salt: string; hash: string } | null }) {
  const db = useDb()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const locked = appLock !== null

  /** Passcodes never outlive the action: all three fields are emptied whatever the outcome. */
  function wipe() {
    setCurrent('')
    setNext('')
    setConfirm('')
  }

  async function currentIsRight(): Promise<boolean> {
    if (!appLock) return true
    if (current.length === 0) {
      setError('Enter your current passcode')
      return false
    }
    if (!(await verifyPasscode(current, appLock))) {
      setError("That passcode doesn't match. Try again.")
      setCurrent('')
      return false
    }
    return true
  }

  async function setPasscode() {
    setError('')
    setStatus('')
    const problem = validatePasscode(next, confirm)
    if (problem) {
      setError(problem)
      return
    }
    setBusy(true)
    try {
      if (!(await currentIsRight())) return
      await db.settings.update('main', { appLock: await hashPasscode(next) })
      wipe()
      setStatus(locked ? 'Passcode changed' : 'Passcode set')
    } catch {
      setError("Couldn't save the passcode. Nothing was changed.")
    } finally {
      setBusy(false)
    }
  }

  async function removePasscode() {
    setError('')
    setStatus('')
    setBusy(true)
    try {
      if (!(await currentIsRight())) return
      await db.settings.update('main', { appLock: null })
      wipe()
      setStatus('Passcode removed')
    } catch {
      setError("Couldn't remove the passcode. Nothing was changed.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsSection title="App lock">
      <p className="settings-note">This keeps casual access out. Your encrypted backup is the strongly protected copy.</p>
      <p className="settings-state">{locked ? 'App lock is on.' : 'App lock is off.'}</p>
      {locked && (
        <TextInput label="Current passcode" type="password" inputMode="numeric" value={current} onChange={setCurrent} />
      )}
      <TextInput
        label={locked ? 'New passcode' : 'Passcode'}
        type="password"
        inputMode="numeric"
        hint="At least 4 digits."
        value={next}
        onChange={setNext}
      />
      <TextInput label="Confirm passcode" type="password" inputMode="numeric" value={confirm} onChange={setConfirm} />
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="save-row">
        <Button variant="primary" onClick={() => void setPasscode()} disabled={busy}>
          {locked ? 'Change passcode' : 'Set passcode'}
        </Button>
        {locked && (
          <Button variant="secondary" onClick={() => void removePasscode()} disabled={busy}>
            Remove passcode
          </Button>
        )}
        <p className="save-status" role="status">
          {status}
        </p>
      </div>
    </SettingsSection>
  )
}
