import { useState } from 'react'
import { sinkingMonthlyPence } from '../../../budget/summary'
import { formatGBP } from '../../../domain/money'
import type { SinkingFund } from '../../../domain/types'
import type { BudgetDB } from '../../../storage/db'
import ConfirmDialog from '../../components/ConfirmDialog'
import Money from '../../components/Money'
import { Button, MoneyInput, Select, TextInput } from '../../components/forms'
import { MONTH_NAMES, MONTH_OPTIONS, monthlySetAside, sinkingFromDraft, sinkingRowValid, type SinkingDraft } from '../wizardModel'
import { deleteSinkingFund, saveSinkingFund } from './debtsDb'
import { draftFromSinking } from './debtsModel'
import ItemForm from './ItemForm'
import { useCrud } from './useCrud'

const newId = () => globalThis.crypto.randomUUID()

function SinkingForm({ fund, busy, error, onSave, onCancel }: {
  fund?: SinkingFund
  busy: boolean
  error?: string
  onSave: (fund: SinkingFund) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState<SinkingDraft>(() => (fund ? draftFromSinking(fund) : { id: newId(), name: '', yearly: '', dueMonth: '1' }))
  const [attempted, setAttempted] = useState(false)
  const valid = sinkingRowValid(draft)
  const monthly = monthlySetAside(draft.yearly)
  return (
    <ItemForm
      title={fund ? `Edit ${fund.name}` : 'Add a yearly bill'}
      submitLabel={fund ? 'Save changes' : 'Add bill'}
      busy={busy}
      error={error || (attempted && !valid ? 'Fix the highlighted fields to continue.' : undefined)}
      onSubmit={() => (valid ? onSave(sinkingFromDraft(draft)) : setAttempted(true))}
      onCancel={onCancel}
    >
      <TextInput label="Bill name" value={draft.name} onChange={(name) => setDraft({ ...draft, name })}
        error={attempted && draft.name.trim() === '' ? 'Enter a name' : undefined} />
      <MoneyInput label="Yearly amount" required showErrors={attempted} value={draft.yearly} onChange={(yearly) => setDraft({ ...draft, yearly })} />
      <Select label="Due month" value={draft.dueMonth} options={MONTH_OPTIONS} onChange={(dueMonth) => setDraft({ ...draft, dueMonth })} />
      <p className="set-aside" aria-live="polite">
        {monthly === undefined ? 'Monthly set-aside: enter a yearly amount' : `Monthly set-aside: ${formatGBP(monthly)}`}
      </p>
    </ItemForm>
  )
}

export default function SinkingSection({ db, funds }: { db: BudgetDB; funds: SinkingFund[] }) {
  const crud = useCrud<SinkingFund>(
    { save: (f) => saveSinkingFund(db, f), remove: (f) => deleteSinkingFund(db, f.id) },
    { heading: 'annual-heading', add: 'add-bill' },
  )
  return (
    <section className="import-section" aria-labelledby="annual-heading">
      <h2 className="import-heading" id="annual-heading" tabIndex={-1}>
        Yearly bills
      </h2>
      <div role="status" className="result-line">{crud.notice}</div>
      {funds.length === 0 && <p className="import-hint">No yearly bills yet. Add insurance or car tax and the app sets aside a twelfth each month.</p>}
      <ul className="item-list">
        {funds.map((f) => (
          <li key={f.id} className="debt">
            <div className="item-head">
              <p className="item-name">{f.name}</p>
              <p className="item-amount"><Money pence={f.yearlyAmountPence} /></p>
            </div>
            <p className="item-meta">
              <span>{`Due in ${MONTH_NAMES[f.dueMonth - 1]}`}</span>
              <span>{`Set aside ${formatGBP(sinkingMonthlyPence([f]))} a month`}</span>
            </p>
            <div className="item-actions">
              <Button variant="secondary" id={`edit-${f.id}`} onClick={() => (crud.editing === f.id ? crud.close(`edit-${f.id}`) : crud.open(f.id))}>
                Edit{' '}<span className="sr-only">{`${f.name}`}</span>
              </Button>
              <Button variant="secondary" onClick={() => crud.setDeleting(f)}>
                Delete{' '}<span className="sr-only">{`${f.name}`}</span>
              </Button>
            </div>
            {crud.editing === f.id && (
              <SinkingForm fund={f} busy={crud.busy} error={crud.error} onSave={(x) => void crud.save(x)} onCancel={() => crud.close(`edit-${f.id}`)} />
            )}
          </li>
        ))}
      </ul>
      {funds.length > 0 && (
        <dl className="totals">
          <div><dt>Set aside each month</dt><dd><Money pence={sinkingMonthlyPence(funds)} /></dd></div>
        </dl>
      )}
      <Button variant="secondary" id="add-bill" aria-expanded={crud.editing === 'new'}
        onClick={() => (crud.editing === 'new' ? crud.close('add-bill') : crud.open('new'))}>
        Add a yearly bill
      </Button>
      {crud.editing === 'new' && <SinkingForm busy={crud.busy} error={crud.error} onSave={(x) => void crud.save(x)} onCancel={() => crud.close('add-bill')} />}
      {crud.deleting && (
        <ConfirmDialog title={`Delete ${crud.deleting.name}?`} confirmLabel="Delete" busy={crud.busy} error={crud.deleteError}
          fallbackFocusId="annual-heading" onCancel={() => { crud.setDeleting(null); crud.setDeleteError('') }}
          onConfirm={() => void crud.confirmDelete()}>
          This removes the yearly bill. It cannot be undone.
        </ConfirmDialog>
      )}
    </section>
  )
}
