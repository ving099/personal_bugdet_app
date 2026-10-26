import type { Debt, ISODate, Pence } from '../../../domain/types'
import type { BudgetDB } from '../../../storage/db'
import ConfirmDialog from '../../components/ConfirmDialog'
import EmptyState from '../../components/EmptyState'
import Money from '../../components/Money'
import { Button } from '../../components/forms'
import DebtForm from './DebtForm'
import DebtRow from './DebtRow'
import { deleteDebt, saveDebt } from './debtsDb'
import { totalBalance, totalMinimums } from './debtsModel'
import PayoffTimeline from './PayoffTimeline'
import { useCrud } from './useCrud'

interface Props {
  db: BudgetDB
  debts: Debt[]
  today: ISODate
  extraDebtPence?: Pence
}

const newId = () => globalThis.crypto.randomUUID()

export default function DebtsSection({ db, debts, today, extraDebtPence }: Props) {
  const crud = useCrud<Debt>(
    { save: (d) => saveDebt(db, d), remove: (d) => deleteDebt(db, d.id) },
    { heading: 'debts-heading', add: 'add-debt' },
  )
  const addButton = (
    <Button variant="secondary" id="add-debt" aria-expanded={crud.editing === 'new'}
      onClick={() => (crud.editing === 'new' ? crud.close('add-debt') : crud.open('new'))}>
      Add a debt
    </Button>
  )
  return (
    <section className="import-section" aria-labelledby="debts-heading">
      <h2 className="import-heading" id="debts-heading" tabIndex={-1}>
        Debts
      </h2>
      <div role="status" className="result-line">{crud.notice}</div>
      {debts.length === 0 ? (
        <EmptyState title="No debts added" body="Add a card or loan to see how utilisation, interest and a payoff date look."
          action={addButton} />
      ) : (
        <>
          <ul className="item-list">
            {debts.map((d) => (
              <DebtRow key={d.id} debt={d} today={today}
                onEdit={() => (crud.editing === d.id ? crud.close(`edit-${d.id}`) : crud.open(d.id))}
                onDelete={() => crud.setDeleting(d)}>
                {crud.editing === d.id && (
                  <DebtForm debt={d} busy={crud.busy} error={crud.error} newId={newId} onSave={(x) => void crud.save(x)}
                    onCancel={() => crud.close(`edit-${d.id}`)} />
                )}
              </DebtRow>
            ))}
          </ul>
          <dl className="totals">
            <div><dt>Total balance</dt><dd><Money pence={totalBalance(debts)} /></dd></div>
            <div><dt>Total minimums</dt><dd><Money pence={totalMinimums(debts)} /></dd></div>
          </dl>
          {addButton}
        </>
      )}
      {crud.editing === 'new' && (
        <DebtForm busy={crud.busy} error={crud.error} newId={newId} onSave={(x) => void crud.save(x)}
          onCancel={() => crud.close('add-debt')} />
      )}
      {debts.length > 0 && <PayoffTimeline debts={debts} today={today} extraDebtPence={extraDebtPence} />}
      {crud.deleting && (
        <ConfirmDialog
          title={`Delete ${crud.deleting.name}?`}
          confirmLabel="Delete"
          busy={crud.busy}
          error={crud.deleteError}
          fallbackFocusId="debts-heading"
          onCancel={() => { crud.setDeleting(null); crud.setDeleteError('') }}
          onConfirm={() => void crud.confirmDelete()}
        >
          This removes the debt and changes your payoff timeline. It cannot be undone.
        </ConfirmDialog>
      )}
    </section>
  )
}
