import { useState } from 'react'
import type { IncomeStream, Transaction } from '../../../domain/types'
import { merchantKey } from '../../../import/matching'
import Money from '../../components/Money'
import { Button, Checkbox, Select } from '../../components/forms'
import { useFocusFirst } from '../../useFocusFirst'
import { formatDisplayDate } from '../import/importFlow'
import { useFlagsMenu, type Flag } from './FlagsMenu'

function AssignForm({ tx, streams, busy, onSave, onCancel }: {
  tx: Transaction
  streams: IncomeStream[]
  busy: boolean
  onSave: (streamId: string, all: boolean) => void
  onCancel: () => void
}) {
  const canMatch = merchantKey(tx.description) !== ''
  const [streamId, setStreamId] = useState('')
  const [all, setAll] = useState(canMatch)
  const [problem, setProblem] = useState('')
  const ref = useFocusFirst<HTMLFormElement>()
  const options = [{ value: '', label: 'Choose a stream' }, ...streams.map((s) => ({ value: s.id, label: s.label }))]
  return (
    <form
      ref={ref}
      className="assign-form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        if (streamId === '') return setProblem(streams.length === 0 ? 'Add an income stream first.' : 'Choose a stream.')
        onSave(streamId, all && canMatch)
      }}
    >
      <Select label="Assign to stream" value={streamId} options={options} onChange={(v) => { setStreamId(v); setProblem('') }} />
      <Checkbox label="Apply to all similar" checked={all && canMatch} disabled={!canMatch} onChange={setAll} />
      {problem && <p className="field-error" role="alert">{problem}</p>}
      <div className="import-actions">
        <Button variant="primary" type="submit" disabled={busy}>Save</Button>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
      </div>
    </form>
  )
}

interface Props {
  tx: Transaction
  streams: IncomeStream[]
  busy: boolean
  open: boolean
  onToggle: () => void
  onSave: (streamId: string, all: boolean) => void
  onFlag: (tx: Transaction, flag: Flag, value: boolean) => void
}

/** One credit that has no income stream yet: assign it to a stream, or flag it as a refund or transfer. */
export default function CreditRow({ tx, streams, busy, open, onToggle, onSave, onFlag }: Props) {
  const flags = useFlagsMenu(tx, onFlag)
  return (
    <li className="txn">
      <div className="txn-main">
        <p className="txn-desc">{tx.description}</p>
        <p className="txn-meta">
          <span>{formatDisplayDate(tx.date)}</span>
        </p>
      </div>
      <p className="txn-amount">
        <Money pence={tx.amountPence} tone="auto" />
      </p>
      <div className="txn-actions">
        <Button variant="secondary" id={`assign-${tx.id}`} aria-expanded={open} onClick={onToggle}>
          Assign<span className="sr-only">{` ${tx.description} to a stream`}</span>
        </Button>
        {flags.button}
      </div>
      {flags.panel}
      {open && <AssignForm tx={tx} streams={streams} busy={busy} onSave={onSave} onCancel={() => { onToggle(); document.getElementById(`assign-${tx.id}`)?.focus() }} />}
    </li>
  )
}
