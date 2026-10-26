import { useState, type FormEvent } from 'react'
import type { Account, AccountKind } from '../../../domain/types'
import { Button, Select, TextInput } from '../../components/forms'
import { useDb } from '../../useDb'

const KINDS: { value: AccountKind; label: string }[] = [
  { value: 'current', label: 'Current account' },
  { value: 'savings', label: 'Savings account' },
  { value: 'creditCard', label: 'Credit card' },
  { value: 'business', label: 'Business account' },
]

/** Adds one account (name, bank, kind). Calls `onAdded` with it once stored. */
export default function AddAccountForm({ onAdded, onCancel }: { onAdded: (a: Account) => void; onCancel?: () => void }) {
  const db = useDb()
  const [name, setName] = useState('')
  const [bank, setBank] = useState('')
  const [kind, setKind] = useState<AccountKind>('current')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    if (!name.trim()) {
      setError('Enter a name for the account, like Everyday current.')
      return
    }
    setBusy(true)
    const account: Account = { id: crypto.randomUUID(), name: name.trim(), bank: bank.trim(), kind }
    try {
      await db.accounts.put(account)
      onAdded(account)
    } catch {
      setError("Couldn't save the account. Try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="import-form" onSubmit={(e) => void submit(e)} aria-label="Add account">
      <TextInput label="Account name" value={name} onChange={setName} error={error || undefined} />
      <TextInput label="Bank" value={bank} onChange={setBank} />
      <Select
        label="Kind"
        value={kind}
        options={KINDS}
        onChange={setKind}
        hint={kind === 'business' ? 'Business accounts are excluded from your spending.' : undefined}
      />
      <div className="import-actions">
        <Button variant="primary" type="submit" disabled={busy} aria-busy={busy}>
          Add account
        </Button>
        {onCancel && <Button onClick={onCancel}>Cancel</Button>}
      </div>
    </form>
  )
}
