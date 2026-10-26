import { useState } from 'react'
import type { Debt } from '../../../domain/types'
import { MoneyInput, NumberInput, Select, TextInput } from '../../components/forms'
import { parseMoney } from '../../formValues'
import {
  DEBT_KIND_OPTIONS, aprOk, debtFromDraft, debtRowValid, isoDateOk, type DebtDraft,
} from '../wizardModel'
import { MAX_APR, draftFromDebt } from './debtsModel'
import ItemForm from './ItemForm'

interface Props {
  debt?: Debt
  busy: boolean
  error?: string
  newId: () => string
  onSave: (debt: Debt) => void
  onCancel: () => void
}

const blank = (s: string) => s.trim() === ''
const negative = (s: string) => {
  const r = parseMoney(s)
  return r.ok && r.pence < 0
}

export default function DebtForm({ debt, busy, error, newId, onSave, onCancel }: Props) {
  const [draft, setDraft] = useState<DebtDraft>(
    () => (debt ? draftFromDebt(debt) : {
      id: newId(), name: '', kind: 'card', balance: '', apr: '', minimum: '', limit: '', promoApr: '', promoEnds: '',
    }),
  )
  const [attempted, setAttempted] = useState(false)
  const upd = (p: Partial<DebtDraft>) => setDraft({ ...draft, ...p })
  const promoGiven = !blank(draft.promoApr) || !blank(draft.promoEnds)
  const aprError = `Enter a rate from 0 to ${MAX_APR}, like 22.9`
  const anyNegative = [draft.balance, draft.minimum, draft.limit].some(negative)

  function submit() {
    if (!debtRowValid(draft, MAX_APR)) return setAttempted(true)
    onSave(debtFromDraft(draft))
  }

  return (
    <ItemForm
      title={debt ? `Edit ${debt.name}` : 'Add a debt'}
      submitLabel={debt ? 'Save changes' : 'Add debt'}
      busy={busy}
      error={error || (attempted && !debtRowValid(draft, MAX_APR) ? 'Fix the highlighted fields to continue.' : undefined)}
      onSubmit={submit}
      onCancel={onCancel}
    >
      <TextInput label="Debt name" value={draft.name} onChange={(name) => upd({ name })}
        error={attempted && blank(draft.name) ? 'Enter a name' : undefined} />
      <Select label="Kind" value={draft.kind} options={DEBT_KIND_OPTIONS} onChange={(kind) => upd({ kind })} />
      <MoneyInput label="Balance" required showErrors={attempted} value={draft.balance} onChange={(balance) => upd({ balance })} />
      <NumberInput label="APR" suffix="%" value={draft.apr} onChange={(apr) => upd({ apr })}
        error={attempted && !aprOk(draft.apr, true, MAX_APR) ? aprError : undefined} />
      <MoneyInput label="Minimum payment" required showErrors={attempted} value={draft.minimum} onChange={(minimum) => upd({ minimum })} />
      <MoneyInput label="Credit limit (cards) or original amount (loans)" showErrors={attempted} value={draft.limit}
        onChange={(limit) => upd({ limit })} />
      <NumberInput label="Promo APR" suffix="%, optional" value={draft.promoApr} onChange={(promoApr) => upd({ promoApr })}
        error={attempted && promoGiven && !aprOk(draft.promoApr, true, MAX_APR) ? 'Enter the promo rate, for example 0' : undefined} />
      <TextInput label="Promo end date" type="date" value={draft.promoEnds} onChange={(promoEnds) => upd({ promoEnds })}
        hint="Optional. Fill in both promo fields or neither."
        error={attempted && promoGiven && !isoDateOk(draft.promoEnds) ? 'Choose the date the promotion ends' : undefined} />
      {attempted && anyNegative && <p className="field-error">Amounts cannot be negative.</p>}
    </ItemForm>
  )
}
