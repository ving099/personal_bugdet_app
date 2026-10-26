import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { categorise } from '../../src/categorise/rules'
import type { Account, IncomeStream, Settings, Transaction } from '../../src/domain/types'
import { importBatch } from '../../src/import/batch'
import { defaultRules } from '../../src/seed/categories'
import { openDb, type BudgetDB } from '../../src/storage/db'
import { seedDefaults } from '../../src/storage/seed'
import { DbProvider } from '../../src/ui/DbProvider'
import Budget from '../../src/ui/screens/Budget'

const TODAY = '2026-10-26'
const CUR: Account = { id: 'cur', name: 'Everyday', bank: 'Testbank', kind: 'current' }
const BIZ: Account = { id: 'biz', name: 'Business', bank: 'Testbank', kind: 'business' }
const SALARY: IncomeStream = { id: 'salary', label: 'Salary', expectedMonthlyNetPence: 300000 }

let counter = 0
let seq = 0
const opened: BudgetDB[] = []

async function freshDb(opts: { startDay?: number; streams?: IncomeStream[] } = {}): Promise<BudgetDB> {
  const db = openDb(`budget-test-${Date.now()}-${counter++}`)
  opened.push(db)
  await seedDefaults(db)
  await db.accounts.bulkPut([CUR, BIZ])
  if (opts.startDay) await db.settings.update('main', { budgetMonthStartDay: opts.startDay } as Partial<Settings>)
  if (opts.streams) await db.incomeStreams.bulkPut(opts.streams)
  return db
}

afterEach(async () => {
  cleanup()
  for (const db of opened.splice(0)) {
    db.close()
    await Dexie.delete(db.name)
  }
})

const tx = (p: Partial<Transaction>): Transaction => ({
  id: `t${seq}`, accountId: 'cur', date: '2026-10-10', amountPence: -1000, description: 'SHOP', fingerprint: `fp${seq++}`,
  batchId: 'b', isTransfer: false, isRefund: false, ...p,
})

async function setup(db: BudgetDB, rows: Transaction[] = []) {
  if (rows.length > 0) await db.transactions.bulkAdd(rows)
  const user = userEvent.setup()
  render(
    <DbProvider db={db}>
      <Budget today={TODAY} />
    </DbProvider>,
  )
  await screen.findByRole('heading', { name: 'Spending' })
  return user
}

const rowButton = (name: RegExp | string) => screen.findByRole('button', { name: new RegExp(`^${name}`) })
const spentFigure = () => within(screen.getByText('Spent').closest('div')!).getByText(/£/).textContent

async function recategorise(user: ReturnType<typeof userEvent.setup>, description: string, category: string, apply = true) {
  const row = (await screen.findByText(description)).closest('li')!
  await user.click(within(row).getByRole('button', { name: /Change category/ }))
  const dialog = await screen.findByRole('dialog', { name: 'Change category' })
  await user.selectOptions(within(dialog).getByLabelText('Category'), category)
  const box = within(dialog).getByRole('checkbox', { name: 'Apply to all similar' })
  if ((box as HTMLInputElement).checked !== apply) await user.click(box)
  await user.click(within(dialog).getByRole('button', { name: 'Save' }))
}

describe('Budget: categories and progress', () => {
  it('moves the Groceries bar to the spend: £40 of a £250 limit', async () => {
    const db = await freshDb()
    await db.categories.update('groceries-and-food', { monthlyLimitPence: 25000 })
    await setup(db, [tx({ description: 'TESCO STORES 4412', amountPence: -4000, categoryId: 'groceries-and-food' })])
    expect(await screen.findByText('£40.00 of £250.00')).toBeInTheDocument()
    const bar = screen.getByRole('progressbar', { name: 'Groceries and food' })
    expect(bar).toHaveAttribute('aria-valuenow', '4000')
    expect(bar).toHaveAttribute('aria-valuemax', '25000')
    expect(bar).toHaveAttribute('aria-valuetext', '£40.00 of £250.00')
  })

  it('shows income, spent (positive) and left in the header', async () => {
    const db = await freshDb({ streams: [SALARY] })
    await setup(db, [
      tx({ amountPence: 300000, description: 'ACME PAYROLL', incomeStreamId: 'salary' }),
      tx({ amountPence: -4000, categoryId: 'travel' }),
    ])
    await screen.findByText('£40.00 spent')
    expect(spentFigure()).toBe('£40.00')
    expect(within(screen.getByText('Income received').closest('div')!).getByText('£3,000.00')).toBeInTheDocument()
    expect(within(screen.getByText('Left').closest('div')!).getByText('£2,960.00')).toBeInTheDocument()
  })

  it('says "No limit set" for a category without a limit', async () => {
    const db = await freshDb()
    await setup(db, [tx({ amountPence: -2500, categoryId: 'travel' })])
    const travel = await rowButton('Travel')
    expect(within(travel).getByText('£25.00 spent')).toBeInTheDocument()
    expect(within(travel).getByText('No limit set')).toBeInTheDocument()
  })

  it('says how far over the limit a category is, in text and with the over fill', async () => {
    const db = await freshDb()
    await db.categories.update('eating-out', { monthlyLimitPence: 10000 })
    await setup(db, [tx({ amountPence: -12000, categoryId: 'eating-out' })])
    expect(await screen.findByText('£120.00 of £100.00')).toBeInTheDocument()
    expect(screen.getByText('Over by £20.00')).toBeInTheDocument()
    const bar = screen.getByRole('progressbar', { name: 'Eating out' })
    expect(bar).toHaveAttribute('aria-valuetext', '£120.00 of £100.00. Over by £20.00')
    expect(bar.firstElementChild).toHaveAttribute('data-over')
    expect(bar).toHaveAttribute('aria-valuenow', '10000')
  })

  it('subtracts a refund from its category, and shows net refunds as "Refunds £X" with an empty bar', async () => {
    const db = await freshDb()
    await db.categories.update('clothes', { monthlyLimitPence: 20000 })
    await db.categories.update('gifts', { monthlyLimitPence: 20000 })
    await setup(db, [
      tx({ description: 'ZARA 1', amountPence: -5000, categoryId: 'clothes' }),
      tx({ description: 'ZARA 2', amountPence: 1500, categoryId: 'clothes', isRefund: true }),
      tx({ description: 'MOONPIG 1', amountPence: 1000, categoryId: 'gifts', isRefund: true }),
    ])
    expect(await screen.findByText('£35.00 of £200.00')).toBeInTheDocument()
    expect(screen.getByText('Refunds £10.00')).toBeInTheDocument()
    const bar = screen.getByRole('progressbar', { name: 'Gifts' })
    expect(bar).toHaveAttribute('aria-valuenow', '0')
    expect(bar.firstElementChild).toHaveStyle({ width: '0%' })
  })

  it('hides the excluded Transfers category and keeps transfer rows out of spent', async () => {
    const db = await freshDb()
    await setup(db, [
      tx({ amountPence: -9000, categoryId: 'transfers', description: 'TRANSFER TO SAVINGS' }),
      tx({ amountPence: -7000, categoryId: 'travel', isTransfer: true, description: 'MOVED' }),
      tx({ amountPence: -1000, categoryId: 'travel', description: 'TRAIN' }),
    ])
    await screen.findByText('£10.00 spent')
    expect(screen.queryByRole('button', { name: /^Transfers/ })).not.toBeInTheDocument()
    expect(spentFigure()).toBe('£10.00')
  })

  it('lists Uncategorised first with a count and a hint', async () => {
    const db = await freshDb()
    await setup(db, [
      tx({ amountPence: -3000, categoryId: 'travel' }),
      tx({ amountPence: -1000, description: 'ACME 1' }),
      tx({ amountPence: -2000, description: 'ACME 2' }),
    ])
    const list = await screen.findByRole('list', { name: 'Spending by category' })
    expect(list.firstElementChild).toHaveTextContent('Uncategorised')
    expect(within(list.firstElementChild as HTMLElement).getByText('2 transactions.')).toBeInTheDocument()
    expect(screen.getByText('Pick a category so these count properly.')).toBeInTheDocument()
  })

  it('expands one category at a time to show its transactions with chips', async () => {
    const db = await freshDb()
    await setup(db, [
      tx({ description: 'LIDL 1', amountPence: -1500, categoryId: 'groceries-and-food', date: '2026-10-12' }),
      tx({ description: 'LIDL BACK', amountPence: 500, categoryId: 'groceries-and-food', isRefund: true, date: '2026-10-13' }),
      tx({ description: 'RAIL', amountPence: -800, categoryId: 'travel' }),
    ])
    const groceries = await rowButton('Groceries and food')
    expect(groceries).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('LIDL 1')).not.toBeInTheDocument()
    const user = userEvent.setup()
    await user.click(groceries)
    const lidl = (await screen.findByText('LIDL 1')).closest('li')!
    expect(within(lidl).getByText('12 Oct 2026')).toBeInTheDocument()
    expect(within(lidl).getByText('-£15.00')).toBeInTheDocument()
    const back = screen.getByText('LIDL BACK').closest('li')!
    expect(within(back).getByText('Refund')).toBeInTheDocument()
    await user.click(await rowButton('Travel'))
    expect(await screen.findByText('RAIL')).toBeInTheDocument()
    expect(screen.queryByText('LIDL 1')).not.toBeInTheDocument()
  })

  it('renders at most 100 transactions until "Show all"', async () => {
    const db = await freshDb()
    const rows = Array.from({ length: 130 }, (_, i) => tx({ description: `MARKET ${i}`, amountPence: -100, categoryId: 'groceries-and-food' }))
    const user = await setup(db, rows)
    await user.click(await rowButton('Groceries and food'))
    const list = await screen.findByRole('list', { name: 'Groceries and food transactions' })
    expect(list.children).toHaveLength(100)
    await user.click(screen.getByRole('button', { name: 'Show all 130' }))
    expect(list.children).toHaveLength(130)
  })

  it('shows an import prompt with no transactions, and still lets you set a limit', async () => {
    const db = await freshDb()
    const user = await setup(db)
    expect(await screen.findByText('Import a statement to see where your money goes.')).toBeInTheDocument()
    await user.click(await rowButton('Travel'))
    await user.type(screen.getByLabelText('Set monthly limit'), '150')
    await user.click(screen.getByRole('button', { name: 'Save limit' }))
    expect(await screen.findByText('Limit saved for Travel.')).toBeInTheDocument()
    expect((await db.categories.get('travel'))?.monthlyLimitPence).toBe(15000)
    expect(await screen.findByText('£0.00 of £150.00')).toBeInTheDocument()
  })
})

describe('Budget: months', () => {
  it('respects a start day of 25 and moves with previous and next', async () => {
    const db = await freshDb({ startDay: 25 })
    const user = await setup(db, [
      tx({ date: '2026-10-25', amountPence: -1000, categoryId: 'travel' }),
      tx({ date: '2026-10-24', amountPence: -2000, categoryId: 'travel' }),
    ])
    expect(await screen.findByLabelText('Budget month')).toHaveValue('2026-10')
    expect(screen.getByText('25 Oct – 24 Nov 2026')).toBeInTheDocument()
    expect(spentFigure()).toBe('£10.00')
    await user.click(screen.getByRole('button', { name: 'Previous month' }))
    expect(screen.getByLabelText('Budget month')).toHaveValue('2026-09')
    expect(screen.getByText('25 Sep – 24 Oct 2026')).toBeInTheDocument()
    expect(spentFigure()).toBe('£20.00')
    expect(screen.getByRole('button', { name: 'Previous month' })).toHaveAttribute('aria-disabled', 'true')
    await user.click(screen.getByRole('button', { name: 'Next month' }))
    expect(screen.getByLabelText('Budget month')).toHaveValue('2026-10')
    expect(screen.getByRole('button', { name: 'Next month' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('jumps to a month with the select and lists months back to the earliest transaction', async () => {
    const db = await freshDb()
    const user = await setup(db, [tx({ date: '2026-07-04', amountPence: -500, categoryId: 'travel' })])
    const select = await screen.findByLabelText('Budget month')
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'October 2026', 'September 2026', 'August 2026', 'July 2026',
    ])
    await user.selectOptions(select, 'July 2026')
    expect(await screen.findByText('£5.00 spent')).toBeInTheDocument()
  })
})

describe('Budget: re-categorise and learned rules', () => {
  const acme = () => [
    tx({ description: 'ACME WIDGETS 1', amountPence: -1000 }),
    tx({ description: 'ACME WIDGETS 22', amountPence: -2000, date: '2026-10-11' }),
    tx({ description: 'ACME WIDGETS 333', amountPence: -3000, date: '2026-08-03' }),
    tx({ description: 'OTHER THING', amountPence: -4000 }),
  ]

  it('applies to all similar: moves matching rows in any month, learns a rule, and a later import uses it', async () => {
    const db = await freshDb()
    const user = await setup(db, acme())
    await user.click(await rowButton('Uncategorised'))
    await recategorise(user, 'ACME WIDGETS 1', 'Entertainment')
    expect(await screen.findByText('Updated 2 similar transactions.')).toBeInTheDocument()
    const rows = await db.transactions.toArray()
    expect(rows.filter((t) => t.description.startsWith('ACME')).map((t) => t.categoryId)).toEqual(['entertainment', 'entertainment', 'entertainment'])
    expect(rows.find((t) => t.description === 'OTHER THING')?.categoryId).toBeUndefined()
    expect(await db.rules.toArray()).toEqual([
      { id: 'learned:acme widgets', matchText: 'acme widgets', categoryId: 'entertainment', source: 'learned' },
    ])
    // Focus returns to the category row because the changed row left the list.
    expect(document.activeElement).toHaveAttribute('id', 'cat-uncategorised')

    // The next import reads the rules table, exactly as the import flow does.
    const dbRules = await db.rules.toArray()
    const [row] = [{ accountId: 'cur', date: '2026-10-20', amountPence: -500, description: 'ACME WIDGETS 999' }]
    const categoryId = categorise(row.description, [...defaultRules, ...dbRules])
    await importBatch(db, [{ ...row, categoryId }])
    expect((await db.transactions.toArray()).find((t) => t.description === 'ACME WIDGETS 999')?.categoryId).toBe('entertainment')
  })

  it('changes only this row and learns nothing when "Apply to all similar" is unchecked', async () => {
    const db = await freshDb()
    const user = await setup(db, acme())
    await user.click(await rowButton('Uncategorised'))
    await recategorise(user, 'ACME WIDGETS 1', 'Entertainment', false)
    expect(await screen.findByText('Category changed.')).toBeInTheDocument()
    const rows = await db.transactions.toArray()
    expect(rows.filter((t) => t.categoryId === 'entertainment').map((t) => t.description)).toEqual(['ACME WIDGETS 1'])
    expect(await db.rules.count()).toBe(0)
  })

  it('leaves no stale learned rule when a merchant goes to a category and back to its default', async () => {
    const db = await freshDb()
    const user = await setup(db, [
      tx({ description: 'TESCO STORES 1', categoryId: 'groceries-and-food' }),
      tx({ description: 'TESCO STORES 2', categoryId: 'groceries-and-food' }),
    ])
    await user.click(await rowButton('Groceries and food'))
    await recategorise(user, 'TESCO STORES 1', 'Gifts')
    expect(await screen.findByText('Updated 1 similar transaction.')).toBeInTheDocument()
    expect(await db.rules.count()).toBe(1)
    await user.click(await rowButton('Gifts'))
    await recategorise(user, 'TESCO STORES 1', 'Groceries and food')
    await screen.findByText('Updated 1 similar transaction.')
    expect(await db.rules.count()).toBe(0)
    expect((await db.transactions.toArray()).map((t) => t.categoryId)).toEqual(['groceries-and-food', 'groceries-and-food'])
  })

  it('cannot apply to similar when the description has no merchant text', async () => {
    const db = await freshDb()
    const user = await setup(db, [tx({ description: '12345 678', amountPence: -100 })])
    await user.click(await rowButton('Uncategorised'))
    const row = (await screen.findByText('12345 678')).closest('li')!
    await user.click(within(row).getByRole('button', { name: /Change category/ }))
    const box = await screen.findByRole('checkbox', { name: 'Apply to all similar' })
    expect(box).toBeDisabled()
    expect(box).not.toBeChecked()
  })

  it('needs a category chosen, closes on Escape and returns focus to the button that opened it', async () => {
    const db = await freshDb()
    const user = await setup(db, acme())
    await user.click(await rowButton('Uncategorised'))
    const row = (await screen.findByText('OTHER THING')).closest('li')!
    const opener = within(row).getByRole('button', { name: /Change category/ })
    await user.click(opener)
    const dialog = await screen.findByRole('dialog', { name: 'Change category' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(within(dialog).getByLabelText('Category')).toHaveFocus()
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Choose a category.')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
    expect((await db.transactions.toArray()).every((t) => t.categoryId === undefined)).toBe(true)
  })

  it('keeps the dialog open with an alert and changes nothing when the save fails', async () => {
    const db = await freshDb()
    const user = await setup(db, acme())
    await user.click(await rowButton('Uncategorised'))
    const spy = vi.spyOn(db, 'transaction').mockImplementationOnce(() => Promise.reject(new Error('disk')) as never)
    await recategorise(user, 'ACME WIDGETS 1', 'Entertainment')
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't save that. Nothing was changed.")
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    spy.mockRestore()
    expect((await db.transactions.toArray()).every((t) => t.categoryId === undefined)).toBe(true)
  })
})

describe('Budget: flags', () => {
  it('flips a credit to a refund from the income list, persists it, and the spend follows', async () => {
    const db = await freshDb()
    const user = await setup(db, [
      tx({ description: 'SHOPCO CREDIT', amountPence: 1500, categoryId: 'clothes' }),
      tx({ description: 'SHOPCO', amountPence: -5000, categoryId: 'clothes' }),
    ])
    const row = (await screen.findByText('SHOPCO CREDIT')).closest('li')!
    await user.click(within(row).getByRole('button', { name: /Flags/ }))
    expect(within(row).getByText(/Importing another statement can flag matching transfers again/)).toBeInTheDocument()
    await user.click(within(row).getByRole('checkbox', { name: 'This is a refund' }))
    expect(await screen.findByText('Marked as a refund.')).toBeInTheDocument()
    expect((await db.transactions.toArray()).find((t) => t.description === 'SHOPCO CREDIT')?.isRefund).toBe(true)
    expect(await within(await rowButton('Clothes')).findByText('£35.00 spent')).toBeInTheDocument()
    expect(screen.queryByText('Unassigned income')).not.toBeInTheDocument()
    // It can be flipped back from the category list, where the Refund chip shows.
    await user.click(await rowButton('Clothes'))
    const listed = (await screen.findAllByText('SHOPCO CREDIT')).map((e) => e.closest('li')!).find((li) => li.closest('.cat'))!
    expect(within(listed).getByText('Refund')).toBeInTheDocument()
    await user.click(within(listed).getByRole('button', { name: /Flags/ }))
    await user.click(within(listed).getByRole('checkbox', { name: 'This is a refund' }))
    await screen.findByText('No longer a refund.')
    expect((await db.transactions.toArray()).find((t) => t.description === 'SHOPCO CREDIT')?.isRefund).toBe(false)
  })

  it('flips the transfer flag: the row stays listed with a chip but leaves the spend', async () => {
    const db = await freshDb()
    const user = await setup(db, [tx({ description: 'MOVE', amountPence: -5000, categoryId: 'travel' })])
    await user.click(await rowButton('Travel'))
    const row = (await screen.findByText('MOVE')).closest('li')!
    await user.click(within(row).getByRole('button', { name: /Flags/ }))
    await user.click(within(row).getByRole('checkbox', { name: 'This is a transfer' }))
    expect(await within(row).findByText('Transfer')).toBeInTheDocument()
    expect((await db.transactions.toArray())[0].isTransfer).toBe(true)
    await screen.findByText('Marked as a transfer.')
    await vi.waitFor(() => expect(spentFigure()).toBe('£0.00'))
  })
})

describe('Budget: category limits', () => {
  it('sets a limit, then clears it by saving blank', async () => {
    const db = await freshDb()
    const user = await setup(db, [tx({ amountPence: -4000, categoryId: 'groceries-and-food' })])
    await user.click(await rowButton('Groceries and food'))
    const input = await screen.findByLabelText('Set monthly limit')
    await user.type(input, '250')
    await user.click(screen.getByRole('button', { name: 'Save limit' }))
    expect(await screen.findByText('£40.00 of £250.00')).toBeInTheDocument()
    expect((await db.categories.get('groceries-and-food'))?.monthlyLimitPence).toBe(25000)
    await user.clear(screen.getByLabelText('Set monthly limit'))
    await user.click(screen.getByRole('button', { name: 'Save limit' }))
    expect(await screen.findByText('Limit removed for Groceries and food.')).toBeInTheDocument()
    expect((await db.categories.get('groceries-and-food'))?.monthlyLimitPence).toBe(0)
    expect(within(await rowButton('Groceries and food')).getByText('No limit set')).toBeInTheDocument()
  })

  it('rejects an unreadable limit and writes nothing', async () => {
    const db = await freshDb()
    const user = await setup(db, [tx({ categoryId: 'travel' })])
    await user.click(await rowButton('Travel'))
    await user.type(await screen.findByLabelText('Set monthly limit'), 'abc')
    await user.click(screen.getByRole('button', { name: 'Save limit' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter an amount like 250.00')
    expect((await db.categories.get('travel'))?.monthlyLimitPence).toBe(0)
  })
})

describe('Budget: income by stream', () => {
  const pay = () => [
    tx({ description: 'ACME PAYROLL 0926', amountPence: 280000, date: '2026-10-01' }),
    tx({ description: 'ACME PAYROLL 0826', amountPence: 280000, date: '2026-08-01' }),
    tx({ description: 'ACME PAYROLL REFUND', amountPence: 1000, date: '2026-10-03', isRefund: true }),
    tx({ description: 'FREELANCE JOB', amountPence: 50000, date: '2026-10-05' }),
  ]

  it('shows received against expected per stream and lists unassigned credits', async () => {
    const db = await freshDb({ streams: [SALARY] })
    await setup(db, [tx({ description: 'EMPLOYER', amountPence: 250000, incomeStreamId: 'salary' }), ...pay().slice(0, 1)])
    const section = (await screen.findByRole('heading', { name: 'Income' })).closest('section')!
    const stream = within(section).getByText('Salary').closest('li')!
    expect(within(stream).getByText('£2,500.00')).toBeInTheDocument()
    expect(within(stream).getByText('£3,000.00')).toBeInTheDocument()
    const un = within(section).getByText('Unassigned income').closest('li')!
    expect(within(un).getByText('ACME PAYROLL 0926')).toBeInTheDocument()
  })

  it('assigns a credit and, by default, every similar credit in any month, leaving refunds alone', async () => {
    const db = await freshDb({ streams: [SALARY] })
    const user = await setup(db, pay())
    const un = (await screen.findByText('Unassigned income')).closest('li')!
    const row = within(un).getByText('ACME PAYROLL 0926').closest('li')!
    await user.click(within(row).getByRole('button', { name: /Assign/ }))
    await user.selectOptions(within(row).getByLabelText('Assign to stream'), 'Salary')
    expect(within(row).getByRole('checkbox', { name: 'Apply to all similar' })).toBeChecked()
    await user.click(within(row).getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Assigned 2 credits.')).toBeInTheDocument()
    const rows = await db.transactions.toArray()
    const by = Object.fromEntries(rows.map((t) => [t.description, t.incomeStreamId]))
    expect(by['ACME PAYROLL 0926']).toBe('salary')
    expect(by['ACME PAYROLL 0826']).toBe('salary')
    expect(by['ACME PAYROLL REFUND']).toBeUndefined()
    expect(by['FREELANCE JOB']).toBeUndefined()
  })

  it('assigns only one credit when "Apply to all similar" is unchecked', async () => {
    const db = await freshDb({ streams: [SALARY] })
    const user = await setup(db, pay())
    const row = (await screen.findByText('ACME PAYROLL 0926')).closest('li')!
    await user.click(within(row).getByRole('button', { name: /Assign/ }))
    await user.selectOptions(within(row).getByLabelText('Assign to stream'), 'Salary')
    await user.click(within(row).getByRole('checkbox', { name: 'Apply to all similar' }))
    await user.click(within(row).getByRole('button', { name: 'Save' }))
    await screen.findByText('Assigned.')
    expect((await db.transactions.toArray()).filter((t) => t.incomeStreamId).map((t) => t.description)).toEqual(['ACME PAYROLL 0926'])
  })

  it('asks for a stream before assigning', async () => {
    const db = await freshDb({ streams: [SALARY] })
    const user = await setup(db, pay())
    const row = (await screen.findByText('FREELANCE JOB')).closest('li')!
    await user.click(within(row).getByRole('button', { name: /Assign/ }))
    await user.click(within(row).getByRole('button', { name: 'Save' }))
    expect(await within(row).findByRole('alert')).toHaveTextContent('Choose a stream.')
  })

  it('adds an income stream inline when there are none, then assigns to it', async () => {
    const db = await freshDb()
    const user = await setup(db, pay().slice(3))
    await user.click(await screen.findByRole('button', { name: 'Add income stream' }))
    await user.type(screen.getByLabelText('Stream name'), 'Freelance')
    await user.type(screen.getByLabelText('Expected monthly net amount'), '500')
    await user.click(screen.getByRole('button', { name: 'Add stream' }))
    expect(await screen.findByText('Added Freelance.')).toBeInTheDocument()
    expect(await db.incomeStreams.toArray()).toMatchObject([{ label: 'Freelance', expectedMonthlyNetPence: 50000 }])
    expect(screen.getByRole('button', { name: 'Add income stream' })).toHaveFocus()
    const row = (await screen.findByText('FREELANCE JOB')).closest('li')!
    await user.click(within(row).getByRole('button', { name: /Assign/ }))
    await user.selectOptions(within(row).getByLabelText('Assign to stream'), 'Freelance')
    await user.click(within(row).getByRole('button', { name: 'Save' }))
    await screen.findByText('Assigned.')
    expect((await db.transactions.toArray())[0].incomeStreamId).toBe((await db.incomeStreams.toArray())[0].id)
  })

  it('validates the new stream form', async () => {
    const db = await freshDb()
    const user = await setup(db)
    await user.click(await screen.findByRole('button', { name: 'Add income stream' }))
    await user.click(screen.getByRole('button', { name: 'Add stream' }))
    expect(await screen.findByText('Enter a name')).toBeInTheDocument()
    expect(await db.incomeStreams.count()).toBe(0)
  })

  it('does not count business-account money as income', async () => {
    const db = await freshDb()
    await setup(db, [tx({ accountId: 'biz', amountPence: 90000, description: 'DIVIDEND' })])
    await screen.findByRole('heading', { name: 'Income' })
    expect(screen.queryByText('Unassigned income')).not.toBeInTheDocument()
    expect(screen.queryByText('DIVIDEND')).not.toBeInTheDocument()
  })
})
