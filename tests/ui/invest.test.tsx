import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Debt, IncomeStream, Settings, Transaction } from '../../src/domain/types'
import { openDb, type BudgetDB } from '../../src/storage/db'
import { seedDefaults } from '../../src/storage/seed'
import App from '../../src/ui/App'
import { DbProvider } from '../../src/ui/DbProvider'
import Invest, { DISCLAIMER } from '../../src/ui/screens/Invest'
import { logPlanLine } from '../../src/ui/screens/invest/investDb'

const TODAY = '2026-10-26'
let counter = 0
const opened: BudgetDB[] = []

async function freshDb(): Promise<BudgetDB> {
  const db = openDb(`invest-test-${Date.now()}-${counter++}`)
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

const salary: IncomeStream = { id: 's', label: 'Salary', expectedMonthlyNetPence: 300000 }
const ISA_GLOBAL = 'Bought Vanguard FTSE All-World UCITS ETF in the ISA'

async function setup(db: BudgetDB, opts: { streams?: IncomeStream[]; settings?: Partial<Settings>; debts?: Debt[]; txs?: Transaction[] } = {}) {
  await db.incomeStreams.bulkPut(opts.streams ?? [salary])
  if (opts.settings) await db.settings.update('main', opts.settings)
  await db.debts.bulkPut(opts.debts ?? [])
  if (opts.txs) {
    await db.accounts.put({ id: 'cur', name: 'Current', bank: 'Bank', kind: 'current' })
    await db.transactions.bulkPut(opts.txs)
  }
  const user = userEvent.setup()
  render(
    <DbProvider db={db}>
      <Invest today={TODAY} />
    </DbProvider>,
  )
  await screen.findByRole('heading', { name: 'How we got this number' })
  return user
}

const poundsToPence = (s: string) => Math.round(Number(s.replace(/[^0-9.-]/g, '')) * 100)

describe('Invest: the plan', () => {
  it('shows plan lines that add up to the investable figure', async () => {
    const db = await freshDb()
    await setup(db)
    // £3,000 income, 10% buffer, nothing else: £2,700 to invest.
    const hero = await screen.findByRole('region', { name: 'Invest this month' })
    expect(within(hero).getByText('£2,700.00')).toBeInTheDocument()
    const amounts = [...document.querySelectorAll('.plan-row .plan-amount')].map((e) => poundsToPence(e.textContent ?? ''))
    expect(amounts.length).toBeGreaterThan(0)
    expect(amounts.reduce((a, b) => a + b, 0)).toBe(270000)
    // Wrapper headings: pension takes 25%, the ISA the rest.
    expect(screen.getByRole('heading', { name: /Pension \(SIPP\)/ })).toHaveTextContent('£675.00')
    expect(screen.getByRole('heading', { name: /Stocks and shares ISA/ })).toHaveTextContent('£2,025.00')
    expect(screen.getAllByText('VWRL').length).toBeGreaterThan(0)
  })

  it('explains the figure line by line with signed amounts', async () => {
    const db = await freshDb()
    await setup(db, { debts: [{ id: 'd', name: 'Visa', kind: 'card', balancePence: 50000, creditLimitOrOriginalPence: 100000, aprPercent: 22.9, minimumPaymentPence: 2500 }] })
    const list = screen.getByRole('list', { name: 'How we got this number' })
    const row = (label: string) => within(list).getByText(label).closest('li')!
    expect(row('Income (expected, or your 3-month average if lower)')).toHaveTextContent('+£3,000.00')
    expect(row('Minimum debt payments')).toHaveTextContent('-£25.00')
    expect(row('Safety buffer (10% of income)')).toHaveTextContent('-£300.00')
    expect(row('Extra payment on high-interest debt')).toHaveTextContent('-£500.00')
    expect(row('Invest this month')).toHaveTextContent('£2,175.00')
  })

  it('shows the disclaimer exactly once', async () => {
    const db = await freshDb()
    await setup(db)
    expect(DISCLAIMER).toBe(
      "Starting rules, not personal advice. Check each fund's key information document and your platform's availability before buying.",
    )
    expect(screen.getAllByText(DISCLAIMER)).toHaveLength(1)
  })

  it('shows the growth and aggressive split for this month and the drift view', async () => {
    const db = await freshDb()
    await setup(db)
    const imgs = await screen.findAllByRole('img', { name: /Growth 70%, aggressive 30%/ })
    expect(imgs.length).toBeGreaterThan(0)
    expect(screen.getByText('No holdings recorded yet — using your target split.')).toBeInTheDocument()
  })

  it('leans new money towards an underweight bucket, capped by the engine', async () => {
    const db = await freshDb()
    await db.openingHoldings.put({ id: 'o', holdingId: 'aggressive-nasdaq', valuePence: 1000000, asOf: TODAY, wrapper: 'isa', platformId: 'trading212' })
    await setup(db)
    expect(await screen.findByText(/Growth is 0% of your portfolio vs a 70% target/)).toBeInTheDocument()
    expect(screen.getByText("This month's new money: 80% growth, 20% aggressive.")).toBeInTheDocument()
  })

  it('shows the platform warning when a US-only platform is chosen for UCITS funds', async () => {
    const db = await freshDb()
    await setup(db, { settings: { defaultPlatformByWrapper: { isa: 'robinhood' } } })
    expect(await screen.findByText(/Robinhood UK can't hold: Vanguard FTSE All-World UCITS ETF/)).toBeInTheDocument()
    const isa = screen.getByRole('region', { name: /Stocks and shares ISA/ })
    expect(within(isa).getByText('Robinhood UK')).toBeInTheDocument()
  })

  it('lets you choose a platform for a wrapper that has none', async () => {
    const db = await freshDb()
    const user = await setup(db)
    const select = screen.getByLabelText('Platform for the ISA')
    expect(within(select).getByRole('option', { name: 'Choose a platform' })).toBeInTheDocument()
    await user.selectOptions(select, 'trading212')
    await waitFor(async () => expect((await db.settings.get('main'))?.defaultPlatformByWrapper.isa).toBe('trading212'))
    const isa = await screen.findByRole('region', { name: /Stocks and shares ISA/ })
    expect(await within(isa).findByText('Trading 212')).toBeInTheDocument()
  })
})

describe('Invest: ticking lines off', () => {
  it('ticking an ISA line logs it and raises the ISA allowance used for 2026/27', async () => {
    const db = await freshDb()
    const user = await setup(db)
    await user.click(await screen.findByRole('checkbox', { name: ISA_GLOBAL }))
    // ISA £2,025: growth 70% = £1,417.50, two-thirds of that to the global fund = £945.00.
    await waitFor(async () => expect(await db.investmentLog.get('2026-10:isa:growth-global')).toBeDefined())
    const log = await db.investmentLog.get('2026-10:isa:growth-global')
    expect(log).toMatchObject({ month: '2026-10', wrapper: 'isa', holdingId: 'growth-global', plannedPence: 94500, actualPence: 94500 })
    expect((await db.allowancesUsed.get(['2026/27', 'isa']))?.usedPence).toBe(94500)
    expect(await screen.findByRole('checkbox', { name: ISA_GLOBAL })).toBeChecked()
    // The plan for this month stays put after ticking.
    expect(screen.getByRole('heading', { name: /Stocks and shares ISA/ })).toHaveTextContent('£2,025.00')
  })

  it('unticking removes the log row and takes the amount back off', async () => {
    const db = await freshDb()
    await db.allowancesUsed.put({ taxYear: '2026/27', wrapper: 'isa', usedPence: 10000 })
    const user = await setup(db)
    await user.click(await screen.findByRole('checkbox', { name: ISA_GLOBAL }))
    await waitFor(async () => expect((await db.allowancesUsed.get(['2026/27', 'isa']))?.usedPence).toBe(104500))
    await waitFor(() => expect(screen.getByRole('checkbox', { name: ISA_GLOBAL })).toBeChecked())
    await user.click(screen.getByRole('checkbox', { name: ISA_GLOBAL }))
    await waitFor(async () => expect(await db.investmentLog.count()).toBe(0))
    expect((await db.allowancesUsed.get(['2026/27', 'isa']))?.usedPence).toBe(10000)
    expect(await screen.findByRole('checkbox', { name: ISA_GLOBAL })).not.toBeChecked()
  })

  it('lets you change the amount actually put in; allowance moves by the difference', async () => {
    const db = await freshDb()
    const user = await setup(db)
    await user.click(await screen.findByRole('checkbox', { name: ISA_GLOBAL }))
    const input = await screen.findByLabelText('Amount put in, Vanguard FTSE All-World UCITS ETF in the ISA')
    expect(input).toHaveValue('945.00')
    await user.clear(input)
    await user.type(input, '900')
    await user.tab()
    await waitFor(async () => expect((await db.investmentLog.get('2026-10:isa:growth-global'))?.actualPence).toBe(90000))
    expect((await db.allowancesUsed.get(['2026/27', 'isa']))?.usedPence).toBe(90000)
  })

  it('does not raise allowance for a general investment account line', async () => {
    const db = await freshDb()
    await db.allowancesUsed.put({ taxYear: '2026/27', wrapper: 'isa', usedPence: 2000000 })
    const user = await setup(db)
    await user.click(await screen.findByRole('checkbox', { name: 'Bought Vanguard FTSE All-World UCITS ETF in the GIA' }))
    await waitFor(async () => expect(await db.investmentLog.get('2026-10:gia:growth-global')).toBeDefined())
    expect(await db.allowancesUsed.get(['2026/27', 'gia'])).toBeUndefined()
  })

  it('is safe against a double click or two writes at once', async () => {
    const db = await freshDb()
    const user = await setup(db)
    await user.dblClick(await screen.findByRole('checkbox', { name: ISA_GLOBAL }))
    await new Promise((r) => setTimeout(r, 50))
    const rows = await db.investmentLog.count()
    const used = (await db.allowancesUsed.get(['2026/27', 'isa']))?.usedPence ?? 0
    expect(used).toBe(rows * 94500)
    expect(rows).toBeLessThanOrEqual(1)

    const row = { id: '2026-10:isa:growth-us', wrapper: 'isa' as const, holdingId: 'growth-us', bucket: 'growth' as const, name: 'x', ticker: 'x', plannedPence: 100 }
    const line = { row, month: '2026-10', taxYear: '2026/27', actualPence: 100, platformId: 'choose' }
    const results = await Promise.all([logPlanLine(db, line), logPlanLine(db, line)])
    expect(results.filter(Boolean)).toHaveLength(1)
    expect((await db.allowancesUsed.get(['2026/27', 'isa']))?.usedPence).toBe(used + 100)
  })

  it('says so when a write fails', async () => {
    const db = await freshDb()
    await setup(db)
    vi.spyOn(db.investmentLog, 'add').mockRejectedValue(new Error('disk full'))
    fireEvent.click(await screen.findByRole('checkbox', { name: ISA_GLOBAL }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't log that. Nothing was changed.")
    expect(await db.investmentLog.count()).toBe(0)
  })
})

describe('Invest: nothing to invest', () => {
  it('with no income shows the no-income reason and no plan', async () => {
    const db = await freshDb()
    await setup(db, { streams: [] })
    expect(await screen.findByText(/There is no income to work from yet/)).toBeInTheDocument()
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    expect(screen.queryByRole('heading', { name: 'Your plan' })).not.toBeInTheDocument()
    expect(screen.getAllByText(DISCLAIMER)).toHaveLength(1)
  })

  it('with no surplus shows the reason and the biggest drain', async () => {
    const db = await freshDb()
    await setup(db, {
      streams: [{ id: 's', label: 'Salary', expectedMonthlyNetPence: 100000 }],
      txs: [{ id: 't', accountId: 'cur', date: '2026-09-10', amountPence: -150000, description: 'Rent', fingerprint: 'f', batchId: 'b', isTransfer: false, isRefund: false, categoryId: 'housing' }],
    })
    expect(await screen.findByText(/Nothing is left to invest this month/)).toBeInTheDocument()
    expect(screen.getByText('Biggest cost: Spending (3-month average), £1,500.00')).toBeInTheDocument()
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    expect(screen.getAllByText(DISCLAIMER)).toHaveLength(1)
  })
})

describe('Invest and Debts agree', () => {
  it("puts the plan's extra debt payment into the Debts tab", async () => {
    const db = await freshDb()
    await db.incomeStreams.put(salary)
    await db.debts.put({ id: 'd', name: 'Visa', kind: 'card', balancePence: 100000, creditLimitOrOriginalPence: 500000, aprPercent: 22.9, minimumPaymentPence: 2500 })
    const user = userEvent.setup()
    render(<App db={db} />)
    await user.click(await screen.findByRole('tab', { name: 'Debts & Savings' }))
    // Surplus £2,675 after the £25 minimum and £300 buffer; the whole £1,000 balance can be paid off.
    expect(await screen.findByLabelText('Extra per month')).toHaveValue('1000.00')
    await user.click(screen.getByRole('tab', { name: 'Invest' }))
    const list = await screen.findByRole('list', { name: 'How we got this number' })
    expect(within(list).getByText('Extra payment on high-interest debt').closest('li')).toHaveTextContent('-£1,000.00')
  })
})
