import type { Account, Transaction } from '../../../domain/types'
import Money from '../../components/Money'
import { formatDisplayDate } from './importFlow'

export default function NeedsAttention({ items, accounts }: { items: Transaction[]; accounts: Account[] }) {
  if (items.length === 0) return null
  const names = new Map(accounts.map((a) => [a.id, a.name]))
  return (
    <section className="import-section" aria-labelledby="attention-heading">
      <h2 className="import-heading" id="attention-heading">
        Needs attention
      </h2>
      <ul className="history-list">
        {items.map((t) => (
          <li key={t.id} className="attention-item">
            <p className="history-name">{t.description}</p>
            <p className="history-meta">
              {formatDisplayDate(t.date)} · {names.get(t.accountId) ?? 'Unknown account'} · <Money pence={t.amountPence} tone="auto" />
            </p>
            <p className="attention-why">
              Import the statement for your card to match this payment. Until then it isn&apos;t counted as spending.
            </p>
          </li>
        ))}
      </ul>
    </section>
  )
}
