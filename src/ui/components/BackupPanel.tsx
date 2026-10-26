import { useLiveQuery } from 'dexie-react-hooks'
import { useRef, useState } from 'react'
import { decryptBackup, encryptBackup, InvalidBackupError, WrongPassphraseError } from '../../backup/crypto'
import { backupIsOverdue } from '../../backup/lock'
import { exportSnapshot, restoreSnapshot } from '../../backup/snapshot'
import type { ISODate } from '../../domain/types'
import { downloadBytes } from '../download'
import { todayISO } from '../formValues'
import { useDb } from '../useDb'
import ConfirmDialog from './ConfirmDialog'
import { Button, TextInput } from './forms'

/** crypto.ts sets no minimum, so the app asks for a passphrase of at least this many characters. */
export const MIN_PASSPHRASE_LENGTH = 8

const KEPT = "Couldn't restore. Your existing data has not been changed."
const MESSAGES = {
  wrong: "That passphrase doesn't match this backup.",
  invalid: "This file looks damaged or isn't a backup from this app.",
  kept: KEPT,
} as const

function restoreMessage(e: unknown): string {
  if (e instanceof WrongPassphraseError) return MESSAGES.wrong
  if (e instanceof InvalidBackupError) return MESSAGES.invalid
  // SnapshotError, Dexie BulkError or anything else: the restore runs in one transaction, so nothing was written.
  return MESSAGES.kept
}

function formatDay(iso: ISODate): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(y, m - 1, d)))
}

/** Encrypted backup and restore. The passphrases live only in component state and are never stored or logged. */
export default function BackupPanel({ today = todayISO() }: { today?: ISODate }) {
  const db = useDb()
  const settings = useLiveQuery(() => db.settings.get('main'), [db])
  const lastAt = settings?.backupLastAt

  const [pass, setPass] = useState('')
  const [confirm, setConfirm] = useState('')
  const [attempted, setAttempted] = useState(false)
  const [encrypting, setEncrypting] = useState(false)
  const [backupError, setBackupError] = useState('')
  const [status, setStatus] = useState('')
  const encryptRunning = useRef(false)

  const [file, setFile] = useState<File | null>(null)
  const [restorePass, setRestorePass] = useState('')
  const [restoreError, setRestoreError] = useState('')
  const [asking, setAsking] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const picker = useRef<HTMLInputElement>(null)
  const restoreRunning = useRef(false)

  const mismatch = confirm.length > 0 && confirm !== pass ? "The passphrases don't match." : undefined
  const tooShort = attempted && pass.length < MIN_PASSPHRASE_LENGTH
    ? `Use at least ${MIN_PASSPHRASE_LENGTH} characters.` : undefined

  async function backUp() {
    if (encryptRunning.current) return
    setAttempted(true)
    setStatus('')
    setBackupError('')
    if (pass.length < MIN_PASSPHRASE_LENGTH || pass !== confirm) return
    encryptRunning.current = true
    setEncrypting(true)
    try {
      const bytes = await encryptBackup(await exportSnapshot(db), pass)
      downloadBytes(bytes, `budget-backup-${today}.bin`, 'application/octet-stream')
      await db.settings.update('main', { backupLastAt: today })
      setPass('')
      setConfirm('')
      setAttempted(false)
      setStatus('Backup downloaded. Keep the file and your passphrase somewhere safe; without the passphrase it cannot be opened.')
    } catch {
      setBackupError("Couldn't make the backup. Nothing was changed. Try again.")
    } finally {
      encryptRunning.current = false
      setEncrypting(false)
    }
  }

  function askToRestore() {
    setStatus('')
    if (!file) {
      setRestoreError('Choose a backup file first.')
      return
    }
    if (restorePass.length === 0) {
      setRestoreError('Enter the passphrase for this backup.')
      return
    }
    setRestoreError('')
    setAsking(true)
  }

  async function restore() {
    if (restoreRunning.current || !file) return
    restoreRunning.current = true
    setRestoring(true)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      await restoreSnapshot(db, await decryptBackup(bytes, restorePass))
      setFile(null)
      setRestorePass('')
      setRestoreError('')
      setStatus('Backup restored. Everything on this device now matches the backup.')
    } catch (e) {
      setRestoreError(restoreMessage(e))
    } finally {
      restoreRunning.current = false
      setRestoring(false)
      setAsking(false)
    }
  }

  const overdue = settings ? backupIsOverdue(lastAt, today) : false
  return (
    <div className="backup-panel">
      <p className="settings-state">{lastAt ? `Last backup: ${formatDay(lastAt)}` : 'No backup yet'}</p>
      {overdue && (
        <p className="settings-note">
          {lastAt ? "It's been over 30 days since your last backup. Make a new one." : 'Make a backup so you can get your data back if this device is lost.'}
        </p>
      )}

      <h3 className="settings-subheading">Make a backup</h3>
      <p className="settings-note">
        The file is encrypted with your passphrase and stays on your device until you move it. We can&apos;t recover a forgotten passphrase.
      </p>
      <TextInput label="Backup passphrase" type="password" autoComplete="new-password" value={pass}
        onChange={(v) => { setPass(v); setStatus('') }} error={tooShort}
        hint={`At least ${MIN_PASSPHRASE_LENGTH} characters.`} />
      <TextInput label="Confirm backup passphrase" type="password" autoComplete="new-password" value={confirm}
        onChange={(v) => { setConfirm(v); setStatus('') }} error={mismatch} />
      <Button variant="primary" onClick={() => void backUp()} aria-busy={encrypting}>
        {encrypting ? 'Encrypting…' : 'Download encrypted backup'}
      </Button>
      {backupError && <p className="form-error" role="alert">{backupError}</p>}

      <h3 className="settings-subheading">Restore from a backup</h3>
      <p className="settings-note">Restoring replaces all data on this device with the contents of the backup file.</p>
      <div className="backup-file">
        <Button variant="secondary" onClick={() => picker.current?.click()}>Choose backup file</Button>
        <span className="backup-file-name">{file ? file.name : 'No file chosen'}</span>
        <input ref={picker} className="sr-only" type="file" accept=".bin" aria-label="Backup file" tabIndex={-1}
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null
            e.target.value = ''
            setFile(f)
            setRestoreError('')
            setStatus('')
          }} />
      </div>
      <TextInput label="Passphrase for the backup file" type="password" autoComplete="current-password" value={restorePass}
        onChange={(v) => { setRestorePass(v); setRestoreError('') }} />
      <Button variant="danger" onClick={askToRestore} aria-busy={restoring}>Restore from backup…</Button>
      {restoreError && <p className="form-error" role="alert">{restoreError}</p>}

      <p className="save-status" role="status">{status}</p>

      {asking && (
        <ConfirmDialog
          title="Replace all data on this device?"
          confirmLabel={restoring ? 'Restoring…' : 'Replace all data'}
          onCancel={() => setAsking(false)}
          onConfirm={() => void restore()}
          busy={restoring}
        >
          <p>
            Restoring replaces all data on this device, including your budget, transactions, settings and passcode, with the
            contents of {file?.name ?? 'the backup'}. It can&apos;t be undone. If you may want what is here now, make a backup first.
          </p>
        </ConfirmDialog>
      )}
    </div>
  )
}
