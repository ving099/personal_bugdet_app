import { useState } from 'react'
import type { IncomeStream, Transaction } from '../../../domain/types'
import type { BudgetDB } from '../../../storage/db'
import Money from '../../components/Money'
import { Button, MoneyInput, TextInput } from '../../components/forms'
import { parseMoney } from '../../formValues'
import { useFocusFirst } from '../../useFocusFirst'
import { plural } from '../import/importFlow'
import { addIncomeStream, assignStream, setFlag } from './budgetDb'
import CreditRow from './CreditRow'
import { LIST_LIMIT, UNASSIGNED } from './budgetModel'

interface Props {
  db: BudgetDB
  streams: IncomeStream[]
  incomeByStream: Record<string, number>
  credits: Transaction[]
}

function AddStreamForm({ busy, onSave, onCancel }: { busy: boolean; onSave: (label: string, pence: number) => void; onCancel: () => void }) {
  const [label, setLabel] = useState('')
  const [amount, setAmount] = useState('')
  const [attempted, setAttempted] = useState(false)
  const parsed = parseMoney(amount)
  const ref = useFocusFirst<HTMLFormElement>()
  const valid = label.trim() !== '' && parsed.ok && parsed.pence >= 0
  return (
    <form
      ref={ref}
      className="import-form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        if (!valid || !parsed.ok) return setAttempted(true)
        onSave(label, parsed.pence)
      }}
    >
      <TextInput label="Stream name" value={label} onChange={setLabel} error={attempted && label.trim() === '' ? 'Enter a name' : undefined} />
      <MoneyInput label="Expected monthly net amount" required showErrors={attempted} value={amount} onChange={setAmount} />
      <div className="import-actions">
        <Button variant="primary" type="submit" disabled={busy}>Add stream</Button>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
      </div>
    </form>
  )
}

export default function IncomeSection({ db, streams, incomeByStream, credits }: Props) {
  const [assigning, setAssigning] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const unassigned = incomeByStream[UNASSIGNED] ?? 0

  async function run(work: () => Promise<string>, done: () => void) {
    setBusy(true)
    setError('')
    try {
      setNotice(await work())
      done()
    } catch {
      setError("Couldn't save that. Nothing was changed.")
    } finally {
      setBusy(false)
    }
  }

  const shown = showAll ? credits : credits.slice(0, LIST_LIMIT)
  return (
    <section className="import-section" aria-labelledby="income-heading">
      <h2 className="import-heading" id="income-heading" tabIndex={-1}>
        Income
      </h2>
      <div role="status" className="result-line">
        {notice}
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {streams.length === 0 && unassigned === 0 && (
        <p className="import-hint">Add an income stream, such as your salary, to see what has arrived against what you expect.</p>
      )}
      <ul className="stream-list">
        {streams.map((s) => (
          <li key={s.id} className="stream">
            <p className="stream-name">{s.label}</p>
            <p className="stream-figures">
              <span>Received <Money pence={incomeByStream[s.id] ?? 0} /></span>
              <span>Expected <Money pence={s.expectedMonthlyNetPence} /></span>
            </p>
          </li>
        ))}
        {unassigned > 0 && (
          <li className="stream">
            <p className="stream-name">Unassigned income</p>
            <p className="stream-figures">
              <span>Received <Money pence={unassigned} /></span>
            </p>
            <p className="import-hint">Label these credits with an income stream so they count towards the right one.</p>
            <ul className="txn-list" aria-label="Unassigned credits">
              {shown.map((t) => (
                <CreditRow
                  key={t.id}
                  tx={t}
                  streams={streams}
                  busy={busy}
                  open={assigning === t.id}
                  onToggle={() => setAssigning(assigning === t.id ? null : t.id)}
                  onFlag={(tx, flag, value) =>
                    void run(async () => {
                      await setFlag(db, tx.id, flag, value)
                      return flag === 'isRefund' ? (value ? 'Marked as a refund.' : 'No longer a refund.') : value ? 'Marked as a transfer.' : 'No longer a transfer.'
                    }, () => undefined)
                  }
                  onSave={(streamId, all) =>
                    void run(async () => {
                      const { changed } = await assignStream(db, t.id, streamId, all)
                      return changed > 1 ? `Assigned ${plural(changed, 'credit')}.` : 'Assigned.'
                    }, () => { setAssigning(null); document.getElementById('income-heading')?.focus() })
                  }
                />
              ))}
            </ul>
            {!showAll && credits.length > LIST_LIMIT && (
              <Button variant="secondary" className="show-all" onClick={() => setShowAll(true)}>
                {`Show all ${credits.length}`}
              </Button>
            )}
          </li>
        )}
      </ul>
      <Button variant="secondary" id="add-stream" aria-expanded={adding} onClick={() => setAdding(!adding)}>
        Add income stream
      </Button>
      {adding && (
        <AddStreamForm
          busy={busy}
          onCancel={() => { setAdding(false); document.getElementById('add-stream')?.focus() }}
          onSave={(label, pence) =>
            void run(async () => {
              await addIncomeStream(db, label, pence)
              return `Added ${label.trim()}.`
            }, () => { setAdding(false); document.getElementById('add-stream')?.focus() })
          }
        />
      )}
    </section>
  )
}
