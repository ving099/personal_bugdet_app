import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Dexie from 'dexie'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Account, Rule } from '../../src/domain/types'
import { openDb, type BudgetDB } from '../../src/storage/db'
import { seedDefaults } from '../../src/storage/seed'
import { DbProvider } from '../../src/ui/DbProvider'
import Import from '../../src/ui/screens/Import'

const fixture = (name: string) => readFileSync(`tests/fixtures/${name}`, 'utf8')
const csv = (name: string, text: string) => new File([text], name, { type: 'text/csv' })

let counter = 0
const opened: BudgetDB[] = []

async function freshDb(accounts: Account[] = [ACC]): Promise<BudgetDB> {
  const db = openDb(`import-test-${Date.now()}-${counter++}`)
  opened.push(db)
  await seedDefaults(db)
  await db.accounts.bulkPut(accounts)
  return db
}

afterEach(async () => {
  cleanup()
  for (const db of opened.splice(0)) {
    db.close()
    await Dexie.delete(db.name)
  }
})

const ACC: Account = { id: 'cur', name: 'Everyday', bank: 'Testbank', kind: 'current' }
const SAV: Account = { id: 'sav', name: 'Savings', bank: 'Testbank', kind: 'savings' }
const CARD: Account = { id: 'card', name: 'Visa', bank: 'Testbank', kind: 'creditCard' }

type User = ReturnType<typeof userEvent.setup>

function setup(db: BudgetDB) {
  const user = userEvent.setup({ applyAccept: false })
  render(
    <DbProvider db={db}>
      <Import />
    </DbProvider>,
  )
  return user
}

async function pickAccount(user: User, name: string) {
  await user.selectOptions(await screen.findByLabelText('Account'), name)
}

async function upload(user: User, ...files: File[]) {
  await user.upload(screen.getByLabelText('Choose statement files'), files)
}

/** Uploads to an account with no profile and saves the guessed mapping. */
async function mapAndPreview(user: User, ...files: File[]) {
  await upload(user, ...files)
  await user.click(await screen.findByRole('button', { name: 'Save mapping' }))
  await screen.findByRole('heading', { name: 'Check before importing' })
}

async function importNow(user: User) {
  await user.click(await screen.findByRole('button', { name: /^Import \d+ transaction/ }))
  await screen.findByRole('heading', { name: 'Done' })
}

const txsOf = (db: BudgetDB, accountId?: string) =>
  db.transactions.toArray().then((t) => (accountId ? t.filter((x) => x.accountId === accountId) : t))

describe('Import: first upload and mapping', () => {
  it('shows an add-account form when there are no accounts, and selects the new account', async () => {
    const db = await freshDb([])
    const user = setup(db)
    expect(await screen.findByText('Add an account first')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Account name'), 'Everyday')
    await user.type(screen.getByLabelText('Bank'), 'Testbank')
    await user.click(screen.getByRole('button', { name: 'Add account' }))
    expect(await screen.findByLabelText('Account')).not.toHaveValue('')
    expect((await db.accounts.toArray())[0]).toMatchObject({ name: 'Everyday', bank: 'Testbank', kind: 'current' })
  })

  it('opens a pre-filled mapping form, saves it to the account, then previews and imports with categories', async () => {
    const db = await freshDb()
    const user = setup(db)
    await pickAccount(user, 'Everyday')
    await upload(user, csv('single-amount.csv', fixture('single-amount.csv')))
    expect(await screen.findByLabelText('Date column')).toHaveValue('0')
    expect(screen.getByLabelText('Description column')).toHaveValue('1')
    expect(screen.getByLabelText('Amount column')).toHaveValue('2')
    const sample = screen.getByRole('list', { name: 'How the first rows will be read' })
    expect(within(sample).getByText('03/04/2026 → 3 Apr 2026, -£23.45, TESCO STORES 2231')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save mapping' }))
    await screen.findByRole('heading', { name: 'Check before importing' })
    expect(screen.getByText('3 new, 0 already imported')).toBeInTheDocument()
    expect((await db.accounts.get('cur'))?.importProfileId).toBe('profile:cur')
    await importNow(user)
    expect(screen.getByText('Imported 3 transactions.')).toBeInTheDocument()
    const rows = await txsOf(db)
    expect(rows).toHaveLength(3)
    const tesco = rows.find((r) => r.description.startsWith('TESCO'))
    expect(tesco?.categoryId).toBe('groceries-and-food')
    expect(tesco?.sourceFile).toBe('single-amount.csv')
  })

  it('lets a learned rule override the default', async () => {
    const db = await freshDb()
    const learned: Rule = { id: 'learned:tesco stores', matchText: 'tesco stores', categoryId: 'misc', source: 'learned' }
    await db.rules.put(learned)
    const user = setup(db)
    await pickAccount(user, 'Everyday')
    await mapAndPreview(user, csv('single-amount.csv', fixture('single-amount.csv')))
    await importNow(user)
    const tesco = (await txsOf(db)).find((r) => r.description.startsWith('TESCO'))
    expect(tesco?.categoryId).toBe('misc')
    expect(await db.rules.count()).toBe(1)
  })

  it('maps debit and credit columns and imports', async () => {
    const db = await freshDb()
    const user = setup(db)
    await pickAccount(user, 'Everyday')
    await upload(user, csv('debit-credit.csv', fixture('debit-credit.csv')))
    expect(await screen.findByLabelText('Amounts are in')).toHaveValue('debitCredit')
    expect(screen.getByLabelText('Money out (debit) column')).toHaveValue('2')
    await user.click(screen.getByRole('button', { name: 'Save mapping' }))
    await screen.findByRole('heading', { name: 'Check before importing' })
    await importNow(user)
    const rows = await txsOf(db)
    expect(rows.map((r) => r.amountPence).sort((a, b) => a - b)).toEqual([-6210, -450, 20000])
  })

  it('sniffs day/month from a day above 12 and says so when ambiguous', async () => {
    const db = await freshDb()
    const user = setup(db)
    await pickAccount(user, 'Everyday')
    await upload(user, csv('a.csv', 'Date,Description,Amount\n13/04/2026,A SHOP,-1.00\n'))
    expect(await screen.findByLabelText('Date format')).toHaveValue('DD/MM/YYYY')
    expect(screen.queryByText(/UK day\/month\/year is assumed/)).not.toBeInTheDocument()
    await upload(user, csv('b.csv', 'Date,Description,Amount\n04/13/2026,A SHOP,-1.00\n'))
    expect(await screen.findByLabelText('Date format')).toHaveValue('MM/DD/YYYY')
    await upload(user, csv('c.csv', 'Date,Description,Amount\n03/04/2026,A SHOP,-1.00\n'))
    expect(await screen.findByText(/UK day\/month\/year is assumed/)).toBeInTheDocument()
    expect(screen.getByLabelText('Date format')).toHaveValue('DD/MM/YYYY')
  })

  it('shows the row number for a bad row and keeps the form open', async () => {
    const db = await freshDb()
    const user = setup(db)
    await pickAccount(user, 'Everyday')
    const lines = ['Date,Description,Amount', ...Array.from({ length: 6 }, () => '03/04/2026,OK SHOP,-1.00'), '99/99/2026,BAD,-1.00']
    await upload(user, csv('bad.csv', lines.join('\n')))
    await user.click(await screen.findByRole('button', { name: 'Save mapping' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Unreadable date "99/99/2026" in row 7')
    expect(screen.getByRole('form', { name: 'Statement layout' })).toBeInTheDocument()
    expect((await db.accounts.get('cur'))?.importProfileId).toBeUndefined()
  })

  it('names a non-CSV file in an inline error while the other file still imports', async () => {
    const db = await freshDb()
    const user = setup(db)
    await pickAccount(user, 'Everyday')
    await mapAndPreview(
      user,
      new File(['%PDF'], 'statement.pdf', { type: 'application/pdf' }),
      csv('single-amount.csv', fixture('single-amount.csv')),
    )
    expect(screen.getByText("statement.pdf isn't a CSV file.")).toBeInTheDocument()
    await importNow(user)
    expect(await txsOf(db)).toHaveLength(3)
  })

  it('rejects files over 5 MB with a clear message', async () => {
    const db = await freshDb()
    const user = setup(db)
    await pickAccount(user, 'Everyday')
    const big = csv('huge.csv', 'a')
    Object.defineProperty(big, 'size', { value: 5 * 1024 * 1024 + 1 })
    await upload(user, big)
    expect(await screen.findByText(/huge\.csv is bigger than 5 MB/)).toBeInTheDocument()
  })

  it('shows the business note for business accounts', async () => {
    const db = await freshDb([{ id: 'biz', name: 'Trading', bank: 'B', kind: 'business' }, ACC])
    const user = setup(db)
    await pickAccount(user, 'Trading')
    expect(screen.getByText('Business accounts are excluded from your spending, but stay in your export.')).toBeInTheDocument()
  })
})

describe('Import: repeat, undo and history', () => {
  it('reports a repeat upload as all already imported, with no import button or undo', async () => {
    const db = await freshDb()
    const user = setup(db)
    await pickAccount(user, 'Everyday')
    await mapAndPreview(user, csv('single-amount.csv', fixture('single-amount.csv')))
    await importNow(user)
    await upload(user, csv('single-amount.csv', fixture('single-amount.csv')))
    expect(await screen.findByText('0 new, 3 already imported')).toBeInTheDocument()
    expect(screen.getByText(/Nothing new to import/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled()
    expect(screen.queryByRole('heading', { name: 'Done' })).not.toBeInTheDocument()
    expect(screen.getAllByText('Duplicate')).toHaveLength(3)
    await user.click(screen.getByLabelText('Hide duplicates'))
    expect(screen.queryByText('Duplicate')).not.toBeInTheDocument()
    expect(await txsOf(db)).toHaveLength(3)
  })

  it('undoes a batch after confirmation, and cancel leaves it', async () => {
    const db = await freshDb()
    const user = setup(db)
    await pickAccount(user, 'Everyday')
    await mapAndPreview(user, csv('single-amount.csv', fixture('single-amount.csv')))
    await importNow(user)
    await user.click(screen.getAllByRole('button', { name: 'Undo import of single-amount.csv' })[0])
    const dialog = await screen.findByRole('dialog', { name: 'Undo this import?' })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(await txsOf(db)).toHaveLength(3)
    await user.click(screen.getAllByRole('button', { name: 'Undo import of single-amount.csv' })[0])
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Undo import' }))
    await waitFor(async () => expect(await txsOf(db)).toHaveLength(0))
    expect(await screen.findByText(/Undone\. Removed 3 transactions/)).toBeInTheDocument()
  })

  it('lists batches newest first and filters by account', async () => {
    const db = await freshDb([ACC, SAV])
    const base = { description: 'X', amountPence: -100, isTransfer: false, isRefund: false }
    await db.transactions.bulkAdd([
      { ...base, id: '1', accountId: 'cur', date: '2026-01-01', fingerprint: 'f1', batchId: 'old', importedAt: '2026-01-02T09:00:00.000Z', sourceFile: 'january.csv' },
      { ...base, id: '2', accountId: 'cur', date: '2026-02-01', fingerprint: 'f2', batchId: 'new', importedAt: '2026-02-02T09:00:00.000Z', sourceFile: 'february.csv' },
      { ...base, id: '3', accountId: 'sav', date: '2026-03-01', fingerprint: 'f3', batchId: 'sv', importedAt: '2026-03-02T09:00:00.000Z', sourceFile: 'savings.csv' },
    ])
    const user = setup(db)
    await pickAccount(user, 'Everyday')
    await screen.findByText('february.csv')
    const names = () => screen.getAllByRole('listitem').map((li) => li.querySelector('.history-name')?.textContent)
    expect(names()).toEqual(['february.csv', 'january.csv'])
    await user.selectOptions(screen.getByLabelText('Show history for'), 'All accounts')
    expect(names()).toEqual(['savings.csv', 'february.csv', 'january.csv'])
  })

  it('imports once when the button is double-clicked', async () => {
    const db = await freshDb()
    const user = setup(db)
    await pickAccount(user, 'Everyday')
    await mapAndPreview(user, csv('single-amount.csv', fixture('single-amount.csv')))
    await user.dblClick(screen.getByRole('button', { name: /^Import 3 transactions/ }))
    await screen.findByRole('heading', { name: 'Done' })
    expect(new Set((await txsOf(db)).map((t) => t.batchId)).size).toBe(1)
  })

  it('keeps the preview and shows an alert when the database fails', async () => {
    const db = await freshDb()
    const user = setup(db)
    await pickAccount(user, 'Everyday')
    await mapAndPreview(user, csv('single-amount.csv', fixture('single-amount.csv')))
    vi.spyOn(db.transactions, 'bulkAdd').mockRejectedValueOnce(new Error('disk full'))
    await user.click(screen.getByRole('button', { name: /^Import 3 transactions/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't import single-amount.csv")
    expect(screen.getByRole('heading', { name: 'Check before importing' })).toBeInTheDocument()
    expect(await txsOf(db)).toHaveLength(0)
  })

  it('shows only the first 100 rows until Show all', async () => {
    const db = await freshDb()
    const user = setup(db)
    await pickAccount(user, 'Everyday')
    const lines = ['Date,Description,Amount']
    for (let i = 0; i < 150; i++) lines.push(`03/04/2026,SHOP ${i},-${i + 1}.00`)
    await mapAndPreview(user, csv('big.csv', lines.join('\n')))
    const body = () => within(screen.getByRole('region', { name: 'Rows to import' })).getAllByRole('row').length
    expect(body()).toBe(101)
    await user.click(screen.getByRole('button', { name: 'Show all 150 rows' }))
    expect(body()).toBe(151)
  })
})

describe('Import: focus, busy and edge cases', () => {
  async function importedOnce() {
    const db = await freshDb()
    const user = setup(db)
    await pickAccount(user, 'Everyday')
    await mapAndPreview(user, csv('single-amount.csv', fixture('single-amount.csv')))
    await importNow(user)
    return { db, user }
  }

  it('returns focus to the Undo button after Cancel and after Escape', async () => {
    const { user } = await importedOnce()
    const opener = () => screen.getAllByRole('button', { name: 'Undo import of single-amount.csv' })[1]
    await user.click(opener())
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    expect(opener()).toHaveFocus()
    await user.click(opener())
    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(opener()).toHaveFocus()
  })

  it('moves focus to the preview heading after saving the mapping', async () => {
    const db = await freshDb()
    const user = setup(db)
    await pickAccount(user, 'Everyday')
    await mapAndPreview(user, csv('single-amount.csv', fixture('single-amount.csv')))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Check before importing' })).toHaveFocus())
  })

  it('says an empty file is empty', async () => {
    const db = await freshDb()
    const user = setup(db)
    await pickAccount(user, 'Everyday')
    await upload(user, csv('empty.csv', '  \n'))
    expect(await screen.findByText('empty.csv is empty.')).toBeInTheDocument()
  })

  it('says when a file has headings but no transactions', async () => {
    const db = await freshDb()
    const user = setup(db)
    await pickAccount(user, 'Everyday')
    await mapAndPreview(user, csv('header-only.csv', 'Date,Description,Amount\n'))
    expect(screen.getByText('No transactions found in header-only.csv.')).toBeInTheDocument()
    expect(screen.queryByText(/already in your records/)).not.toBeInTheDocument()
  })

  it('ignores files dropped while an import is running', async () => {
    const db = await freshDb()
    const user = setup(db)
    await pickAccount(user, 'Everyday')
    await mapAndPreview(user, csv('single-amount.csv', fixture('single-amount.csv')))
    vi.spyOn(db.rules, 'filter').mockImplementationOnce(
      () => ({ toArray: () => new Promise((resolve) => setTimeout(() => resolve([]), 200)) }) as never,
    )
    await user.click(screen.getByRole('button', { name: /^Import 3 transactions/ }))
    expect(screen.getByLabelText('Account')).toBeDisabled()
    const pdf = new File(['x'], 'zzz.pdf', { type: 'application/pdf' })
    fireEvent.drop(screen.getByRole('group', { name: 'Statement files' }), { dataTransfer: { files: [pdf] } })
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByText("zzz.pdf isn't a CSV file.")).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Check before importing' })).toBeInTheDocument()
    await screen.findByRole('heading', { name: 'Done' })
  })
})

describe('Import: transfers, refunds and attention', () => {
  async function seededProfiles(db: BudgetDB) {
    const p = { id: 'p', bank: 'B', dateFormat: 'DD/MM/YYYY' as const, dateColumn: 0, descriptionColumn: 1, amountMode: 'single' as const,
      amountColumn: 2, signConvention: 'negativeIsOut' as const, headerRows: 1 }
    await db.importProfiles.put(p)
    await db.accounts.toCollection().modify({ importProfileId: 'p' })
  }
  const stmt = (rows: string[]) => ['Date,Description,Amount', ...rows].join('\n')

  it('marks both legs after the second import, and undoing one side clears the other', async () => {
    const db = await freshDb([ACC, SAV])
    await seededProfiles(db)
    const user = setup(db)
    await pickAccount(user, 'Everyday')
    await upload(user, csv('cur.csv', stmt(['03/04/2026,TO SAVINGS POT,-50.00'])))
    await user.click(await screen.findByRole('button', { name: /^Import 1 transaction/ }))
    await screen.findByRole('heading', { name: 'Done' })
    expect((await txsOf(db))[0].isTransfer).toBe(false)
    await pickAccount(user, 'Savings')
    await upload(user, csv('sav.csv', stmt(['04/04/2026,FROM CURRENT,50.00'])))
    expect(await screen.findByText('1 new, 0 already imported, 1 looks like a transfer')).toBeInTheDocument()
    expect(screen.getByText('Transfer')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Import 1 transaction/ }))
    await screen.findByRole('heading', { name: 'Done' })
    expect((await txsOf(db)).map((t) => t.isTransfer)).toEqual([true, true])
    await user.click(screen.getAllByRole('button', { name: 'Undo import of sav.csv' })[0])
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Undo import' }))
    await waitFor(async () => expect(await txsOf(db)).toHaveLength(1))
    expect((await txsOf(db))[0].isTransfer).toBe(false)
  })

  it('writes only the rows whose flags changed', async () => {
    const db = await freshDb([ACC, SAV])
    await seededProfiles(db)
    await db.transactions.bulkAdd([
      { id: 'a', accountId: 'cur', date: '2026-04-03', amountPence: -5000, description: 'TO SAV', fingerprint: 'fa', batchId: 'x', isTransfer: false, isRefund: false },
      ...Array.from({ length: 5 }, (_, i) => ({ id: `o${i}`, accountId: 'cur', date: '2026-03-01', amountPence: -100 - i, description: `OTHER ${i}`, fingerprint: `fo${i}`, batchId: 'x', isTransfer: false, isRefund: false })),
    ])
    const spy = vi.spyOn(db.transactions, 'bulkPut')
    const user = setup(db)
    await pickAccount(user, 'Savings')
    await upload(user, csv('sav.csv', stmt(['04/04/2026,FROM CURRENT,50.00'])))
    await user.click(await screen.findByRole('button', { name: /^Import 1 transaction/ }))
    await screen.findByRole('heading', { name: 'Done' })
    const written = spy.mock.calls.flatMap((c) => c[0] as { id: string }[])
    expect(written).toHaveLength(2)
    expect(written.map((r) => r.id)).toContain('a')
  })

  it('flags a refund after import', async () => {
    const db = await freshDb()
    await seededProfiles(db)
    const user = setup(db)
    await pickAccount(user, 'Everyday')
    await upload(user, csv('r.csv', stmt(['01/04/2026,ZARA 12,-10.00', '05/04/2026,ZARA 99,10.00'])))
    expect(await screen.findByText('Refund')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Import 2 transactions/ }))
    await screen.findByRole('heading', { name: 'Done' })
    expect((await txsOf(db)).filter((t) => t.isRefund)).toHaveLength(1)
  })

  it('lists a card repayment with no card-side row, and the card statement resolves it', async () => {
    const db = await freshDb([ACC, CARD])
    await seededProfiles(db)
    const user = setup(db)
    await pickAccount(user, 'Everyday')
    await upload(user, csv('cur.csv', stmt(['03/06/2026,BARCLAYCARD CREDIT CARD PAYMENT,-150.00'])))
    await user.click(await screen.findByRole('button', { name: /^Import 1 transaction/ }))
    const attention = await screen.findByRole('heading', { name: 'Needs attention' })
    const section = attention.closest('section') as HTMLElement
    expect(within(section).getByText('BARCLAYCARD CREDIT CARD PAYMENT')).toBeInTheDocument()
    expect(within(section).getByText(/isn't counted as spending/)).toBeInTheDocument()
    await pickAccount(user, 'Visa')
    await upload(user, csv('card.csv', stmt(['04/06/2026,PAYMENT RECEIVED THANK YOU,150.00'])))
    await user.click(await screen.findByRole('button', { name: /^Import 1 transaction/ }))
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Needs attention' })).not.toBeInTheDocument())
  })

  it('still shows the outcomes when re-checking transfers and refunds fails', async () => {
    const db = await freshDb()
    await seededProfiles(db)
    vi.spyOn(db.transactions, 'bulkPut').mockRejectedValue(new Error('nope'))
    const user = setup(db)
    await pickAccount(user, 'Everyday')
    await upload(user, csv('r.csv', stmt(['01/04/2026,ZARA 12,-10.00', '05/04/2026,ZARA 99,10.00'])))
    await user.click(await screen.findByRole('button', { name: /^Import 2 transactions/ }))
    await screen.findByRole('heading', { name: 'Done' })
    expect(screen.getByText('Imported 2 transactions.')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Undo import of r.csv' }).length).toBeGreaterThan(0)
    expect(screen.getByText("Imported, but transfers and refunds couldn't be re-checked. They'll be fixed on your next import.")).toBeInTheDocument()
  })
})
