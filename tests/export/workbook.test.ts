import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { monthSummary } from '../../src/budget/summary'
import type { Account, Category, Debt, IncomeStream, InvestmentLog, SavingsPot, SinkingFund, Transaction } from '../../src/domain/types'
import { buildWorkbook, type ExportData } from '../../src/export/workbook'
import type { MonthlyPlan } from '../../src/invest/plan'

const accounts: Account[] = [{ id: 'a1', name: 'Current', bank: 'X', kind: 'current' }]
const categories: Category[] = [
  { id: 'groc', name: 'Groceries', monthlyLimitPence: 30000, excludedFromSpending: false },
  { id: 'fun', name: 'Fun', monthlyLimitPence: 10000, excludedFromSpending: false },
]
const streams: IncomeStream[] = [{ id: 's1', label: 'Salary', expectedMonthlyNetPence: 300000 }]
const tx = (id: string, amountPence: number, extra: Partial<Transaction> = {}): Transaction => ({
  id, accountId: 'a1', date: '2026-10-05', amountPence, description: id, fingerprint: id, batchId: 'b',
  isTransfer: false, isRefund: false, ...extra,
})
const txs: Transaction[] = [
  tx('t1', -25000, { categoryId: 'groc' }),
  tx('t2', -5000, { categoryId: 'fun', description: '=HYPERLINK("http://x","y")' }),
  tx('t3', -1234),
  tx('t4', 300000, { incomeStreamId: 's1' }),
  tx('t5', 4000),
]
const debts: Debt[] = [
  { id: 'd1', name: 'Card', kind: 'card', balancePence: 300000, creditLimitOrOriginalPence: 500000, aprPercent: 22.9, minimumPaymentPence: 7500 },
  { id: 'd2', name: 'Loan', kind: 'loan', balancePence: 400000, creditLimitOrOriginalPence: 1000000, aprPercent: 6, minimumPaymentPence: 20000 },
  { id: 'd3', name: 'Odd', kind: 'card', balancePence: 100, creditLimitOrOriginalPence: 0, aprPercent: 0, minimumPaymentPence: 0 },
]
const savings: SavingsPot[] = [{ id: 'p1', name: 'Rainy', balancePence: 150000, targetPence: 300000, isEmergencyFund: true }]
const sinking: SinkingFund[] = [{ id: 'f1', name: 'Car tax', yearlyAmountPence: 120000, dueMonth: 3 }]
const log: InvestmentLog[] = [
  { id: 'l1', month: '2026-10', taxYear: '2026/27', wrapper: 'isa', holdingId: 'h1', plannedPence: 10000, actualPence: 9000, platformId: 'p' },
  { id: 'l2', month: '2026-09', taxYear: '2026/27', wrapper: 'isa', holdingId: 'h1', plannedPence: 1, actualPence: 1, platformId: 'p' },
]
const okPlan: MonthlyPlan = {
  ok: true, totalPence: 10000, extraDebtPence: 500, emergencyTopUpPence: 700,
  lines: [{ wrapper: 'isa', pence: 10000, platformId: 'hl', holdings: [{ holdingId: 'h1', bucket: 'growth', pence: 10000 }] }],
  holdings: [{ holdingId: 'h1', bucket: 'growth', pence: 10000 }],
  effectiveSplit: { growth: 80, aggressive: 20 }, investableLines: [], biggestDrainLabel: '',
  notes: ['a note'], warnings: ['a warning'],
}

function data(over: Partial<ExportData> = {}): ExportData {
  const summary = monthSummary({ month: '2026-10', startDay: 1, txs, accounts, categories, streams })
  return {
    month: '2026-10', summary, txs, categories, streams, debts, savings, sinking, plan: okPlan, log, accounts,
    allowances: {
      taxYear: '2026/27',
      limits: { pension: 6000000, isa: 2000000, lisa: 400000, gia: 0 },
      used: { pension: 0, isa: 500000, lisa: 0, gia: 0 },
    },
    ...over,
  }
}
async function load(d: ExportData) {
  const buf = await buildWorkbook(d)
  expect(buf).toBeInstanceOf(Uint8Array)
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf as unknown as ArrayBuffer)
  return wb
}
const find3 = (ws: ExcelJS.Worksheet, label: string) => {
  let found: ExcelJS.Row | undefined
  ws.eachRow((r) => { if (!found && r.getCell(3).value === label) found = r })
  return found
}
const find = (ws: ExcelJS.Worksheet, label: string) => {
  let found: ExcelJS.Row | undefined
  ws.eachRow((r) => { if (!found && r.getCell(1).value === label) found = r })
  return found
}

describe('buildWorkbook', () => {
  it('has seven sheets in order', async () => {
    const wb = await load(data())
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      'Summary', 'Transactions', 'Budget vs actual', 'Income by stream', 'Debts', 'Savings and yearly bills', 'Investment plan',
    ])
  })

  it('summary totals match the app with cached formula results', async () => {
    const d = data()
    const ws = (await load(d)).getWorksheet('Summary')!
    const spent = find(ws, 'Total spent')!.getCell(2)
    expect(spent.result).toBe(d.summary.totalSpentPence / 100)
    expect(typeof spent.formula).toBe('string')
    expect(spent.numFmt).toBe('£#,##0.00')
    expect(find(ws, 'Total income')!.getCell(2).result).toBe(d.summary.totalIncomePence / 100)
    expect(find(ws, 'Left to invest-or-save')!.getCell(2).result).toBe(d.summary.leftPence / 100)
  })

  it('writes one transaction row each plus header, frozen and filtered', async () => {
    const ws = (await load(data())).getWorksheet('Transactions')!
    expect(ws.rowCount).toBe(txs.length + 1)
    expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 })
    expect(ws.autoFilter).toBeTruthy()
    expect(ws.getRow(2).getCell(1).value).toBeInstanceOf(Date)
    expect(ws.getRow(2).getCell(1).numFmt).toBe('dd/mm/yyyy')
    expect(ws.getRow(2).getCell(2).value).toBe('Current')
  })

  it('stores formula-looking descriptions as strings', async () => {
    const ws = (await load(data())).getWorksheet('Transactions')!
    const cell = find3(ws, '=HYPERLINK("http://x","y")')!.getCell(3)
    expect(cell.type).toBe(ExcelJS.ValueType.String)
    expect(cell.value).toBe('=HYPERLINK("http://x","y")')
    expect(cell.formula).toBeUndefined()
  })

  it('budget vs actual has cached differences', async () => {
    const ws = (await load(data())).getWorksheet('Budget vs actual')!
    const g = find(ws, 'Groceries')!
    expect(g.getCell(2).value).toBe(300)
    expect(g.getCell(3).value).toBe(250)
    expect(g.getCell(4).result).toBe(50)
    expect(find(ws, 'Uncategorised')!.getCell(3).value).toBe(12.34)
    expect(find(ws, 'Total')!.getCell(3).result).toBe(data().summary.totalSpentPence / 100)
  })

  it('income by stream names unassigned', async () => {
    const ws = (await load(data())).getWorksheet('Income by stream')!
    expect(find(ws, 'Salary')!.getCell(2).value).toBe(3000)
    expect(find(ws, 'Unassigned')!.getCell(2).value).toBe(40)
    expect(find(ws, 'Total')!.getCell(2).result).toBe(3040)
  })

  it('debts show utilisation for cards and percent paid for loans, blank when undefined', async () => {
    const ws = (await load(data())).getWorksheet('Debts')!
    const card = find(ws, 'Card')!
    expect(card.getCell(7).value).toBeCloseTo(0.6)
    expect(card.getCell(7).numFmt).toBe('0.0%')
    expect(card.getCell(8).value).toBeNull()
    const loan = find(ws, 'Loan')!
    expect(loan.getCell(8).value).toBeCloseTo(0.6)
    expect(loan.getCell(7).value).toBeNull()
    expect(find(ws, 'Odd')!.getCell(7).value).toBeNull()
    expect(find(ws, 'Total')!.getCell(3).result).toBe(7001)
  })

  it('savings and sinking funds', async () => {
    const ws = (await load(data())).getWorksheet('Savings and yearly bills')!
    expect(find(ws, 'Rainy')!.getCell(2).value).toBe(1500)
    const fund = find(ws, 'Car tax')!
    expect(fund.getCell(2).value).toBe(1200)
    expect(fund.getCell(3).value).toBe(100)
    expect(fund.getCell(3).numFmt).toBe('£#,##0.00')
    expect(find(ws, 'Yearly bill')!.getCell(2).value).toBe('Yearly amount')
  })

  it('investment plan shows lines, warnings, allowances and the month log', async () => {
    const ws = (await load(data())).getWorksheet('Investment plan')!
    const texts: unknown[] = []
    ws.eachRow((r) => r.eachCell((c) => texts.push(c.value)))
    expect(texts).toContain('a warning')
    expect(texts).toContain('a note')
    expect(texts).toContain('Allowances 2026/27')
    expect(find(ws, 'ISA')!.getCell(3).value).toBe(100)
    expect(find(ws, 'ISA allowance')!.getCell(4).result).toBe(15000)
    expect(find(ws, 'Logged investments')).toBeTruthy()
    expect(texts).not.toContain(0.01)
  })

  it('shows reason when plan is not ok', async () => {
    const plan = { ...okPlan, ok: false, reason: 'no-surplus' as const, lines: [], holdings: [] }
    const ws = (await load(data({ plan }))).getWorksheet('Investment plan')!
    const texts: unknown[] = []
    ws.eachRow((r) => r.eachCell((c) => texts.push(String(c.value))))
    expect(texts.some((t) => t.includes('Nothing is left to invest this month'))).toBe(true)
    expect(texts.some((t) => t.includes('no-surplus'))).toBe(false)
  })

  it('sorts transactions by date then description', async () => {
    const extra = [tx('b-late', -1, { date: '2026-10-09' }), tx('a-early', -1, { date: '2026-10-01' })]
    const ws = (await load(data({ txs: [...extra, ...txs] }))).getWorksheet('Transactions')!
    const descs: string[] = []
    ws.eachRow((r, n) => { if (n > 1) descs.push(String(r.getCell(3).value)) })
    expect(descs[0]).toBe('a-early')
    expect(descs.at(-1)).toBe('b-late')
    expect(descs.slice(1, -1)).toEqual([...descs.slice(1, -1)].sort((a, b) => a.localeCompare(b)))
  })

  it('uses plain labels and hides noise', async () => {
    const withTransfers: Category[] = [
      ...categories,
      { id: 'xfer', name: 'Transfers', monthlyLimitPence: 0, excludedFromSpending: true },
      { id: 'empty', name: 'Empty', monthlyLimitPence: 0, excludedFromSpending: false },
    ]
    const d = data({
      categories: withTransfers,
      txs: [...txs, tx('lost', -100, { categoryId: 'gone' })],
      platforms: [{ id: 'hl', name: 'Hargreaves Lansdown', wrappersSupported: ['isa'], notes: '', lastChecked: '2026-01-01' }],
      monthText: '25 Sep 2026 to 24 Oct 2026',
    })
    const wb = await load(d)
    const bva = wb.getWorksheet('Budget vs actual')!
    expect(find(bva, 'Transfers')).toBeUndefined()
    expect(find(bva, 'Empty')).toBeUndefined()
    const names: unknown[] = []
    bva.eachRow((r) => names.push(r.getCell(1).value))
    expect(names).toEqual(expect.arrayContaining(['Groceries', 'Fun']))
    expect(find3(wb.getWorksheet('Transactions')!, 'lost')!.getCell(5).value).toBe('Unknown category')
    const debtsWs = wb.getWorksheet('Debts')!
    expect(find(debtsWs, 'Card')!.getCell(2).value).toBe('Credit card')
    expect(find(debtsWs, 'Loan')!.getCell(2).value).toBe('Loan')
    expect(find(debtsWs, 'Card')!.getCell(5).value).toBeCloseTo(0.229)
    const plan = wb.getWorksheet('Investment plan')!
    const texts: unknown[] = []
    plan.eachRow((r) => r.eachCell((c) => texts.push(c.value)))
    expect(texts).toEqual(expect.arrayContaining(['Hargreaves Lansdown', 'Growth', 'Used this tax year (to date)']))
    expect(find(wb.getWorksheet('Summary')!, 'Month')!.getCell(2).value).toBe('25 Sep 2026 to 24 Oct 2026')
  })

  it('rounds percent cells to one decimal place', async () => {
    const odd: Debt[] = [{ id: 'x', name: 'Odd APR', kind: 'card', balancePence: 123457, creditLimitOrOriginalPence: 300000, aprPercent: 22.94, minimumPaymentPence: 1 }]
    const ws = (await load(data({ debts: odd }))).getWorksheet('Debts')!
    const row = find(ws, 'Odd APR')!
    expect(row.getCell(5).value).toBe(0.229)
    expect(row.getCell(7).value).toBe(0.412)
  })

  it('builds with everything empty', async () => {
    const summary = monthSummary({ month: '2026-10', startDay: 1, txs: [], accounts: [], categories: [], streams: [] })
    const wb = await load(data({ summary, txs: [], categories: [], streams: [], debts: [], savings: [], sinking: [], plan: null, log: [], accounts: [] }))
    expect(wb.worksheets).toHaveLength(7)
    const ws = wb.getWorksheet('Investment plan')!
    expect(find(ws, 'A plan is only worked out for the current budget month.')).toBeTruthy()
    expect(find(wb.getWorksheet('Debts')!, 'Total')!.getCell(3).result).toBe(0)
    expect(find(wb.getWorksheet('Income by stream')!, 'Total')!.getCell(2).result).toBe(0)
  })
})
