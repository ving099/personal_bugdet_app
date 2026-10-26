import ExcelJS from 'exceljs'
import { percentPaid, utilisation } from '../debt/debt'
import type { monthSummary } from '../budget/summary'
import { sinkingMonthlyPence } from '../budget/summary'
import type {
  Account, Category, Debt, Holding, IncomeStream, InvestmentLog, Pence, Platform, SavingsPot, SinkingFund, Transaction, Wrapper,
} from '../domain/types'
import type { MonthlyPlan } from '../invest/plan'

/**
 * Inputs for the month-end workbook. `accounts` and `holdings` are optional lookups used only to show
 * names instead of ids. Money is integer pence; the workbook shows pounds (pence / 100).
 */
export interface ExportData {
  month: string
  /** Human text for the Summary sheet, for example 'October 2026' or '25 Sep 2026 to 24 Oct 2026'. Defaults to `month`. */
  monthText?: string
  summary: ReturnType<typeof monthSummary>
  txs: Transaction[]
  categories: Category[]
  streams: IncomeStream[]
  debts: Debt[]
  savings: SavingsPot[]
  sinking: SinkingFund[]
  plan: MonthlyPlan | null
  allowances: { taxYear: string; limits: Record<Wrapper, Pence>; used: Record<Wrapper, Pence> }
  log: InvestmentLog[]
  accounts?: Account[]
  holdings?: Holding[]
  platforms?: Platform[]
}

const GBP = '£#,##0.00'
const PCT = '0.0%'
const DATE = 'dd/mm/yyyy'
const WRAPPERS: Wrapper[] = ['pension', 'isa', 'lisa', 'gia']
const WRAPPER_LABEL: Record<Wrapper, string> = { pension: 'Pension', isa: 'ISA', lisa: 'LISA', gia: 'GIA' }

const BUCKET_LABEL: Record<string, string> = { growth: 'Growth', aggressive: 'Aggressive' }
const DEBT_KIND_LABEL: Record<string, string> = { card: 'Credit card', loan: 'Loan' }
/** Same wording as the Invest tab (reasonText), kept here so this file stays free of UI imports. */
const PLAN_REASON: Record<string, string> = {
  'no-income': 'There is no income to work from yet. Add an income stream with its expected monthly pay, or import a statement with your pay in it.',
  'no-surplus': 'Nothing is left to invest this month: your spending, bills, debt payments and safety buffer use up all of your income.',
}
/** Percent values are written to one decimal place of percent (22.94 -> 22.9%). */
const roundPct = (fraction: number) => Math.round(fraction * 1000) / 1000

const pounds = (p: Pence) => p / 100
const sumPence = (xs: Pence[]) => xs.reduce((a, b) => a + b, 0)

/*
 * Formula injection: every text value is written as a plain string cell. ExcelJS stores strings as
 * shared strings and only treats `{formula}` objects as formulas, so a description such as
 * `=HYPERLINK(...)` is inert data and is never evaluated. We therefore do not mangle the text.
 * Dates are real Excel dates (UTC midnight) formatted dd/mm/yyyy.
 */
const text = (s: string) => String(s)
const toDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

function setup(ws: ExcelJS.Worksheet, headers: string[], widths: number[]) {
  ws.addRow(headers).font = { bold: true }
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w })
}

function money(cell: ExcelJS.Cell, pence: Pence) {
  cell.value = pounds(pence)
  cell.numFmt = GBP
}

function formula(cell: ExcelJS.Cell, f: string, result: number, numFmt = GBP) {
  cell.value = { formula: f, result }
  cell.numFmt = numFmt
}

/** Adds a bold total row after one blank spacer row, with SUM formulas over rows 2..lastData+1. */
function totalRow(ws: ExcelJS.Worksheet, firstRow: number, count: number, cols: Record<number, Pence>) {
  const last = firstRow + count // spacer row stays inside the range, so an empty range still sums to 0
  const r = ws.getRow(last + 1)
  r.getCell(1).value = 'Total'
  for (const [col, pence] of Object.entries(cols)) {
    const c = r.getCell(Number(col))
    const letter = ws.getColumn(Number(col)).letter
    formula(c, `SUM(${letter}${firstRow}:${letter}${last})`, pounds(pence))
  }
  r.font = { bold: true }
  return r.number
}

function txSheet(wb: ExcelJS.Workbook, d: ExportData) {
  const ws = wb.addWorksheet('Transactions')
  setup(ws, ['Date', 'Account', 'Description', 'Amount', 'Category', 'Transfer', 'Refund'], [12, 20, 44, 14, 20, 10, 10])
  const acc = new Map((d.accounts ?? []).map((a) => [a.id, a.name]))
  const cat = new Map(d.categories.map((c) => [c.id, c.name]))
  const sorted = [...d.txs].sort((a, b) => a.date.localeCompare(b.date) || a.description.localeCompare(b.description))
  for (const t of sorted) {
    const r = ws.addRow([
      toDate(t.date), text(acc.get(t.accountId) ?? t.accountId), text(t.description), null,
      t.categoryId ? text(cat.get(t.categoryId) ?? 'Unknown category') : '', t.isTransfer ? 'Transfer' : '', t.isRefund ? 'Refund' : '',
    ])
    r.getCell(1).numFmt = DATE
    money(r.getCell(4), t.amountPence)
  }
  ws.views = [{ state: 'frozen', ySplit: 1 }]
  ws.autoFilter = { from: 'A1', to: 'G1' }
}

function budgetSheet(wb: ExcelJS.Workbook, d: ExportData) {
  const ws = wb.addWorksheet('Budget vs Actual')
  setup(ws, ['Category', 'Budgeted', 'Actual', 'Difference'], [28, 14, 14, 14])
  const spent = d.summary.spentByCategory
  const rows = d.categories
    .filter((c) => !c.excludedFromSpending)
    .map((c) => ({ name: c.name, budget: c.monthlyLimitPence, actual: spent[c.id] ?? 0 }))
    .filter((r) => r.budget !== 0 || r.actual !== 0)
  const known = new Set(d.categories.map((c) => c.id))
  for (const [key, actual] of Object.entries(spent)) {
    if (known.has(key)) continue
    if (actual !== 0) rows.push({ name: key === 'uncategorised' ? 'Uncategorised' : 'Unknown category', budget: 0, actual })
  }
  rows.forEach((row, i) => {
    const r = ws.addRow([text(row.name)])
    money(r.getCell(2), row.budget)
    money(r.getCell(3), row.actual)
    formula(r.getCell(4), `B${i + 2}-C${i + 2}`, pounds(row.budget - row.actual))
  })
  const n = rows.length
  const t = totalRow(ws, 2, n, { 2: sumPence(rows.map((r) => r.budget)), 3: d.summary.totalSpentPence })
  formula(ws.getCell(`D${t}`), `B${t}-C${t}`, pounds(sumPence(rows.map((r) => r.budget)) - d.summary.totalSpentPence))
  ws.getCell(`D${t}`).font = { bold: true }
  ws.views = [{ state: 'frozen', ySplit: 1 }]
  return { totalSpentRow: t }
}

function incomeSheet(wb: ExcelJS.Workbook, d: ExportData) {
  const ws = wb.addWorksheet('Income by Stream')
  setup(ws, ['Stream', 'Amount'], [28, 14])
  const names = new Map(d.streams.map((s) => [s.id, s.label]))
  const entries = Object.entries(d.summary.incomeByStream)
  for (const [key, pence] of entries) {
    const r = ws.addRow([text(key === 'unassigned' ? 'Unassigned' : (names.get(key) ?? key))])
    money(r.getCell(2), pence)
  }
  const t = totalRow(ws, 2, entries.length, { 2: d.summary.totalIncomePence })
  ws.views = [{ state: 'frozen', ySplit: 1 }]
  return { totalIncomeRow: t }
}

function debtSheet(wb: ExcelJS.Workbook, d: ExportData) {
  const ws = wb.addWorksheet('Debts')
  setup(ws, ['Name', 'Type', 'Balance', 'Limit / original', 'APR', 'Minimum payment', 'Utilisation', 'Percent paid'],
    [24, 10, 14, 16, 10, 16, 12, 12])
  for (const x of d.debts) {
    const r = ws.addRow([text(x.name), DEBT_KIND_LABEL[x.kind] ?? x.kind])
    money(r.getCell(3), x.balancePence)
    money(r.getCell(4), x.creditLimitOrOriginalPence)
    r.getCell(5).value = roundPct(x.aprPercent / 100)
    r.getCell(5).numFmt = PCT
    money(r.getCell(6), x.minimumPaymentPence)
    // Utilisation is for cards, percent paid for loans; blank (never NaN/Infinity) when undefined.
    const u = x.kind === 'card' ? utilisation(x) : undefined
    const p = x.kind === 'loan' ? percentPaid(x) : undefined
    if (u !== undefined && Number.isFinite(u)) { r.getCell(7).value = roundPct(u); r.getCell(7).numFmt = PCT }
    if (p !== undefined && Number.isFinite(p)) { r.getCell(8).value = roundPct(p); r.getCell(8).numFmt = PCT }
  }
  totalRow(ws, 2, d.debts.length, {
    3: sumPence(d.debts.map((x) => x.balancePence)),
    6: sumPence(d.debts.map((x) => x.minimumPaymentPence)),
  })
  ws.views = [{ state: 'frozen', ySplit: 1 }]
}

function savingsSheet(wb: ExcelJS.Workbook, d: ExportData) {
  const ws = wb.addWorksheet('Savings and Sinking Funds')
  setup(ws, ['Savings pot', 'Balance', 'Target'], [28, 16, 16])
  for (const p of d.savings) {
    const r = ws.addRow([text(p.name)])
    money(r.getCell(2), p.balancePence)
    if (p.targetPence) money(r.getCell(3), p.targetPence)
  }
  const t = totalRow(ws, 2, d.savings.length, {
    2: sumPence(d.savings.map((p) => p.balancePence)),
    3: sumPence(d.savings.map((p) => p.targetPence || 0)),
  })
  const h = ws.getRow(t + 2)
  h.values = ['Sinking fund', 'Yearly amount', 'Monthly set-aside']
  h.font = { bold: true }
  const first = t + 3
  d.sinking.forEach((f, i) => {
    const r = ws.getRow(first + i)
    r.getCell(1).value = text(f.name)
    money(r.getCell(2), f.yearlyAmountPence)
    // Whole pence per fund, matching sinkingMonthlyPence.
    money(r.getCell(3), sinkingMonthlyPence([f]))
  })
  const last = first + d.sinking.length // includes one spacer row
  const tr = ws.getRow(last + 1)
  tr.getCell(1).value = 'Total'
  formula(tr.getCell(2), `SUM(B${first}:B${last})`, pounds(sumPence(d.sinking.map((f) => f.yearlyAmountPence))))
  formula(tr.getCell(3), `SUM(C${first}:C${last})`, pounds(sinkingMonthlyPence(d.sinking)))
  tr.font = { bold: true }
}

function planSheet(wb: ExcelJS.Workbook, d: ExportData) {
  const ws = wb.addWorksheet('Investment Plan')
  ;[26, 22, 28, 16].forEach((w, i) => { ws.getColumn(i + 1).width = w })
  const hname = new Map((d.holdings ?? []).map((h) => [h.id, h.exampleName]))
  const pname = new Map((d.platforms ?? []).map((p) => [p.id, p.name]))
  let row = 1
  const heading = (...cells: string[]) => {
    const r = ws.getRow(row++)
    r.values = cells
    r.font = { bold: true }
  }
  const note = (s: string) => { ws.getRow(row++).getCell(1).value = text(s) }
  const plan = d.plan
  if (!plan) {
    note('A plan is only worked out for the current budget month.')
  } else if (!plan.ok) {
    note(`No plan: ${(plan.reason && PLAN_REASON[plan.reason]) || 'there is nothing to invest this month.'}`)
  } else {
    heading('Wrapper', 'Platform', 'Amount')
    for (const l of plan.lines) {
      const r = ws.getRow(row++)
      r.getCell(1).value = WRAPPER_LABEL[l.wrapper]
      r.getCell(2).value = text(pname.get(l.platformId) ?? l.platformId)
      money(r.getCell(3), l.pence)
    }
    row++
    heading('Holding', 'Bucket', 'Amount')
    for (const h of plan.holdings) {
      const r = ws.getRow(row++)
      r.getCell(1).value = text(hname.get(h.holdingId) ?? h.holdingId)
      r.getCell(2).value = BUCKET_LABEL[h.bucket] ?? h.bucket
      money(r.getCell(3), h.pence)
    }
    row++
    for (const [label, pence] of [['Emergency fund top-up', plan.emergencyTopUpPence], ['Extra debt payment', plan.extraDebtPence]] as const) {
      const r = ws.getRow(row++)
      r.getCell(1).value = label
      money(r.getCell(3), pence)
    }
    if (plan.warnings.length) { row++; heading('Warnings'); plan.warnings.forEach(note) }
    if (plan.notes.length) { row++; heading('Notes'); plan.notes.forEach(note) }
  }
  row++
  heading(`Allowances ${d.allowances.taxYear}`, 'Limit', 'Used this tax year (to date)', 'Remaining')
  for (const w of WRAPPERS) {
    const r = ws.getRow(row)
    r.getCell(1).value = `${WRAPPER_LABEL[w]} allowance`
    money(r.getCell(2), d.allowances.limits[w] ?? 0)
    money(r.getCell(3), d.allowances.used[w] ?? 0)
    formula(r.getCell(4), `B${row}-C${row}`, pounds((d.allowances.limits[w] ?? 0) - (d.allowances.used[w] ?? 0)))
    row++
  }
  row++
  heading('Logged investments', 'Holding', 'Planned', 'Actual')
  for (const l of d.log.filter((x) => x.month === d.month)) {
    const r = ws.getRow(row++)
    r.getCell(1).value = WRAPPER_LABEL[l.wrapper]
    r.getCell(2).value = text(hname.get(l.holdingId) ?? l.holdingId)
    money(r.getCell(3), l.plannedPence)
    money(r.getCell(4), l.actualPence)
  }
}

/** Builds the month-end workbook as .xlsx bytes. Pure and browser-safe. */
export async function buildWorkbook(data: ExportData): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook()
  const summary = wb.addWorksheet('Summary')
  // Sheet order is fixed by creation order; Summary is filled last because it references other sheets.
  txSheet(wb, data)
  const { totalSpentRow } = budgetSheet(wb, data)
  const { totalIncomeRow } = incomeSheet(wb, data)
  debtSheet(wb, data)
  savingsSheet(wb, data)
  planSheet(wb, data)

  const s = data.summary
  summary.getColumn(1).width = 28
  summary.getColumn(2).width = 28
  summary.addRow(['Month', text(data.monthText ?? data.month)]).font = { bold: true }
  summary.addRow(['Total income'])
  formula(summary.getCell('B2'), `'Income by Stream'!B${totalIncomeRow}`, pounds(s.totalIncomePence))
  summary.addRow(['Total spent'])
  formula(summary.getCell('B3'), `'Budget vs Actual'!C${totalSpentRow}`, pounds(s.totalSpentPence))
  summary.addRow(['Left to invest-or-save'])
  formula(summary.getCell('B4'), 'B2-B3', pounds(s.leftPence))

  const buf = await wb.xlsx.writeBuffer()
  return new Uint8Array(buf as ArrayBuffer)
}
