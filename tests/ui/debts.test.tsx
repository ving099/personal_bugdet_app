import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Debt, Pence, SavingsPot, SinkingFund } from '../../src/domain/types'
import { openDb, type BudgetDB } from '../../src/storage/db'
import { seedDefaults } from '../../src/storage/seed'
import { DbProvider } from '../../src/ui/DbProvider'
import DebtsSavings from '../../src/ui/screens/DebtsSavings'

const TODAY = '2026-10-26'
let counter = 0
const opened: BudgetDB[] = []

async function freshDb(): Promise<BudgetDB> {
  const db = openDb(`debts-test-${Date.now()}-${counter++}`)
  opened.push(db)
  await seedDefaults(db)
  return db
}

afterEach(async () => {
  cleanup()
  for (const db of opened.splice(0)) {
    db.close()
    await Dexie.delete(db.name)
  }
})

const debt = (p: Partial<Debt>): Debt => ({
  id: 'visa', name: 'Visa', kind: 'card', balancePence: 300000, creditLimitOrOriginalPence: 500000, aprPercent: 22.9,
  minimumPaymentPence: 5000, ...p,
})
const pot = (p: Partial<SavingsPot>): SavingsPot => ({
  id: 'p1', name: 'Rainy day', balancePence: 120000, targetPence: 300000, isEmergencyFund: false, ...p,
})
const fund = (p: Partial<SinkingFund>): SinkingFund => ({ id: 'f1', name: 'Car insurance', yearlyAmountPence: 120000, dueMonth: 3, ...p })

async function setup(db: BudgetDB, opts: { debts?: Debt[]; pots?: SavingsPot[]; funds?: SinkingFund[]; extra?: Pence } = {}) {
  await db.debts.bulkPut(opts.debts ?? [])
  await db.savingsPots.bulkPut(opts.pots ?? [])
  await db.sinkingFunds.bulkPut(opts.funds ?? [])
  const user = userEvent.setup()
  render(
    <DbProvider db={db}>
      <DebtsSavings today={TODAY} extraDebtPence={opts.extra} />
    </DbProvider>,
  )
  await screen.findByRole('heading', { name: 'Debts' })
  return user
}

const rowOf = (name: string) =>
  vi.waitFor(() => {
    const li = [...document.querySelectorAll('li.debt')].find((x) => x.querySelector('.item-name')?.textContent?.startsWith(name))
    if (!li) throw new Error(`no row for ${name}`)
    return li as HTMLElement
  })
const two = [
  debt({ id: 'a', name: 'Visa', balancePence: 20000, aprPercent: 0, minimumPaymentPence: 10000, creditLimitOrOriginalPence: 100000 }),
  debt({ id: 'b', name: 'Loan', kind: 'loan', balancePence: 50000, aprPercent: 0, minimumPaymentPence: 10000, creditLimitOrOriginalPence: 100000 }),
]

describe('Debts: list', () => {
  it('shows card utilisation, loan percent paid, APR and minimum payment', async () => {
    const db = await freshDb()
    await setup(db, { debts: [debt({}), debt({ id: 'loan', name: 'Car loan', kind: 'loan', balancePence: 400000, creditLimitOrOriginalPence: 1000000, aprPercent: 6.9, minimumPaymentPence: 20000 })] })
    const card = await rowOf('Visa')
    expect(within(card).getByText('60% used')).toBeInTheDocument()
    expect(within(card).getByText('limit £5,000.00')).toBeInTheDocument()
    expect(within(card).getByText('22.9% APR')).toBeInTheDocument()
    expect(within(card).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '60')
    expect(within(card).getByText('£3,000.00')).toBeInTheDocument()
    const loan = await rowOf('Car loan')
    expect(within(loan).getByText('60% paid off')).toBeInTheDocument()
    expect(within(loan).getByText('original £10,000.00')).toBeInTheDocument()
    expect(within(loan).getByText('Loan')).toBeInTheDocument()
    expect(within(loan).getByText('£200.00')).toBeInTheDocument()
  })

  it('shows the promo end and the rate in effect, and a hint when the limit is missing', async () => {
    const db = await freshDb()
    await setup(db, { debts: [debt({ promoAprPercent: 0, promoEndsOn: '2027-01-31' }), debt({ id: 'x', name: 'Store card', creditLimitOrOriginalPence: 0 })] })
    const card = await rowOf('Visa')
    expect(within(card).getByText('0% APR')).toBeInTheDocument()
    expect(within(card).getByText('0% until 31 Jan 2027, then 22.9%')).toBeInTheDocument()
    const store = await rowOf('Store card')
    expect(within(store).getByText('Add a credit limit to see utilisation')).toBeInTheDocument()
    expect(store.textContent).not.toMatch(/NaN/)
  })

  it('totals the balances and the minimum payments', async () => {
    const db = await freshDb()
    await setup(db, { debts: two })
    const totals = (await screen.findByText('Total balance')).closest('dl')!
    expect(within(totals).getByText('£700.00')).toBeInTheDocument()
    expect(within(totals).getByText('£200.00')).toBeInTheDocument()
    expect(within(totals).getByText('Total minimums')).toBeInTheDocument()
  })

  it('shows an empty state with an Add a debt action', async () => {
    const db = await freshDb()
    const user = await setup(db)
    expect(await screen.findByText('No debts added')).toBeInTheDocument()
    expect(screen.queryByText('Payoff timeline')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add a debt' }))
    expect(await screen.findByLabelText('Debt name')).toHaveFocus()
  })
})

describe('Debts: add, edit, delete', () => {
  it('adds a debt using the wizard fields and shows it', async () => {
    const db = await freshDb()
    const user = await setup(db)
    await user.click(await screen.findByRole('button', { name: 'Add a debt' }))
    await user.type(screen.getByLabelText('Debt name'), 'Barclaycard')
    await user.type(screen.getByLabelText('Balance'), '1,200')
    await user.type(screen.getByLabelText('APR (%)'), '22.9')
    await user.type(screen.getByLabelText('Minimum payment'), '35')
    await user.type(screen.getByLabelText('Credit limit (cards) or original amount (loans)'), '3000')
    await user.type(screen.getByLabelText('Promo APR (%, optional)'), '0')
    fireEvent.change(screen.getByLabelText('Promo end date'), { target: { value: '2027-03-31' } })
    await user.click(screen.getByRole('button', { name: 'Add debt' }))
    expect(await screen.findByText('Saved Barclaycard.')).toBeInTheDocument()
    expect(await db.debts.toArray()).toMatchObject([{
      name: 'Barclaycard', kind: 'card', balancePence: 120000, aprPercent: 22.9, minimumPaymentPence: 3500,
      creditLimitOrOriginalPence: 300000, promoAprPercent: 0, promoEndsOn: '2027-03-31',
    }])
    expect(within(await rowOf('Barclaycard')).getByText('40% used')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add a debt' })).toHaveFocus()
  })

  it('refuses a promo APR without an end date, an APR above 100 and a negative balance', async () => {
    const db = await freshDb()
    const user = await setup(db)
    await user.click(await screen.findByRole('button', { name: 'Add a debt' }))
    await user.type(screen.getByLabelText('Debt name'), 'Card')
    await user.type(screen.getByLabelText('Balance'), '100')
    await user.type(screen.getByLabelText('APR (%)'), '20')
    await user.type(screen.getByLabelText('Minimum payment'), '5')
    await user.type(screen.getByLabelText('Promo APR (%, optional)'), '0')
    await user.click(screen.getByRole('button', { name: 'Add debt' }))
    expect(await screen.findByText('Choose the date the promotion ends')).toBeInTheDocument()
    expect(screen.getByText('Fix the highlighted fields to continue.')).toBeInTheDocument()
    expect(await db.debts.count()).toBe(0)

    await user.clear(screen.getByLabelText('Promo APR (%, optional)'))
    await user.clear(screen.getByLabelText('APR (%)'))
    await user.type(screen.getByLabelText('APR (%)'), '150')
    await user.click(screen.getByRole('button', { name: 'Add debt' }))
    expect(await screen.findByText('Enter a rate from 0 to 100, like 22.9')).toBeInTheDocument()

    await user.clear(screen.getByLabelText('APR (%)'))
    await user.type(screen.getByLabelText('APR (%)'), '20')
    await user.clear(screen.getByLabelText('Balance'))
    await user.type(screen.getByLabelText('Balance'), '-5')
    await user.click(screen.getByRole('button', { name: 'Add debt' }))
    expect(await screen.findByText('Amounts cannot be negative.')).toBeInTheDocument()
    expect(await db.debts.count()).toBe(0)
  })

  it('edits a debt in place and returns focus to its Edit button', async () => {
    const db = await freshDb()
    const user = await setup(db, { debts: [debt({})] })
    await user.click(await screen.findByRole('button', { name: 'Edit Visa' }))
    const balance = screen.getByLabelText('Balance')
    expect(balance).toHaveValue('3000.00')
    await user.clear(balance)
    await user.type(balance, '2500')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('Saved Visa.')).toBeInTheDocument()
    expect((await db.debts.get('visa'))?.balancePence).toBe(250000)
    expect(await screen.findByText('50% used')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit Visa' })).toHaveFocus()
  })

  it('removes a promo by clearing both promo fields when editing', async () => {
    const db = await freshDb()
    const user = await setup(db, { debts: [debt({ promoAprPercent: 0, promoEndsOn: '2027-01-31' })] })
    await user.click(await screen.findByRole('button', { name: 'Edit Visa' }))
    await user.clear(screen.getByLabelText('Promo APR (%, optional)'))
    fireEvent.change(screen.getByLabelText('Promo end date'), { target: { value: '' } })
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await screen.findByText('Saved Visa.')
    const saved = await db.debts.get('visa')
    expect(saved?.promoAprPercent).toBeUndefined()
    expect(saved?.promoEndsOn).toBeUndefined()
  })

  it('asks before deleting, keeps the debt on Cancel and removes it on confirm', async () => {
    const db = await freshDb()
    const user = await setup(db, { debts: [debt({})] })
    const del = await screen.findByRole('button', { name: 'Delete Visa' })
    await user.click(del)
    const dialog = await screen.findByRole('dialog', { name: 'Delete Visa?' })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(await db.debts.count()).toBe(1)
    expect(del).toHaveFocus()
    await user.click(del)
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('Deleted Visa.')).toBeInTheDocument()
    expect(await db.debts.count()).toBe(0)
    expect(await screen.findByText('No debts added')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Debts' })).toHaveFocus()
  })

  it('shows an alert and changes nothing when a save fails', async () => {
    const db = await freshDb()
    const user = await setup(db, { debts: [debt({})] })
    await user.click(await screen.findByRole('button', { name: 'Edit Visa' }))
    const spy = vi.spyOn(db.debts, 'put').mockRejectedValueOnce(new Error('disk'))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't save that. Nothing was changed.")
    spy.mockRestore()
    expect((await db.debts.get('visa'))?.balancePence).toBe(300000)
  })
})

describe('Debts: payoff timeline', () => {
  it('gives a debt-free month, a per-debt cleared list and an accessible chart', async () => {
    const db = await freshDb()
    await setup(db, { debts: two })
    expect(await screen.findByText('Debt-free by January 2027')).toBeInTheDocument()
    const list = screen.getByRole('list', { name: 'When each debt is cleared' })
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Visa cleared Nov 2026', 'Loan cleared Jan 2027'])
    expect(screen.getByText(/Highest interest first, then the next/)).toBeInTheDocument()
    expect(screen.getByRole('img')).toHaveAccessibleName('Total remaining debt falls from £700.00 today to £0.00 by January 2027.')
  })

  it('says so when the debt cannot be paid within 50 years', async () => {
    const db = await freshDb()
    await setup(db, { debts: [debt({ balancePence: 10000000, aprPercent: 30, minimumPaymentPence: 100 })] })
    expect(await screen.findByText('Not payable within 50 years at these payments. Raise your payments to see a date.')).toBeInTheDocument()
    expect(screen.getByText('Visa not cleared within 50 years at these payments')).toBeInTheDocument()
    expect(screen.getByRole('img').getAttribute('aria-label')).toMatch(/after 50 years/)
  })

  it('brings the date forward when you add an extra monthly payment', async () => {
    const db = await freshDb()
    const user = await setup(db, { debts: two })
    await screen.findByText('Debt-free by January 2027')
    expect(screen.getByLabelText('Extra per month')).toHaveValue('')
    expect(screen.getByText('The Invest tab shows how much extra the plan puts towards debt.')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Extra per month'), '100')
    expect(await screen.findByText('Debt-free by December 2026')).toBeInTheDocument()
  })

  it('starts from the extraDebtPence prop', async () => {
    const db = await freshDb()
    await setup(db, { debts: two, extra: 10000 })
    expect(await screen.findByLabelText('Extra per month')).toHaveValue('100.00')
    expect(await screen.findByText('Debt-free by December 2026')).toBeInTheDocument()
  })

  it('treats a negative or unreadable extra as nothing and says why', async () => {
    const db = await freshDb()
    const user = await setup(db, { debts: two })
    await user.type(await screen.findByLabelText('Extra per month'), '-50')
    expect(await screen.findByText('Extra cannot be negative.')).toBeInTheDocument()
    expect(screen.getByText('Debt-free by January 2027')).toBeInTheDocument()
  })
})

describe('Savings pots', () => {
  it('shows progress to target and the emergency-fund label', async () => {
    const db = await freshDb()
    await setup(db, { pots: [pot({ isEmergencyFund: true }), pot({ id: 'p2', name: 'Holiday', balancePence: 5000, targetPence: 0 })] })
    const row = await rowOf('Rainy day')
    expect(within(row).getByText('Emergency fund')).toBeInTheDocument()
    expect(within(row).getByText('£1,200.00 of £3,000.00')).toBeInTheDocument()
    const bar = within(row).getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '120000')
    expect(bar).toHaveAttribute('aria-valuemax', '300000')
    const holiday = await rowOf('Holiday')
    expect(within(holiday).queryByRole('progressbar')).not.toBeInTheDocument()
    expect(within(holiday).queryByText('Emergency fund')).not.toBeInTheDocument()
  })

  it('keeps one emergency fund: flagging another clears the first and the setting follows', async () => {
    const db = await freshDb()
    const user = await setup(db, { pots: [pot({ isEmergencyFund: true }), pot({ id: 'p2', name: 'Buffer' })] })
    await db.settings.update('main', { emergencyFundPotId: 'p1' })
    await user.click(await screen.findByRole('button', { name: 'Edit Buffer' }))
    await user.click(screen.getByLabelText('This is my emergency fund'))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await screen.findByText('Saved Buffer.')
    const pots = Object.fromEntries((await db.savingsPots.toArray()).map((p) => [p.id, p.isEmergencyFund]))
    expect(pots).toEqual({ p1: false, p2: true })
    expect((await db.settings.get('main'))?.emergencyFundPotId).toBe('p2')
    const flagged = (await screen.findAllByText('Emergency fund')).map((e) => e.closest('li'))
    expect(flagged).toHaveLength(1)
    expect(flagged[0]).toHaveTextContent('Buffer')

    await user.click(screen.getByRole('button', { name: 'Edit Buffer' }))
    await user.click(screen.getByLabelText('This is my emergency fund'))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await vi.waitFor(async () => expect((await db.settings.get('main'))?.emergencyFundPotId).toBeUndefined())
    expect((await db.savingsPots.toArray()).some((p) => p.isEmergencyFund)).toBe(false)
  })

  it('adds a pot, validates it, edits and deletes it with confirmation', async () => {
    const db = await freshDb()
    const user = await setup(db)
    await user.click(await screen.findByRole('button', { name: 'Add a savings pot' }))
    await user.click(screen.getByRole('button', { name: 'Add pot' }))
    expect(await screen.findByText('Enter a name')).toBeInTheDocument()
    expect(await db.savingsPots.count()).toBe(0)
    await user.type(screen.getByLabelText('Pot name'), 'Holiday')
    await user.type(screen.getByLabelText('Balance'), '250')
    await user.type(screen.getByLabelText('Target amount'), '1000')
    await user.click(screen.getByRole('button', { name: 'Add pot' }))
    expect(await screen.findByText('Saved Holiday.')).toBeInTheDocument()
    expect(await db.savingsPots.toArray()).toMatchObject([{ name: 'Holiday', balancePence: 25000, targetPence: 100000, isEmergencyFund: false }])
    await user.click(screen.getByRole('button', { name: 'Delete Holiday' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }))
    await screen.findByText('Deleted Holiday.')
    expect(await db.savingsPots.count()).toBe(0)
  })

  it('clears the emergency-fund setting when that pot is deleted', async () => {
    const db = await freshDb()
    const user = await setup(db, { pots: [pot({ isEmergencyFund: true })] })
    await db.settings.update('main', { emergencyFundPotId: 'p1' })
    await user.click(await screen.findByRole('button', { name: 'Delete Rainy day' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }))
    await screen.findByText('Deleted Rainy day.')
    expect((await db.settings.get('main'))?.emergencyFundPotId).toBeUndefined()
  })
})

describe('Annual bills', () => {
  it('shows the due month and the monthly set-aside per bill and in total', async () => {
    const db = await freshDb()
    await setup(db, { funds: [fund({}), fund({ id: 'f2', name: 'Car tax', yearlyAmountPence: 24000, dueMonth: 11 })] })
    const row = await rowOf('Car insurance')
    expect(within(row).getByText('Due in March')).toBeInTheDocument()
    expect(within(row).getByText('Set aside £100.00 a month')).toBeInTheDocument()
    expect(within(await rowOf('Car tax')).getByText('Set aside £20.00 a month')).toBeInTheDocument()
    const total = screen.getByText('Set aside each month').closest('div')!
    expect(within(total).getByText('£120.00')).toBeInTheDocument()
  })

  it('adds, edits and deletes a bill', async () => {
    const db = await freshDb()
    const user = await setup(db)
    expect(await screen.findByText(/No annual bills yet/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add an annual bill' }))
    await user.type(screen.getByLabelText('Bill name'), 'Boiler cover')
    await user.type(screen.getByLabelText('Yearly amount'), '240')
    await user.selectOptions(screen.getByLabelText('Due month'), 'June')
    expect(screen.getByText('Monthly set-aside: £20.00')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add bill' }))
    await screen.findByText('Saved Boiler cover.')
    expect(await db.sinkingFunds.toArray()).toMatchObject([{ name: 'Boiler cover', yearlyAmountPence: 24000, dueMonth: 6 }])
    await user.click(screen.getByRole('button', { name: 'Edit Boiler cover' }))
    const yearly = screen.getByLabelText('Yearly amount')
    await user.clear(yearly)
    await user.type(yearly, '1200')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('Set aside £100.00 a month')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Delete Boiler cover' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }))
    await screen.findByText('Deleted Boiler cover.')
    expect(await db.sinkingFunds.count()).toBe(0)
  })
})
