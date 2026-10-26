import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { taxYearOf } from '../../domain/dates'
import { formatGBP } from '../../domain/money'
import type { AccountKind, Debt, Holding, Platform, Settings, Wrapper } from '../../domain/types'
import { Button, Checkbox, MoneyInput, NumberInput, RowEditor, Select, TextInput } from '../components/forms'
import { todayISO } from '../formValues'
import { useDb } from '../useDb'
import { validateMonthStartDay, validatePercent } from './settingsValidation'
import {
  WIZARD_STEPS, aprOk, buildWrites, emptyDraft, isoDateOk, monthlySetAside, stepValid,
  type StepIndex, type WizardDraft,
} from './wizardModel'

const ACCOUNT_KINDS: { value: AccountKind; label: string }[] = [
  { value: 'current', label: 'Current account' },
  { value: 'savings', label: 'Savings account' },
  { value: 'creditCard', label: 'Credit card' },
  { value: 'business', label: 'Business account' },
]
const DEBT_KINDS: { value: Debt['kind']; label: string }[] = [
  { value: 'card', label: 'Credit card' },
  { value: 'loan', label: 'Loan' },
  { value: 'other', label: 'Other' },
]
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
].map((label, i) => ({ value: String(i + 1), label }))
const WRAPPER_LABELS: Record<Wrapper, string> = {
  isa: 'Stocks and shares ISA', lisa: 'Lifetime ISA', pension: 'Pension (SIPP)', gia: 'General investment account',
}

const NAME_ERROR = 'Enter a name'

interface StepProps {
  draft: WizardDraft
  setDraft: (next: WizardDraft) => void
  attempted: boolean
  newId: () => string
  today: string
  settings: Settings
  holdings: Holding[]
  platforms: Platform[]
}

function replaceAt<T>(list: T[], index: number, next: T): T[] {
  return list.map((x, i) => (i === index ? next : x))
}

function AccountsStep({ draft, setDraft, attempted, newId }: StepProps) {
  const set = (accounts: WizardDraft['accounts']) => setDraft({ ...draft, accounts })
  return (
    <>
      <p className="step-intro">Add the accounts you will import statements from. You can add more later.</p>
      <RowEditor
        items={draft.accounts}
        getKey={(a) => a.id}
        noun="account"
        emptyText="No accounts added yet."
        onAdd={() => set([...draft.accounts, { id: newId(), name: '', bank: '', kind: 'current' }])}
        onRemove={(a) => set(draft.accounts.filter((x) => x.id !== a.id))}
        renderRow={(a, i) => (
          <>
            <TextInput
              label="Account name"
              value={a.name}
              error={attempted && !a.name.trim() ? NAME_ERROR : undefined}
              onChange={(name) => set(replaceAt(draft.accounts, i, { ...a, name }))}
            />
            <TextInput label="Bank" value={a.bank} onChange={(bank) => set(replaceAt(draft.accounts, i, { ...a, bank }))} />
            <Select
              label="Kind"
              value={a.kind}
              options={ACCOUNT_KINDS}
              onChange={(kind) => set(replaceAt(draft.accounts, i, { ...a, kind }))}
              hint={a.kind === 'business' ? 'Business accounts are excluded from your spending.' : undefined}
            />
          </>
        )}
      />
    </>
  )
}

function IncomeStep({ draft, setDraft, attempted, newId }: StepProps) {
  const set = (incomes: WizardDraft['incomes']) => setDraft({ ...draft, incomes })
  return (
    <>
      <p className="step-intro">Add each regular income, such as a salary. Use what lands in your account after tax.</p>
      <RowEditor
        items={draft.incomes}
        getKey={(x) => x.id}
        noun="income stream"
        emptyText="No income streams added yet."
        onAdd={() => set([...draft.incomes, { id: newId(), label: '', amount: '' }])}
        onRemove={(x) => set(draft.incomes.filter((y) => y.id !== x.id))}
        renderRow={(x, i) => (
          <>
            <TextInput
              label="Income name"
              value={x.label}
              error={attempted && !x.label.trim() ? NAME_ERROR : undefined}
              onChange={(label) => set(replaceAt(draft.incomes, i, { ...x, label }))}
            />
            <MoneyInput
              label="Expected monthly net amount"
              required
              showErrors={attempted}
              value={x.amount}
              onChange={(amount) => set(replaceAt(draft.incomes, i, { ...x, amount }))}
            />
          </>
        )}
      />
    </>
  )
}

function DebtsStep({ draft, setDraft, attempted, newId }: StepProps) {
  const set = (debts: WizardDraft['debts']) => setDraft({ ...draft, debts })
  return (
    <>
      <p className="step-intro">Add cards, loans and anything else you are paying off.</p>
      <RowEditor
        items={draft.debts}
        getKey={(x) => x.id}
        noun="debt"
        emptyText="No debts added yet."
        onAdd={() =>
          set([
            ...draft.debts,
            {
              id: newId(), name: '', kind: 'card', balance: '', apr: '', minimum: '', limit: '', promoApr: '', promoEnds: '',
            },
          ])
        }
        onRemove={(x) => set(draft.debts.filter((y) => y.id !== x.id))}
        renderRow={(x, i) => {
          const upd = (p: Partial<typeof x>) => set(replaceAt(draft.debts, i, { ...x, ...p }))
          const promoGiven = x.promoApr.trim() !== '' || x.promoEnds.trim() !== ''
          return (
            <>
              <TextInput label="Debt name" value={x.name} onChange={(name) => upd({ name })}
                error={attempted && !x.name.trim() ? NAME_ERROR : undefined} />
              <Select label="Kind" value={x.kind} options={DEBT_KINDS} onChange={(kind) => upd({ kind })} />
              <MoneyInput label="Balance" required showErrors={attempted} value={x.balance}
                onChange={(balance) => upd({ balance })} />
              <NumberInput label="APR" suffix="%" value={x.apr} onChange={(apr) => upd({ apr })}
                error={attempted && !aprOk(x.apr, true) ? 'Enter a rate like 22.9' : undefined} />
              <MoneyInput label="Minimum payment" required showErrors={attempted} value={x.minimum}
                onChange={(minimum) => upd({ minimum })} />
              <MoneyInput label="Credit limit (cards) or original amount (loans)" showErrors={attempted} value={x.limit}
                onChange={(limit) => upd({ limit })} />
              <NumberInput label="Promo APR" suffix="%, optional" value={x.promoApr} onChange={(promoApr) => upd({ promoApr })}
                error={attempted && promoGiven && x.promoApr.trim() === '' ? 'Enter the promo rate, for example 0' : undefined} />
              <TextInput label="Promo end date" type="date" value={x.promoEnds} onChange={(promoEnds) => upd({ promoEnds })}
                hint="Optional. Fill in both promo fields or neither."
                error={attempted && promoGiven && !isoDateOk(x.promoEnds) ? 'Choose the date the promotion ends' : undefined} />
            </>
          )
        }}
      />
    </>
  )
}

function PotsStep({ draft, setDraft, attempted, newId }: StepProps) {
  const set = (pots: WizardDraft['pots']) => setDraft({ ...draft, pots })
  return (
    <>
      <p className="step-intro">Add savings pots. Mark one as your emergency fund so the plan can top it up first.</p>
      <RowEditor
        items={draft.pots}
        getKey={(x) => x.id}
        noun="savings pot"
        emptyText="No savings pots added yet."
        onAdd={() => set([...draft.pots, { id: newId(), name: '', balance: '', target: '', emergency: false }])}
        onRemove={(x) => set(draft.pots.filter((y) => y.id !== x.id))}
        renderRow={(x, i) => (
          <>
            <TextInput label="Pot name" value={x.name} onChange={(name) => set(replaceAt(draft.pots, i, { ...x, name }))}
              error={attempted && !x.name.trim() ? NAME_ERROR : undefined} />
            <MoneyInput label="Balance" required showErrors={attempted} value={x.balance}
              onChange={(balance) => set(replaceAt(draft.pots, i, { ...x, balance }))} />
            <MoneyInput label="Target amount" showErrors={attempted} value={x.target}
              hint="Optional. For an emergency fund, a few months of spending is a common target."
              onChange={(target) => set(replaceAt(draft.pots, i, { ...x, target }))} />
            <Checkbox
              label="This is my emergency fund"
              checked={x.emergency}
              onChange={(emergency) =>
                set(draft.pots.map((p, j) => (j === i ? { ...p, emergency } : emergency ? { ...p, emergency: false } : p)))
              }
            />
          </>
        )}
      />
    </>
  )
}

function SinkingStep({ draft, setDraft, attempted, newId }: StepProps) {
  const set = (sinkingFunds: WizardDraft['sinkingFunds']) => setDraft({ ...draft, sinkingFunds })
  return (
    <>
      <p className="step-intro">Add yearly bills, such as insurance or car tax. The app sets aside one twelfth each month.</p>
      <RowEditor
        items={draft.sinkingFunds}
        getKey={(x) => x.id}
        noun="yearly bill"
        emptyText="No yearly bills added yet."
        onAdd={() => set([...draft.sinkingFunds, { id: newId(), name: '', yearly: '', dueMonth: '1' }])}
        onRemove={(x) => set(draft.sinkingFunds.filter((y) => y.id !== x.id))}
        renderRow={(x, i) => {
          const monthly = monthlySetAside(x.yearly)
          return (
            <>
              <TextInput label="Bill name" value={x.name} onChange={(name) => set(replaceAt(draft.sinkingFunds, i, { ...x, name }))}
                error={attempted && !x.name.trim() ? NAME_ERROR : undefined} />
              <MoneyInput label="Yearly amount" required showErrors={attempted} value={x.yearly}
                onChange={(yearly) => set(replaceAt(draft.sinkingFunds, i, { ...x, yearly }))} />
              <Select label="Due month" value={x.dueMonth} options={MONTHS}
                onChange={(dueMonth) => set(replaceAt(draft.sinkingFunds, i, { ...x, dueMonth }))} />
              <p className="set-aside" aria-live="polite">
                {monthly === undefined ? 'Monthly set-aside: enter a yearly amount' : `Monthly set-aside: ${formatGBP(monthly)}`}
              </p>
            </>
          )
        }}
      />
    </>
  )
}

function AllowancesStep({ draft, setDraft, attempted, today, settings }: StepProps) {
  const year = taxYearOf(today)
  const set = (p: Partial<WizardDraft['allowanceUsed']>) => setDraft({ ...draft, allowanceUsed: { ...draft.allowanceUsed, ...p } })
  const limits = settings.allowances[year] ?? {}
  const limitHint = (w: Wrapper) => (limits[w] !== undefined ? `Yearly limit ${formatGBP(limits[w])}` : undefined)
  return (
    <>
      <p className="step-intro">
        {`Enter what you have already paid in during the ${year} tax year, including through payroll. Leave a box blank if nothing.`}
      </p>
      <Checkbox
        label="I'm eligible for a Lifetime ISA"
        checked={draft.lisaEnabled}
        onChange={(lisaEnabled) => setDraft({ ...draft, lisaEnabled })}
        hint="Turn this on only if you're eligible for a Lifetime ISA."
      />
      <MoneyInput label="Stocks and shares ISA used" showErrors={attempted} value={draft.allowanceUsed.isa}
        hint={limitHint('isa')} onChange={(isa) => set({ isa })} />
      {draft.lisaEnabled && (
        <MoneyInput label="Lifetime ISA used" showErrors={attempted} value={draft.allowanceUsed.lisa}
          hint={limitHint('lisa')} onChange={(lisa) => set({ lisa })} />
      )}
      <MoneyInput label="Pension used" showErrors={attempted} value={draft.allowanceUsed.pension}
        hint={limitHint('pension')} onChange={(pension) => set({ pension })} />
    </>
  )
}

function HoldingsStep({ draft, setDraft, attempted, holdings, platforms }: StepProps) {
  const wrappers: Wrapper[] = draft.lisaEnabled ? ['isa', 'lisa', 'pension', 'gia'] : ['isa', 'pension', 'gia']
  return (
    <>
      <p className="step-intro">
        If you already hold any of these funds, enter today&apos;s value. Leave the rest blank. These are examples, not recommendations.
      </p>
      <div className="rows">
        {holdings.map((h) => {
          const row = draft.holdings[h.id]
          const upd = (p: Partial<typeof row>) => setDraft({ ...draft, holdings: { ...draft.holdings, [h.id]: { ...row, ...p } } })
          return (
            <fieldset className="row-card" key={h.id}>
              <legend className="row-legend">{`${h.exampleName} (${h.ticker})`}</legend>
              <div className="row-fields">
                <MoneyInput label="Current value" showErrors={attempted} value={row.value} onChange={(value) => upd({ value })} />
                <Select label="Held in" value={row.wrapper} options={wrappers.map((w) => ({ value: w, label: WRAPPER_LABELS[w] }))}
                  onChange={(wrapper) => upd({ wrapper })} />
                <Select label="Platform" value={row.platformId}
                  options={platforms.map((p) => ({ value: p.id, label: p.name }))} onChange={(platformId) => upd({ platformId })} />
              </div>
            </fieldset>
          )
        })}
      </div>
    </>
  )
}

function BasicsStep({ draft, setDraft }: StepProps) {
  return (
    <>
      <p className="step-intro">These are the defaults. You can change them any time in Settings.</p>
      <NumberInput label="Budget month start day" hint="Day of the month your budget month begins, 1 to 28. Use your pay day if it suits you."
        value={draft.startDay} onChange={(startDay) => setDraft({ ...draft, startDay })}
        error={validateMonthStartDay(draft.startDay)} />
      <NumberInput label="APR threshold" suffix="%" hint="Debts above this rate are paid off before you invest."
        value={draft.aprThreshold} onChange={(aprThreshold) => setDraft({ ...draft, aprThreshold })}
        error={validatePercent(draft.aprThreshold)} />
      <NumberInput label="Safety buffer" suffix="%" hint="The share of your leftover money held back before anything is invested."
        value={draft.buffer} onChange={(buffer) => setDraft({ ...draft, buffer })} error={validatePercent(draft.buffer)} />
    </>
  )
}

const STEP_COMPONENTS: Record<StepIndex, (p: StepProps) => ReactNode> = {
  0: AccountsStep, 1: IncomeStep, 2: DebtsStep, 3: PotsStep, 4: SinkingStep, 5: AllowancesStep, 6: HoldingsStep, 7: BasicsStep,
}

/** Which draft slice "Skip step" discards. */
function clearStep(step: StepIndex, d: WizardDraft, fresh: WizardDraft): WizardDraft {
  switch (step) {
    case 0: return { ...d, accounts: [] }
    case 1: return { ...d, incomes: [] }
    case 2: return { ...d, debts: [] }
    case 3: return { ...d, pots: [] }
    case 4: return { ...d, sinkingFunds: [] }
    case 5: return { ...d, allowanceUsed: fresh.allowanceUsed, lisaEnabled: fresh.lisaEnabled }
    case 6: return { ...d, holdings: fresh.holdings }
    case 7: return { ...d, startDay: fresh.startDay, aprThreshold: fresh.aprThreshold, buffer: fresh.buffer }
  }
}

interface WizardFormProps {
  settings: Settings
  holdings: Holding[]
  platforms: Platform[]
  today: string
}

function WizardForm({ settings, holdings, platforms, today }: WizardFormProps) {
  const db = useDb()
  const [fresh] = useState(() => emptyDraft({ settings, holdings, platforms }))
  const [draft, setDraft] = useState(fresh)
  const [step, setStep] = useState<StepIndex>(0)
  const [attempted, setAttempted] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const last = step === WIZARD_STEPS.length - 1
  const newId = () => globalThis.crypto.randomUUID()

  useEffect(() => {
    heading.current?.focus()
  }, [step])

  function go(next: number) {
    setStep(next as StepIndex)
    setAttempted(false)
    setError('')
  }

  async function skipSetup() {
    setBusy(true)
    try {
      await db.settings.update('main', { onboardingDone: true })
    } catch {
      setError("Couldn't save that. Try again.")
      setBusy(false)
    }
  }

  /** One transaction: nothing is written until here, so a failure leaves the database untouched. */
  async function save(d: WizardDraft) {
    const w = buildWrites(d, { today, holdings, platforms, settings, newId })
    setBusy(true)
    try {
      await db.transaction(
        'rw',
        [db.accounts, db.incomeStreams, db.debts, db.savingsPots, db.sinkingFunds, db.allowancesUsed, db.openingHoldings, db.settings],
        async () => {
          await db.accounts.bulkPut(w.accounts)
          await db.incomeStreams.bulkPut(w.incomeStreams)
          await db.debts.bulkPut(w.debts)
          await db.savingsPots.bulkPut(w.savingsPots)
          await db.sinkingFunds.bulkPut(w.sinkingFunds)
          await db.allowancesUsed.bulkPut(w.allowancesUsed)
          await db.openingHoldings.bulkPut(w.openingHoldings)
          await db.settings.update('main', w.settingsPatch)
        },
      )
    } catch {
      setError("Couldn't save your setup. Nothing was changed. Try again.")
      setBusy(false)
    }
  }

  function next() {
    if (!stepValid(step, draft)) {
      setAttempted(true)
      return
    }
    if (last) void save(draft)
    else go(step + 1)
  }

  const Body = STEP_COMPONENTS[step]
  return (
    <main className="wizard" id="main" tabIndex={-1}>
      <div className="wizard-inner">
        <header className="wizard-head">
          <p className="wizard-progress">{`Step ${step + 1} of ${WIZARD_STEPS.length}`}</p>
          <Button variant="secondary" className="wizard-skip" onClick={() => void skipSetup()} disabled={busy}>
            Skip setup
          </Button>
        </header>
        <h1 className="page-title wizard-title" tabIndex={-1} ref={heading}>
          {WIZARD_STEPS[step]}
        </h1>
        <form
          className="wizard-body"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            next()
          }}
        >
          <Body
            draft={draft}
            setDraft={setDraft}
            attempted={attempted}
            newId={newId}
            today={today}
            settings={settings}
            holdings={holdings}
            platforms={platforms}
          />
          {attempted && !stepValid(step, draft) && (
            <p className="form-error" role="alert">
              Fix the highlighted fields to continue.
            </p>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="wizard-actions">
            <Button variant="secondary" onClick={() => go(step - 1)} disabled={step === 0 || busy}>
              Back
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                const cleared = clearStep(step, draft, fresh)
                setDraft(cleared)
                if (last) void save(cleared)
                else go(step + 1)
              }}
            >
              Skip step
            </Button>
            <Button variant="primary" type="submit" disabled={busy}>
              {last ? 'Finish' : 'Next'}
            </Button>
          </div>
        </form>
      </div>
    </main>
  )
}

export default function Wizard({ today = todayISO() }: { today?: string }) {
  const db = useDb()
  const data = useLiveQuery(async () => ({
    settings: await db.settings.get('main'),
    holdings: (await db.holdings.toArray()).sort(
      (a, b) => Number(a.bucket !== 'growth') - Number(b.bucket !== 'growth') || b.weight - a.weight || a.id.localeCompare(b.id),
    ),
    platforms: await db.platforms.toArray(),
  }), [db])
  if (!data?.settings) return <div className="loading" role="status">Loading</div>
  return <WizardForm settings={data.settings} holdings={data.holdings} platforms={data.platforms} today={today} />
}
