import { useId, useState, type FormEvent } from 'react'
import { verifyPasscode } from '../backup/lock'

interface LockScreenProps {
  stored: { salt: string; hash: string }
  onUnlock: () => void
}

export default function LockScreen({ stored, onUnlock }: LockScreenProps) {
  const [passcode, setPasscode] = useState('')
  const [wrong, setWrong] = useState(false)
  const [busy, setBusy] = useState(false)
  const inputId = useId()

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (passcode.length === 0 || busy) return
    setBusy(true)
    try {
      if (await verifyPasscode(passcode, stored)) onUnlock()
      else {
        setWrong(true)
        setPasscode('')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="lock">
      <form className="lock-form" onSubmit={submit}>
        <h1 className="lock-title">Budget</h1>
        <p className="lock-hint">Enter your passcode to open the app.</p>
        <label className="field-label" htmlFor={inputId}>
          Passcode
        </label>
        <input
          id={inputId}
          className="input input-code"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          autoFocus
          value={passcode}
          onChange={(e) => {
            setPasscode(e.target.value)
            setWrong(false)
          }}
        />
        <div className="lock-error">
          {wrong && <p className="lock-error-text" role="alert">{"That passcode doesn't match. Try again."}</p>}
        </div>
        <button type="submit" className="btn btn-primary" disabled={passcode.length === 0 || busy}>
          Unlock
        </button>
      </form>
    </main>
  )
}
