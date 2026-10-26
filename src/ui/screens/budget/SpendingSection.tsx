import { useEffect, useRef, useState } from 'react'
import type { Account, Category, Transaction } from '../../../domain/types'
import { similarTransactionIds, type BudgetRow } from './budgetModel'
import { recategorise, setFlag, setLimit } from './budgetDb'
import CategoryRow from './CategoryRow'
import RecategoriseDialog from './RecategoriseDialog'
import { plural } from '../import/importFlow'
import type { BudgetDB } from '../../../storage/db'

interface Props {
  db: BudgetDB
  rows: BudgetRow[]
  monthTxs: Transaction[]
  allTxs: Transaction[]
  accounts: Account[]
  categories: Category[]
}

export default function SpendingSection({ db, rows, monthTxs, allTxs, accounts, categories }: Props) {
  const [openId, setOpenId] = useState<string | null>(null)
  const [editing, setEditing] = useState<Transaction | null>(null)
  const [busy, setBusy] = useState(false)
  const [dialogError, setDialogError] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const focusTarget = useRef('')
  const [focusTick, setFocusTick] = useState(0)

  // The changed row leaves its list, so focus goes to the category row instead of the vanished button.
  useEffect(() => {
    if (focusTick > 0) document.getElementById(focusTarget.current)?.focus()
  }, [focusTick])

  async function guarded(work: () => Promise<string>) {
    setError('')
    try {
      setNotice(await work())
    } catch {
      setNotice('')
      setError("Couldn't save that. Nothing was changed.")
    }
  }

  async function save(categoryId: string, applyToSimilar: boolean) {
    if (!editing) return
    setBusy(true)
    setDialogError('')
    try {
      const { othersChanged } = await recategorise(db, editing.id, categoryId, applyToSimilar)
      setNotice(othersChanged > 0 ? `Updated ${plural(othersChanged, 'similar transaction')}.` : 'Category changed.')
      setError('')
      setEditing(null)
      focusTarget.current = openId ? `cat-${openId}` : 'spending-heading'
      setFocusTick((n) => n + 1)
    } catch {
      setDialogError("Couldn't save that. Nothing was changed.")
    } finally {
      setBusy(false)
    }
  }

  const similarCount = editing ? Math.max(0, similarTransactionIds(allTxs, editing).length - 1) : 0
  return (
    <section className="import-section" aria-labelledby="spending-heading">
      <h2 className="import-heading" id="spending-heading" tabIndex={-1}>
        Spending
      </h2>
      <div role="status" className="result-line">
        {notice}
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <ul className="cat-list" aria-label="Spending by category">
        {rows.map((row) => (
          <CategoryRow
            key={row.id}
            row={row}
            expanded={openId === row.id}
            monthTxs={monthTxs}
            accounts={accounts}
            onToggle={() => setOpenId(openId === row.id ? null : row.id)}
            onSaveLimit={(pence) =>
              void guarded(async () => {
                await setLimit(db, row.id, pence)
                return pence > 0 ? `Limit saved for ${row.name}.` : `Limit removed for ${row.name}.`
              })
            }
            onChangeCategory={setEditing}
            onFlag={(tx, flag, value) =>
              void guarded(async () => {
                await setFlag(db, tx.id, flag, value)
                return flag === 'isRefund' ? (value ? 'Marked as a refund.' : 'No longer a refund.') : value ? 'Marked as a transfer.' : 'No longer a transfer.'
              })
            }
          />
        ))}
      </ul>
      {editing && (
        <RecategoriseDialog
          tx={editing}
          categories={categories}
          similarCount={similarCount}
          busy={busy}
          error={dialogError}
          fallbackFocusId={openId ? `cat-${openId}` : 'spending-heading'}
          onCancel={() => { setEditing(null); setDialogError('') }}
          onSave={(c, all) => void save(c, all)}
        />
      )}
    </section>
  )
}
