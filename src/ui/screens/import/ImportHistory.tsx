import { useState } from 'react'
import type { Account } from '../../../domain/types'
import { Button, Select } from '../../components/forms'
import { batchLabel, plural, type BatchSummary } from './importFlow'

const WHEN = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

interface ImportHistoryProps {
  batches: BatchSummary[]
  accounts: Account[]
  /** Account currently chosen above; the list starts on it. */
  accountId: string
  onUndo: (b: BatchSummary) => void
}

export default function ImportHistory({ batches, accounts, accountId, onUndo }: ImportHistoryProps) {
  const [override, setOverride] = useState<string | null>(null)
  const filter = override ?? (accountId || 'all')
  const shown = filter === 'all' ? batches : batches.filter((b) => b.accountId === filter)
  const options = [{ value: 'all', label: 'All accounts' }, ...accounts.map((a) => ({ value: a.id, label: a.name }))]

  return (
    <section className="import-section" aria-labelledby="history-heading">
      <h2 className="import-heading" id="history-heading">
        Import history
      </h2>
      <Select label="Show history for" value={filter} options={options} onChange={setOverride} />
      {shown.length === 0 ? (
        <p className="import-hint">No imports yet for {filter === 'all' ? 'any account' : 'this account'}.</p>
      ) : (
        <ul className="history-list">
          {shown.map((b) => (
            <li key={b.batchId} className="history-item">
              <div className="history-main">
                <p className="history-name">{batchLabel(b)}</p>
                <p className="history-meta">
                  {b.importedAt ? `${WHEN.format(new Date(b.importedAt))} · ` : ''}
                  {plural(b.count, 'transaction')} · {b.accountName}
                </p>
              </div>
              <Button variant="secondary" aria-label={`Undo import of ${batchLabel(b)}`} onClick={() => onUndo(b)}>
                Undo
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
