import { useState } from 'react'
import { formatGBP } from '../../../domain/money'
import type { SavingsPot } from '../../../domain/types'
import type { BudgetDB } from '../../../storage/db'
import ConfirmDialog from '../../components/ConfirmDialog'
import Money from '../../components/Money'
import { Button, Checkbox, MoneyInput, TextInput } from '../../components/forms'
import { potFromDraft, potRowValid, type PotDraft } from '../wizardModel'
import { deletePot, savePot } from './debtsDb'
import { draftFromPot } from './debtsModel'
import ItemForm from './ItemForm'
import { useCrud } from './useCrud'

const newId = () => globalThis.crypto.randomUUID()

function PotForm({ pot, busy, error, onSave, onCancel }: {
  pot?: SavingsPot
  busy: boolean
  error?: string
  onSave: (pot: SavingsPot) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState<PotDraft>(() => (pot ? draftFromPot(pot) : { id: newId(), name: '', balance: '', target: '', emergency: false }))
  const [attempted, setAttempted] = useState(false)
  const valid = potRowValid(draft)
  return (
    <ItemForm
      title={pot ? `Edit ${pot.name}` : 'Add a savings pot'}
      submitLabel={pot ? 'Save changes' : 'Add pot'}
      busy={busy}
      error={error || (attempted && !valid ? 'Fix the highlighted fields to continue.' : undefined)}
      onSubmit={() => (valid ? onSave(potFromDraft(draft)) : setAttempted(true))}
      onCancel={onCancel}
    >
      <TextInput label="Pot name" value={draft.name} onChange={(name) => setDraft({ ...draft, name })}
        error={attempted && draft.name.trim() === '' ? 'Enter a name' : undefined} />
      <MoneyInput label="Balance" required showErrors={attempted} value={draft.balance} onChange={(balance) => setDraft({ ...draft, balance })} />
      <MoneyInput label="Target amount" showErrors={attempted} value={draft.target} onChange={(target) => setDraft({ ...draft, target })}
        hint="Optional. For an emergency fund, a few months of spending is a common target." />
      <Checkbox label="This is my emergency fund" checked={draft.emergency} onChange={(emergency) => setDraft({ ...draft, emergency })}
        hint="Only one pot can be the emergency fund. Choosing this one clears the others." />
    </ItemForm>
  )
}

export default function SavingsSection({ db, pots }: { db: BudgetDB; pots: SavingsPot[] }) {
  const crud = useCrud<SavingsPot>(
    { save: (p) => savePot(db, p), remove: (p) => deletePot(db, p.id) },
    { heading: 'savings-heading', add: 'add-pot' },
  )
  return (
    <section className="import-section" aria-labelledby="savings-heading">
      <h2 className="import-heading" id="savings-heading" tabIndex={-1}>
        Savings
      </h2>
      <div role="status" className="result-line">{crud.notice}</div>
      {pots.length === 0 && <p className="import-hint">No savings pots yet. Add one to track progress towards a target.</p>}
      <ul className="item-list">
        {pots.map((p) => {
          const pct = p.targetPence > 0 ? Math.min(100, (p.balancePence / p.targetPence) * 100) : undefined
          const text = `${formatGBP(p.balancePence)} of ${formatGBP(p.targetPence)}`
          return (
            <li key={p.id} className="debt">
              <div className="item-head">
                <p className="item-name">
                  {p.name} {p.isEmergencyFund && <span className="chip">Emergency fund</span>}
                </p>
                <p className="item-amount"><Money pence={p.balancePence} /></p>
              </div>
              {pct !== undefined && (
                <>
                  <p className="item-meta"><span>{text}</span></p>
                  <div className="bar" role="progressbar" aria-label={`${p.name}: ${text}`} aria-valuemin={0} aria-valuemax={p.targetPence}
                    aria-valuenow={Math.min(p.balancePence, p.targetPence)} aria-valuetext={text}>
                    <div className="bar-fill" style={{ width: `${pct}%` }} />
                  </div>
                </>
              )}
              <div className="item-actions">
                <Button variant="secondary" id={`edit-${p.id}`} onClick={() => (crud.editing === p.id ? crud.close(`edit-${p.id}`) : crud.open(p.id))}>
                  Edit{' '}<span className="sr-only">{`${p.name}`}</span>
                </Button>
                <Button variant="secondary" onClick={() => crud.setDeleting(p)}>
                  Delete{' '}<span className="sr-only">{`${p.name}`}</span>
                </Button>
              </div>
              {crud.editing === p.id && (
                <PotForm pot={p} busy={crud.busy} error={crud.error} onSave={(x) => void crud.save(x)} onCancel={() => crud.close(`edit-${p.id}`)} />
              )}
            </li>
          )
        })}
      </ul>
      <Button variant="secondary" id="add-pot" aria-expanded={crud.editing === 'new'}
        onClick={() => (crud.editing === 'new' ? crud.close('add-pot') : crud.open('new'))}>
        Add a savings pot
      </Button>
      {crud.editing === 'new' && <PotForm busy={crud.busy} error={crud.error} onSave={(x) => void crud.save(x)} onCancel={() => crud.close('add-pot')} />}
      {crud.deleting && (
        <ConfirmDialog title={`Delete ${crud.deleting.name}?`} confirmLabel="Delete" busy={crud.busy} error={crud.deleteError}
          fallbackFocusId="savings-heading" onCancel={() => { crud.setDeleting(null); crud.setDeleteError('') }}
          onConfirm={() => void crud.confirmDelete()}>
          This removes the savings pot. It cannot be undone.
        </ConfirmDialog>
      )}
    </section>
  )
}
