import { useId, useState } from 'react'
import type { Account, Transaction } from '../../../domain/types'
import { MoneyInput, Button } from '../../components/forms'
import { parseMoney, penceToInput } from '../../formValues'
import { categoryTransactions, LIST_LIMIT, UNCATEGORISED, type BudgetRow } from './budgetModel'
import { plural } from '../import/importFlow'
import TransactionRow from './TransactionRow'

interface Props {
  row: BudgetRow
  expanded: boolean
  monthTxs: Transaction[]
  accounts: Account[]
  onToggle: () => void
  onSaveLimit: (pence: number) => void
  onChangeCategory: (tx: Transaction) => void
  onFlag: (tx: Transaction, flag: 'isRefund' | 'isTransfer', value: boolean) => void
}

function LimitForm({ row, onSave }: { row: BudgetRow; onSave: (pence: number) => void }) {
  const [value, setValue] = useState(penceToInput(row.limitPence))
  const [error, setError] = useState('')
  function submit() {
    if (value.trim() === '') return onSave(0)
    const parsed = parseMoney(value)
    if (!parsed.ok || parsed.pence < 0) return setError('Enter an amount like 250.00, or leave it blank to remove the limit.')
    setError('')
    onSave(parsed.pence)
  }
  return (
    <form
      className="limit-form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <MoneyInput
        label="Set monthly limit"
        value={value}
        onChange={(v) => { setValue(v); setError('') }}
        hint="Leave it blank or enter 0 to remove the limit."
      />
      {error && <p className="field-error" role="alert">{error}</p>}
      <Button variant="secondary" type="submit">
        Save limit
      </Button>
    </form>
  )
}

export default function CategoryRow({ row, expanded, monthTxs, accounts, onToggle, onSaveLimit, onChangeCategory, onFlag }: Props) {
  const [showAll, setShowAll] = useState(false)
  const bodyId = useId()
  const txs = expanded ? categoryTransactions(monthTxs, accounts, row.id) : []
  const shown = showAll ? txs : txs.slice(0, LIST_LIMIT)
  const hasBar = row.limitPence > 0
  return (
    <li className="cat" data-standing={row.standing}>
      <button type="button" className="cat-head" aria-expanded={expanded} aria-controls={bodyId} id={`cat-${row.id}`} onClick={onToggle}>
        <span className="cat-name">{row.name}</span>
        <span className="cat-status">
          {row.statusText && <span>{row.statusText}</span>}
          {row.noLimit && row.id !== UNCATEGORISED && row.standing !== 'refunds' && <span className="cat-nolimit">No limit set</span>}
          {row.overText && <span className="cat-over">{row.overText}</span>}
        </span>
      </button>
      {row.id === UNCATEGORISED && (
        <p className="cat-hint">
          <span>{plural(row.count ?? 0, 'transaction')}.</span> <span>Pick a category so these count properly.</span>
        </p>
      )}
      {hasBar && (
        <div
          className="bar"
          role="progressbar"
          aria-label={row.name}
          aria-valuemin={0}
          aria-valuemax={Math.max(row.limitPence, 1)}
          aria-valuenow={Math.min(Math.max(row.spentPence, 0), Math.max(row.limitPence, 1))}
          aria-valuetext={row.overText ? `${row.statusText}. ${row.overText}` : row.statusText}
        >
          <div className="bar-fill" data-over={row.standing === 'over' ? '' : undefined} style={{ width: `${row.fill * 100}%` }} />
        </div>
      )}
      {expanded && (
        <div className="cat-body" id={bodyId}>
          {row.id !== UNCATEGORISED && <LimitForm row={row} onSave={onSaveLimit} />}
          {txs.length === 0 ? (
            <p className="import-hint">No transactions in this period.</p>
          ) : (
            <ul className="txn-list" aria-label={`${row.name} transactions`}>
              {shown.map((t) => (
                <TransactionRow key={t.id} tx={t} onChangeCategory={onChangeCategory} onFlag={onFlag} />
              ))}
            </ul>
          )}
          {!showAll && txs.length > LIST_LIMIT && (
            <Button variant="secondary" className="show-all" onClick={() => setShowAll(true)}>
              {`Show all ${txs.length}`}
            </Button>
          )}
        </div>
      )}
    </li>
  )
}
