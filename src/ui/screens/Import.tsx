import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useRef, useState } from 'react'
import { unmatchedCardRepayments } from '../../import/matching'
import { applyProfile, ProfileError } from '../../import/profile'
import type { ImportProfile } from '../../domain/types'
import ConfirmDialog from '../components/ConfirmDialog'
import EmptyState from '../components/EmptyState'
import { Button, Select } from '../components/forms'
import { useDb } from '../useDb'
import AddAccountForm from './import/AddAccountForm'
import FileDrop from './import/FileDrop'
import { importFiles, undoImport, type FileResult } from './import/importDb'
import { batchLabel, buildPreview, plural, readAll, summariseBatches } from './import/importFlow'
import ImportHistory from './import/ImportHistory'
import ImportPreview from './import/ImportPreview'
import MappingForm from './import/MappingForm'
import NeedsAttention from './import/NeedsAttention'
import { readStatement, type StagedFile } from './import/readStatement'

interface Outcome extends FileResult {
  undone?: boolean
}
interface UndoTarget {
  batchId: string
  label: string
}

function resultLine(r: FileResult): string {
  if (r.added === 0) return 'Nothing new to import.'
  const kept = r.skipped > 0 ? ` ${r.skipped === 1 ? '1 was' : `${r.skipped} were`} already in your records.` : ''
  return `Imported ${plural(r.added, 'transaction')}.${kept}`
}

export default function Import() {
  const db = useDb()
  const accounts = useLiveQuery(() => db.accounts.toArray(), [db])
  const txs = useLiveQuery(() => db.transactions.toArray(), [db])
  const profiles = useLiveQuery(() => db.importProfiles.toArray(), [db])

  const [chosen, setChosen] = useState('')
  const [adding, setAdding] = useState(false)
  const [staged, setStaged] = useState<StagedFile[]>([])
  const [reading, setReading] = useState(false)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirmError, setConfirmError] = useState('')
  const [outcomes, setOutcomes] = useState<Outcome[]>([])
  const [notice, setNotice] = useState('')
  const [undoTarget, setUndoTarget] = useState<UndoTarget | null>(null)
  const [undoBusy, setUndoBusy] = useState(false)
  const [undoError, setUndoError] = useState('')
  const [flagsFailed, setFlagsFailed] = useState(false)
  const working = useRef(false)
  const readToken = useRef(0)
  const focusPreview = useRef(false)
  const noticeRef = useRef<HTMLDivElement>(null)
  const [noticeTick, setNoticeTick] = useState(0)

  const accountId = chosen || (accounts?.length === 1 ? accounts[0].id : '')
  const account = accounts?.find((a) => a.id === accountId)
  const accountKey = account?.id
  const profile = profiles?.find((p) => p.id === account?.importProfileId)
  const usable = useMemo(() => staged.filter((f): f is Extract<StagedFile, { rows: string[][] }> => 'rows' in f), [staged])

  // Reading every file with the saved mapping; a bad row is reported against its file.
  const parsed = useMemo(
    () => (accountKey && profile && usable.length > 0 ? readAll(usable, profile, accountKey) : null),
    [accountKey, profile, usable],
  )

  const showMapping = Boolean(account) && usable.length > 0 && (!profile || editing || (parsed !== null && 'error' in parsed))
  const files = parsed && 'files' in parsed ? parsed.files : null
  const preview = useMemo(
    () => (files && txs && accounts && !showMapping ? buildPreview(files, txs, accounts) : null),
    [files, txs, accounts, showMapping],
  )
  const batches = useMemo(() => (txs && accounts ? summariseBatches(txs, accounts) : []), [txs, accounts])
  const attention = useMemo(() => (txs && accounts ? unmatchedCardRepayments(txs, accounts) : []), [txs, accounts])

  // Runs after the dialog's unmount cleanup in the same commit, so the notice keeps focus after an undo.
  useEffect(() => {
    if (noticeTick > 0) noticeRef.current?.focus()
  }, [noticeTick])

  useEffect(() => {
    if (preview && focusPreview.current) {
      focusPreview.current = false
      document.getElementById('preview-heading')?.focus()
    }
  }, [preview])

  if (!accounts || !txs || !profiles) return <div className="loading" role="status">Loading</div>

  if (accounts.length === 0 || adding) {
    const form = <AddAccountForm onAdded={(a) => { setChosen(a.id); setAdding(false) }} onCancel={accounts.length ? () => setAdding(false) : undefined} />
    return accounts.length === 0 ? (
      <EmptyState title="Add an account first" body="Statements are imported into one account at a time. Add the account these statements belong to." action={form} />
    ) : (
      <section className="import-section"><h2 className="import-heading">Add an account</h2>{form}</section>
    )
  }

  function reset() {
    setStaged([])
    setEditing(false)
    setConfirmError('')
    setOutcomes([])
    setNotice('')
    setFlagsFailed(false)
    focusPreview.current = false
  }

  async function takeFiles(list: File[]) {
    if (busy) return
    reset()
    const token = ++readToken.current
    setReading(true)
    try {
      const read = await Promise.all(list.map(readStatement))
      if (token === readToken.current) setStaged(read)
    } finally {
      if (token === readToken.current) setReading(false)
    }
  }

  async function saveMapping(p: ImportProfile): Promise<string | undefined> {
    if (!account) return undefined
    try {
      for (const f of usable) applyProfile(f.rows, p, account.id)
    } catch (e) {
      if (e instanceof ProfileError) return `${e.message}. Change the mapping and try again.`
      return 'That mapping could not be applied to the file.'
    }
    try {
      await db.transaction('rw', db.importProfiles, db.accounts, async () => {
        await db.importProfiles.put(p)
        await db.accounts.update(account.id, { importProfileId: p.id })
      })
    } catch {
      return "Couldn't save the mapping. Try again."
    }
    focusPreview.current = true
    setEditing(false)
    return undefined
  }

  async function confirm() {
    if (!files || working.current) return
    working.current = true
    setBusy(true)
    setConfirmError('')
    setFlagsFailed(false)
    try {
      const out = await importFiles(db, files)
      setOutcomes(out.results)
      setNotice('')
      setFlagsFailed(Boolean(out.flagsFailed))
      if (out.failed) {
        setConfirmError(`Couldn't import ${out.failed.fileName}, so nothing from it was saved. Your other records are unchanged.`)
      } else {
        setStaged([])
      }
    } catch {
      setConfirmError("Couldn't import these files. Nothing was changed. Try again.")
    } finally {
      working.current = false
      setBusy(false)
    }
  }

  async function undo() {
    if (!undoTarget || working.current) return
    working.current = true
    setUndoBusy(true)
    setUndoError('')
    try {
      const removed = await undoImport(db, undoTarget.batchId)
      setOutcomes((o) => o.map((r) => (r.batchId === undoTarget.batchId ? { ...r, undone: true } : r)))
      setNotice(`Undone. Removed ${plural(removed, 'transaction')} from ${undoTarget.label}.`)
      setUndoTarget(null)
      setFlagsFailed(false)
      setNoticeTick((t) => t + 1)
    } catch {
      setUndoError("Couldn't undo this import. Nothing was changed. Try again.")
    } finally {
      working.current = false
      setUndoBusy(false)
    }
  }

  const accountOptions = [{ value: '', label: 'Choose an account' }, ...accounts.map((a) => ({ value: a.id, label: a.name }))]
  const live = outcomes.filter((o) => !o.undone)

  return (
    <div className="import">
      <section className="import-section" aria-labelledby="add-heading">
        <h2 className="import-heading" id="add-heading">Add statements</h2>
        <Select
          label="Account"
          value={accountId}
          options={accountOptions}
          disabled={busy || reading}
          onChange={(v) => { setChosen(v); reset() }}
          hint="Pick the account first. Statement files rarely say which account they belong to."
        />
        {account?.kind === 'business' && (
          <p className="import-hint">Business accounts are excluded from your spending, but stay in your export.</p>
        )}
        <Button className="link-btn" disabled={busy || reading} onClick={() => setAdding(true)}>Add another account</Button>
        <FileDrop onFiles={(f) => void takeFiles(f)} disabled={!account || busy} busy={reading} />
        {account && profile && staged.length === 0 && (
          <p className="import-hint">This account already has a saved layout, so choose a file and it will be read straight away.</p>
        )}
        {staged.filter((f) => f.error !== undefined).map((f) => (
          <p key={f.name} className="form-error" role="alert">{f.error}</p>
        ))}
        {usable.length > 0 && (
          <p className="import-hint">{`Reading ${usable.map((f) => f.name).join(', ')}`}</p>
        )}
      </section>

      {showMapping && account && (
        <section className="import-section" aria-labelledby="map-heading">
          <h2 className="import-heading" id="map-heading">{profile ? 'Edit mapping' : 'Set up this account'}</h2>
          <MappingForm
            key={`${account.id}:${usable[0].name}:${editing}`}
            rows={usable[0].rows}
            bank={account.bank}
            accountId={account.id}
            {...(profile ? { initial: profile } : {})}
            problem={parsed && 'error' in parsed ? parsed.error : undefined}
            onSave={saveMapping}
            onCancel={editing ? () => setEditing(false) : undefined}
          />
        </section>
      )}

      {preview && files && (
        <ImportPreview
          preview={preview}
          fileNames={files.map((f) => f.name)}
          emptyFiles={files.filter((f) => f.rows.length === 0).map((f) => f.name)}
          busy={busy}
          error={confirmError}
          onConfirm={() => void confirm()}
          onEditMapping={() => setEditing(true)}
        />
      )}

      <div ref={noticeRef} tabIndex={-1} className="result-region" role="status">
        {notice && <p className="result-line">{notice}</p>}
        {flagsFailed && outcomes.length > 0 && (
          <p className="result-line">Imported, but transfers and refunds couldn't be re-checked. They'll be fixed on your next import.</p>
        )}
        {live.length > 0 && (
          <section className="import-section" aria-labelledby="result-heading">
            <h2 className="import-heading" id="result-heading">Done</h2>
            <ul className="history-list">
              {live.map((r) => (
                <li key={r.batchId} className="history-item">
                  <p className="history-name">
                    {outcomes.length > 1 && <strong>{r.fileName}: </strong>}
                    {resultLine(r)}
                  </p>
                  {r.added > 0 && (
                    <Button aria-label={`Undo import of ${r.fileName}`} onClick={() => setUndoTarget({ batchId: r.batchId, label: r.fileName })}>
                      Undo
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <ImportHistory
        key={accountId}
        batches={batches}
        accounts={accounts}
        accountId={accountId}
        onUndo={(b) => setUndoTarget({ batchId: b.batchId, label: batchLabel(b) })}
      />
      <NeedsAttention items={attention} accounts={accounts} />

      {undoTarget && (
        <ConfirmDialog
          title="Undo this import?"
          confirmLabel="Undo import"
          busy={undoBusy}
          fallbackFocusId="history-heading"
          error={undoError}
          onCancel={() => { setUndoTarget(null); setUndoError('') }}
          onConfirm={() => void undo()}
        >
          <p>This removes every transaction that came from {undoTarget.label}. Your other records are not touched.</p>
        </ConfirmDialog>
      )}
    </div>
  )
}
