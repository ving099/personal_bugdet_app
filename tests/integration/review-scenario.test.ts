/* Adapted from the final review's cross-module scenario: the money path from CSV to the plan. */
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { monthSummary, smoothedIncome, trailingSpend } from '../../src/budget/summary'
import type { Account, ImportProfile } from '../../src/domain/types'
import { parseCsv } from '../../src/import/csv'
import { applyProfile } from '../../src/import/profile'
import { openDb, type BudgetDB } from '../../src/storage/db'
import { seedDefaults } from '../../src/storage/seed'
import { assignStream, recategorise, setFlag } from '../../src/ui/screens/budget/budgetDb'
import { unassignedCredits } from '../../src/ui/screens/budget/budgetModel'
import { importFiles } from '../../src/ui/screens/import/importDb'
import { loadInvestData } from '../../src/ui/screens/invest/investDb'
import { buildInvestView } from '../../src/ui/screens/invest/investModel'

const TODAY = '2026-10-26'
const opened: BudgetDB[] = []
afterEach(async () => {
  for (const db of opened.splice(0)) {
    db.close()
    await Dexie.delete(db.name)
  }
})

const profile: ImportProfile = {
  id: 'p', bank: 'X', dateFormat: 'YYYY-MM-DD', dateColumn: 0, descriptionColumn: 1, amountMode: 'single',
  amountColumn: 2, signConvention: 'negativeIsOut', headerRows: 1,
}
const accounts: Account[] = [
  { id: 'cur', name: 'Current', bank: 'A', kind: 'current', importProfileId: 'p' },
  { id: 'card', name: 'Card', bank: 'B', kind: 'creditCard', importProfileId: 'p' },
  { id: 'biz', name: 'Business', bank: 'A', kind: 'business', importProfileId: 'p' },
  { id: 'sav', name: 'Savings', bank: 'A', kind: 'savings', importProfileId: 'p' },
]

const CUR = `Date,Description,Amount
2026-07-28,TESCO STORES 1111,-83.33
2026-08-01,LOAN REPAYMENT,-150.00
2026-08-28,ACME LTD SALARY,2500.00
2026-08-28,TESCO STORES 2222,-83.33
2026-08-30,TRANSFER TO SAVINGS,-200.00
2026-09-01,LOAN REPAYMENT,-150.00
2026-09-05,BARCLAYCARD PAYMENT,-300.00
2026-09-10,TRANSFER FROM BIZ LTD,1000.00
2026-09-28,ACME LTD SALARY,2500.00
2026-09-28,TESCO STORES 3333,-83.33
2026-10-01,LOAN REPAYMENT,-150.00
2026-10-05,BARCLAYCARD PAYMENT,-250.00
2026-10-20,TRADING 212 TOP UP,-100.00
2026-10-26,TESCO STORES 4444,-10.00
`
const CARD = `Date,Description,Amount
2026-08-02,SHELL FILLING STN,-45.20
2026-09-02,SHELL FILLING STN,-45.20
2026-09-07,PAYMENT RECEIVED THANK YOU,300.00
2026-09-15,NETFLIX.COM,-10.99
`
const BIZ = `Date,Description,Amount
2026-09-01,CLIENT INVOICE 42,3000.00
2026-09-10,TRANSFER TO PERSONAL,-1000.00
`
const SAV = `Date,Description,Amount
2026-08-30,TRANSFER FROM CURRENT,200.00
`

async function fresh(): Promise<BudgetDB> {
  const db = openDb(`review-scenario-${Date.now()}-${Math.random()}`)
  opened.push(db)
  await seedDefaults(db)
  await db.settings.update('main', { onboardingDone: true, budgetMonthStartDay: 25 })
  await db.accounts.bulkPut(accounts)
  await db.importProfiles.put(profile)
  await db.incomeStreams.put({ id: 'sal', label: 'Salary', expectedMonthlyNetPence: 260000 })
  await db.debts.put({
    id: 'loan', name: 'Car loan', kind: 'loan', balancePence: 500000, creditLimitOrOriginalPence: 800000, aprPercent: 5.9,
    minimumPaymentPence: 15000,
  })
  return db
}

const file = (name: string, text: string, accountId: string) => ({ name, rows: applyProfile(parseCsv(text), profile, accountId) })

async function importAll(db: BudgetDB) {
  const r = await importFiles(db, [file('cur.csv', CUR, 'cur'), file('card.csv', CARD, 'card'), file('biz.csv', BIZ, 'biz'), file('sav.csv', SAV, 'sav')])
  expect(r.failed).toBeUndefined()
  expect(r.flagsFailed).toBeUndefined()
}

describe('review scenario', () => {
  it('money from the business account is income on the personal side (I3, part 2 important 2)', async () => {
    const db = await fresh()
    await importAll(db)
    const txs = await db.transactions.toArray()
    expect(txs.find((t) => t.description === 'TRANSFER FROM BIZ LTD')?.isTransfer).toBe(false)
    expect(txs.find((t) => t.description === 'TRANSFER TO SAVINGS')?.isTransfer).toBe(true)
    expect(txs.find((t) => t.description === 'PAYMENT RECEIVED THANK YOU')?.isTransfer).toBe(true)
    // The keyword rules file it under Transfers, but it is not a matched pair, so it counts as income.
    const bizIn = txs.find((t) => t.description === 'TRANSFER FROM BIZ LTD')!
    expect(bizIn.categoryId).toBe('transfers')
    let data = (await loadInvestData(db))!
    const aug = monthSummary({ month: '2026-08', startDay: 25, txs: data.txs, accounts, categories: data.categories, streams: data.streams })
    // 28 Aug salary + 10 Sep business money fall in the 25 Aug - 24 Sep budget month.
    expect(aug.totalIncomePence).toBe(250000 + 100000)
    const augTxs = data.txs.filter((t) => t.date >= '2026-08-25' && t.date <= '2026-09-24')
    expect(unassignedCredits(augTxs, accounts, data.categories).map((t) => t.description)).toContain('TRANSFER FROM BIZ LTD')

    // Assigned to a stream, it gives that stream real history.
    await db.incomeStreams.put({ id: 'draw', label: 'Business drawings', expectedMonthlyNetPence: 150000 })
    await assignStream(db, bizIn.id, 'draw', false)
    data = (await loadInvestData(db))!
    const inc = smoothedIncome({ asOfMonth: '2026-10', startDay: 25, txs: data.txs, accounts, streams: data.streams, categories: data.categories })
    expect(inc.perStream.draw).toBe(100000)

    // Filed under Transfers by hand, it is the owner's decision and stays out.
    await recategorise(db, bizIn.id, 'transfers', false)
    data = (await loadInvestData(db))!
    const after = monthSummary({ month: '2026-08', startDay: 25, txs: data.txs, accounts, categories: data.categories, streams: data.streams })
    expect(after.totalIncomePence).toBe(250000)
  })

  it('manual un-flag survives the next import (I3)', async () => {
    const db = await fresh()
    await importAll(db)
    const out = (await db.transactions.toArray()).find((t) => t.description === 'TRANSFER TO SAVINGS')!
    expect(out.isTransfer).toBe(true)
    await setFlag(db, out.id, 'isTransfer', false)
    await importFiles(db, [file('sav2.csv', 'Date,Description,Amount\n2026-10-30,INTEREST,1.50\n', 'sav')])
    const after = (await db.transactions.get(out.id))!
    expect(after.isTransfer).toBe(false)
    expect(after.flagsEditedByUser).toBe(true)
  })

  it('an unmatched card repayment is not spending; loan payments and platform top-ups are not either (I1, I2)', async () => {
    const db = await fresh()
    await importAll(db)
    const data = (await loadInvestData(db))!
    const oct = data.txs.find((t) => t.description === 'BARCLAYCARD PAYMENT' && t.date === '2026-10-05')!
    expect(oct.isTransfer).toBe(false)
    // Budget month 25 Sep - 24 Oct: Tesco 83.33 only (loan DD, unmatched card repayment and Trading 212 left out).
    const sep = monthSummary({ month: '2026-09', startDay: 25, txs: data.txs, accounts, categories: data.categories, streams: data.streams })
    expect(sep.totalSpentPence).toBe(8333)
    const view = buildInvestView(data, TODAY)
    const spend = trailingSpend({ asOfMonth: '2026-10', startDay: 25, txs: data.txs, accounts, categories: data.categories })
    expect(view.input.spendPence).toBe(spend.averagePence)
    expect(view.input.debtMinimumsPence).toBe(15000)
    const loanOnly = trailingSpend({
      asOfMonth: '2026-10', startDay: 25, txs: data.txs.filter((t) => t.description === 'LOAN REPAYMENT'), accounts, categories: data.categories,
    })
    expect(loanOnly).toEqual({ averagePence: 0, monthsUsed: 0 })
  })

  it('refund-heavy history neither makes spending negative nor throws (C1)', async () => {
    const db = await fresh()
    await importFiles(db, [file('cur.csv', 'Date,Description,Amount\n2026-09-01,JOHN LEWIS,-20.00\n2026-09-20,JOHN LEWIS,200.00\n', 'cur')])
    const data = (await loadInvestData(db))!
    expect(data.txs.find((t) => t.amountPence > 0)?.isRefund).toBe(true)
    const spend = trailingSpend({ asOfMonth: '2026-10', startDay: 25, txs: data.txs, accounts, categories: data.categories })
    expect(spend.averagePence).toBeGreaterThanOrEqual(0)
    expect(() => buildInvestView(data, TODAY)).not.toThrow()
    expect(buildInvestView(data, TODAY).investable.ok).toBe(true)
  })
})
