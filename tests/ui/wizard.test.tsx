import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { openDb, type BudgetDB } from '../../src/storage/db'
import { seedDefaults } from '../../src/storage/seed'
import App from '../../src/ui/App'
import { DbProvider } from '../../src/ui/DbProvider'
import Wizard from '../../src/ui/screens/Wizard'

let counter = 0
const opened: BudgetDB[] = []

async function freshDb(): Promise<BudgetDB> {
  const db = openDb(`wizard-test-${Date.now()}-${counter++}`)
  opened.push(db)
  await seedDefaults(db)
  return db
}

afterEach(async () => {
  cleanup()
  window.localStorage.clear()
  for (const db of opened.splice(0)) {
    db.close()
    await Dexie.delete(db.name)
  }
})

function renderWizard(db: BudgetDB) {
  return render(
    <DbProvider db={db}>
      <Wizard today="2026-10-26" />
    </DbProvider>,
  )
}

const TABLES = [
  'accounts', 'incomeStreams', 'debts', 'savingsPots', 'sinkingFunds', 'allowancesUsed', 'openingHoldings',
] as const

describe('Setup wizard', () => {
  it('shows step n of 8 and steps through in order', async () => {
    const user = userEvent.setup()
    renderWizard(await freshDb())
    expect(await screen.findByText('Step 1 of 8')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Accounts' })).toBeInTheDocument()
    const titles = ['Income streams', 'Debts', 'Savings pots', 'Sinking funds', 'Allowances used this tax year',
      'Opening holdings', 'Settings basics']
    for (const [i, title] of titles.entries()) {
      await user.click(screen.getByRole('button', { name: 'Next' }))
      expect(screen.getByText(`Step ${i + 2} of 8`)).toBeInTheDocument()
      expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Skip setup' })).toBeInTheDocument()
    }
    expect(screen.getByRole('button', { name: 'Finish' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByText('Step 7 of 8')).toBeInTheDocument()
  })

  it('writes the expected rows on Finish', async () => {
    const user = userEvent.setup()
    const db = await freshDb()
    renderWizard(db)
    await screen.findByText('Step 1 of 8')

    // 1 accounts
    await user.click(screen.getByRole('button', { name: 'Add account' }))
    await user.type(screen.getByLabelText('Account name'), 'Business current')
    await user.type(screen.getByLabelText('Bank'), 'Monzo')
    await user.selectOptions(screen.getByLabelText('Kind'), 'business')
    expect(screen.getByText('Business accounts are excluded from your spending.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next' }))

    // 2 income
    await user.click(screen.getByRole('button', { name: 'Add income stream' }))
    await user.type(screen.getByLabelText('Income name'), 'Salary')
    await user.type(screen.getByLabelText('Expected monthly net amount'), '£2,500.50')
    await user.click(screen.getByRole('button', { name: 'Next' }))

    // 3 debts
    await user.click(screen.getByRole('button', { name: 'Add debt' }))
    await user.type(screen.getByLabelText('Debt name'), 'Barclaycard')
    await user.type(screen.getByLabelText('Balance'), '1,200')
    await user.type(screen.getByLabelText('APR (%)'), '22.9')
    await user.type(screen.getByLabelText('Minimum payment'), '35')
    await user.type(screen.getByLabelText('Credit limit (cards) or original amount (loans)'), '£3000')
    await user.type(screen.getByLabelText('Promo APR (%, optional)'), '0')
    fireEvent.change(screen.getByLabelText('Promo end date'), { target: { value: '2027-03-31' } })
    await user.click(screen.getByRole('button', { name: 'Next' }))

    // 4 savings pots
    await user.click(screen.getByRole('button', { name: 'Add savings pot' }))
    await user.type(screen.getByLabelText('Pot name'), 'Rainy day')
    await user.type(screen.getByLabelText('Balance'), '1000')
    await user.click(screen.getByLabelText('This is my emergency fund'))
    await user.click(screen.getByRole('button', { name: 'Next' }))

    // 5 sinking funds
    await user.click(screen.getByRole('button', { name: 'Add yearly bill' }))
    await user.type(screen.getByLabelText('Bill name'), 'Car insurance')
    await user.type(screen.getByLabelText('Yearly amount'), '£240')
    expect(screen.getByText('Monthly set-aside: £20.00')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Due month'), '6')
    await user.click(screen.getByRole('button', { name: 'Next' }))

    // 6 allowances used
    await user.type(screen.getByLabelText('Stocks and shares ISA used'), '5000')
    expect(screen.queryByLabelText('Lifetime ISA used')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next' }))

    // 7 opening holdings
    await user.type(screen.getAllByLabelText('Current value')[0], '1,500')
    await user.click(screen.getByRole('button', { name: 'Next' }))

    // 8 basics
    const day = screen.getByLabelText('Budget month start day')
    await user.clear(day)
    await user.type(day, '25')
    const apr = screen.getByLabelText('APR threshold (%)')
    await user.clear(apr)
    await user.type(apr, '8')
    const buffer = screen.getByLabelText('Safety buffer (%)')
    await user.clear(buffer)
    await user.type(buffer, '12')
    await user.click(screen.getByRole('button', { name: 'Finish' }))

    await waitFor(async () => expect((await db.settings.get('main'))?.onboardingDone).toBe(true))
    const accounts = await db.accounts.toArray()
    expect(accounts).toHaveLength(1)
    expect(accounts[0]).toMatchObject({ name: 'Business current', bank: 'Monzo', kind: 'business' })
    const incomes = await db.incomeStreams.toArray()
    expect(incomes[0]).toMatchObject({ label: 'Salary', expectedMonthlyNetPence: 250050 })
    const [debt] = await db.debts.toArray()
    expect(debt).toMatchObject({
      name: 'Barclaycard', kind: 'card', balancePence: 120000, aprPercent: 22.9, minimumPaymentPence: 3500,
      creditLimitOrOriginalPence: 300000, promoAprPercent: 0, promoEndsOn: '2027-03-31',
    })
    const [pot] = await db.savingsPots.toArray()
    expect(pot).toMatchObject({ name: 'Rainy day', balancePence: 100000, isEmergencyFund: true })
    const [fund] = await db.sinkingFunds.toArray()
    expect(fund).toMatchObject({ name: 'Car insurance', yearlyAmountPence: 24000, dueMonth: 6 })
    expect(await db.allowancesUsed.toArray()).toEqual([{ taxYear: '2026/27', wrapper: 'isa', usedPence: 500000 }])
    const opening = await db.openingHoldings.toArray()
    expect(opening).toHaveLength(1)
    expect(opening[0]).toMatchObject({ holdingId: 'growth-global', valuePence: 150000, asOf: '2026-10-26' })
    const settings = await db.settings.get('main')
    expect(settings).toMatchObject({
      budgetMonthStartDay: 25, aprThresholdPercent: 8, bufferPercent: 12, emergencyFundPotId: pot.id,
      lisaEnabled: false, onboardingDone: true,
    })
  })

  it('allows at most one emergency fund', async () => {
    const user = userEvent.setup()
    renderWizard(await freshDb())
    await screen.findByText('Step 1 of 8')
    for (let i = 0; i < 3; i++) await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Add savings pot' }))
    await user.click(screen.getByRole('button', { name: 'Add savings pot' }))
    const boxes = screen.getAllByLabelText('This is my emergency fund')
    await user.click(boxes[0])
    await user.click(boxes[1])
    expect(boxes[0]).not.toBeChecked()
    expect(boxes[1]).toBeChecked()
  })

  it('shows an inline money error and writes nothing', async () => {
    const user = userEvent.setup()
    const db = await freshDb()
    renderWizard(db)
    await screen.findByText('Step 1 of 8')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Add income stream' }))
    await user.type(screen.getByLabelText('Income name'), 'Salary')
    const amount = screen.getByLabelText('Expected monthly net amount')
    await user.type(amount, 'lots')
    await user.tab()
    expect(screen.getByText('Enter an amount like 1,250.00')).toBeInTheDocument()
    expect(amount).toHaveAttribute('aria-invalid', 'true')
    expect(amount).toHaveAccessibleDescription('Enter an amount like 1,250.00')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('Step 2 of 8')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Fix the highlighted fields')
    for (const t of TABLES) expect(await db[t].count()).toBe(0)
    expect((await db.settings.get('main'))?.onboardingDone).toBe(false)
  })

  it('removes rows, and Skip step discards that step\'s draft', async () => {
    const user = userEvent.setup()
    const db = await freshDb()
    renderWizard(db)
    await screen.findByText('Step 1 of 8')
    await user.click(screen.getByRole('button', { name: 'Add account' }))
    await user.click(screen.getByRole('button', { name: 'Add account' }))
    expect(screen.getByRole('button', { name: 'Remove account 2' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Remove account 2' }))
    expect(screen.queryByRole('button', { name: 'Remove account 2' })).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('Account name'), 'Half done')
    await user.click(screen.getByRole('button', { name: 'Skip step' }))
    expect(screen.getByText('Step 2 of 8')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.queryByLabelText('Account name')).not.toBeInTheDocument()
    expect(await db.accounts.count()).toBe(0)
  })

  it('does not accept promo APR without a promo end date', async () => {
    const user = userEvent.setup()
    renderWizard(await freshDb())
    await screen.findByText('Step 1 of 8')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Add debt' }))
    await user.type(screen.getByLabelText('Debt name'), 'Card')
    await user.type(screen.getByLabelText('Balance'), '100')
    await user.type(screen.getByLabelText('APR (%)'), '20')
    await user.type(screen.getByLabelText('Minimum payment'), '5')
    await user.type(screen.getByLabelText('Promo APR (%, optional)'), '0')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('Choose the date the promotion ends')).toBeInTheDocument()
    expect(screen.getByText('Step 3 of 8')).toBeInTheDocument()
  })
})

describe('Wizard gating in the app', () => {
  it('shows the wizard, not the tabs, until setup is skipped; Skip setup writes nothing else', async () => {
    const user = userEvent.setup()
    const db = await freshDb()
    const before = await db.settings.get('main')
    render(<App db={db} />)
    expect(await screen.findByText('Step 1 of 8')).toBeInTheDocument()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Skip setup' }))
    expect(await screen.findByRole('tablist')).toBeInTheDocument()
    expect(screen.queryByText('Step 1 of 8')).not.toBeInTheDocument()
    expect(await db.settings.get('main')).toEqual({ ...before, onboardingDone: true })
    for (const t of TABLES) expect(await db[t].count()).toBe(0)
  })

  it('shows the tabs after Finish', async () => {
    const user = userEvent.setup()
    const db = await freshDb()
    render(<App db={db} />)
    await screen.findByText('Step 1 of 8')
    for (let i = 0; i < 7; i++) await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Finish' }))
    expect(await screen.findByRole('tablist')).toBeInTheDocument()
    expect((await db.settings.get('main'))?.onboardingDone).toBe(true)
  })

  it('treats an older settings row without onboardingDone as not done', async () => {
    const db = await freshDb()
    const row = { ...(await db.settings.get('main')) } as Record<string, unknown>
    delete row.onboardingDone
    delete row.lisaEnabled
    await db.settings.put(row as never)
    render(<App db={db} />)
    expect(await screen.findByText('Step 1 of 8')).toBeInTheDocument()
  })
})
