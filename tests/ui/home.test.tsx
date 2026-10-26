import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Debt, IncomeStream, Settings, Transaction } from '../../src/domain/types'
import { openDb, type BudgetDB } from '../../src/storage/db'
import { seedDefaults } from '../../src/storage/seed'
import App from '../../src/ui/App'
import { DbProvider } from '../../src/ui/DbProvider'
import Home from '../../src/ui/screens/Home'

const TODAY = '2026-10-26'
let counter = 0
const opened: BudgetDB[] = []

async function freshDb(): Promise<BudgetDB> {
  const db = openDb(`home-test-${Date.now()}-${counter++}`)
  opened.push(db)
  await seedDefaults(db)
  await db.settings.update('main', { onboardingDone: true })
  return db
}

afterEach(async () => {
  cleanup()
  window.localStorage.clear()
  vi.restoreAllMocks()
  for (const db of opened.splice(0)) {
    db.close()
    await Dexie.delete(db.name)
  }
})

let n = 0
const tx = (p: Partial<Transaction>): Transaction => ({
  id: `t${n++}`, accountId: 'cur', date: '2026-10-05', amountPence: -1000, description: 'Shop', fingerprint: `f${n}`,
  batchId: 'b', isTransfer: false, isRefund: false, ...p,
})
const salary: IncomeStream = { id: 's', label: 'Salary', expectedMonthlyNetPence: 300000 }
const visa: Debt = { id: 'd', name: 'Visa', kind: 'card', balancePence: 120000, creditLimitOrOriginalPence: 500000, aprPercent: 5, minimumPaymentPence: 2500 }

async function setup(
  db: BudgetDB,
  opts: { txs?: Transaction[]; streams?: IncomeStream[]; debts?: Debt[]; settings?: Partial<Settings> } = {},
) {
  await db.accounts.put({ id: 'cur', name: 'Current', bank: 'Bank', kind: 'current' })
  await db.transactions.bulkPut(opts.txs ?? [])
  await db.incomeStreams.bulkPut(opts.streams ?? [])
  await db.debts.bulkPut(opts.debts ?? [])
  await db.settings.update('main', { backupLastAt: TODAY, ...opts.settings })
  const onNavigate = vi.fn()
  const user = userEvent.setup()
  render(
    <DbProvider db={db}>
      <Home today={TODAY} onNavigate={onNavigate} />
    </DbProvider>,
  )
  return { user, onNavigate }
}

const month = [
  tx({ date: '2026-10-01', amountPence: 300000, description: 'Salary', incomeStreamId: 's', categoryId: 'income' }),
  tx({ date: '2026-10-05', amountPence: -50000, description: 'Tesco', categoryId: 'groceries-and-food' }),
]

describe('Home', () => {
  it('shows income, spent, left and debt remaining for this month', async () => {
    const db = await freshDb()
    await setup(db, { txs: month, streams: [salary], debts: [visa, { ...visa, id: 'e', name: 'Loan', balancePence: 30000 }] })
    const summary = await screen.findByRole('region', { name: 'October 2026' })
    const item = (label: string) => within(summary).getByText(label).closest('div')!
    expect(item('Income received')).toHaveTextContent('£3,000.00')
    expect(item('Spent')).toHaveTextContent('£500.00')
    expect(item('Left')).toHaveTextContent('£2,500.00')
    expect(item('Debt remaining')).toHaveTextContent('£1,500.00')
  })

  it('shows the invest figure and goes to the plan', async () => {
    const db = await freshDb()
    const { user, onNavigate } = await setup(db, { txs: month, streams: [salary] })
    const card = await screen.findByRole('region', { name: 'Invest this month' })
    // £3,000 expected income with no earlier history, 10% buffer: £2,700.
    await waitFor(() => expect(within(card).getByText('£2,700.00')).toBeInTheDocument())
    await user.click(within(card).getByRole('button', { name: 'See the plan' }))
    expect(onNavigate).toHaveBeenCalledWith('invest')
  })

  it('gives the short reason when there is nothing to invest', async () => {
    const db = await freshDb()
    await setup(db, { txs: month })
    const card = await screen.findByRole('region', { name: 'Invest this month' })
    await waitFor(() => expect(within(card).getByText('Add your income first')).toBeInTheDocument())
    await waitFor(() => expect(within(card).getByRole('button', { name: 'See why' })).toBeInTheDocument())
  })

  it('says Nothing to invest this month when the figure works out at £0', async () => {
    const db = await freshDb()
    await setup(db, { txs: month, streams: [salary], debts: [{ ...visa, balancePence: 10000000, aprPercent: 22.9, minimumPaymentPence: 0 }] })
    const card = await screen.findByRole('region', { name: 'Invest this month' })
    await waitFor(() => expect(within(card).getByText('Nothing to invest this month')).toBeInTheDocument())
    expect(within(card).queryByRole('button', { name: 'See the plan' })).not.toBeInTheDocument()
    await waitFor(() => expect(within(card).getByRole('button', { name: 'See why' })).toBeInTheDocument())
  })

  it('shows Back up now when a backup is overdue, and it goes to Settings', async () => {
    const db = await freshDb()
    const { user, onNavigate } = await setup(db, { txs: month, streams: [salary], settings: { backupLastAt: '2026-09-01' } })
    const button = await screen.findByRole('button', { name: 'Back up now' })
    await waitFor(() => expect(screen.getByText('Your last backup was more than 30 days ago.')).toBeInTheDocument())
    await user.click(button)
    expect(onNavigate).toHaveBeenCalledWith('settings')
  })

  it('treats never backed up as overdue', async () => {
    const db = await freshDb()
    await setup(db, { txs: month, streams: [salary], settings: { backupLastAt: undefined } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Back up now' })).toBeInTheDocument())
    await waitFor(() => expect(screen.getByText('You have not made a backup yet.')).toBeInTheDocument())
  })

  it('lists uncategorised spending and unmatched card repayments', async () => {
    const db = await freshDb()
    const { user, onNavigate } = await setup(db, {
      streams: [salary],
      txs: [
        ...month,
        tx({ description: 'Corner shop' }),
        tx({ description: 'Market stall' }),
        tx({ description: 'BARCLAYCARD PAYMENT', amountPence: -20000, categoryId: 'debt-payments' }),
        // Last month: not counted.
        tx({ date: '2026-09-20', description: 'Old shop' }),
      ],
    })
    const list = await screen.findByRole('list', { name: 'Needs attention' })
    await waitFor(() => expect(within(list).getByText('2 transactions need a category.')).toBeInTheDocument())
    await waitFor(() => expect(within(list).getByText(/1 card repayment has no matching payment into a card account/)).toBeInTheDocument())
    expect(screen.queryByText('All caught up')).not.toBeInTheDocument()
    await user.click(within(list).getByRole('button', { name: 'Categorise' }))
    expect(onNavigate).toHaveBeenCalledWith('budget')
  })

  it('says All caught up when nothing needs attention', async () => {
    const db = await freshDb()
    await setup(db, { txs: month, streams: [salary] })
    await waitFor(() => expect(screen.getByText('All caught up')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Back up now' })).not.toBeInTheDocument()
  })

  it('shows a welcome for a brand-new user', async () => {
    const db = await freshDb()
    const { user, onNavigate } = await setup(db)
    await waitFor(() => expect(screen.getByText('Nothing to show yet')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Import a statement' }))
    expect(onNavigate).toHaveBeenCalledWith('import')
  })
})

describe('Home in the app', () => {
  it('See the plan opens the Invest tab', async () => {
    const db = await freshDb()
    await db.incomeStreams.put(salary)
    await db.settings.update('main', { backupLastAt: TODAY })
    const user = userEvent.setup()
    render(<App db={db} />)
    await user.click(await screen.findByRole('button', { name: 'See the plan' }))
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Invest' })).toHaveAttribute('aria-selected', 'true'))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'How we got this number' })).toBeInTheDocument())
  })
})
