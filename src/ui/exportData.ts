import { txsInMonth } from '../budget/months'
import { monthSummary } from '../budget/summary'
import { budgetMonthRange, taxYearOfBudgetMonth } from '../domain/dates'
import type { ISODate, Wrapper, Pence } from '../domain/types'
import type { ExportData } from '../export/workbook'
import { monthLabel } from './screens/budget/budgetModel'
import { buildInvestView, withTaxYears, type InvestData } from './screens/invest/investModel'

const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dmy = (iso: string) => `${Number(iso.slice(8, 10))} ${SHORT[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`

/** 'October 2026' for a calendar-month budget, else the exact period, e.g. '25 Sep 2026 to 24 Oct 2026'. */
function monthText(month: string, startDay: number): string {
  if (startDay === 1) return monthLabel(month)
  const { from, to } = budgetMonthRange(month, startDay)
  return `${dmy(from)} to ${dmy(to)}`
}

const WRAPPERS: Wrapper[] = ['pension', 'isa', 'lisa', 'gia']

/**
 * Assembles the month-end workbook inputs for budget month `month` from the same composition the Budget and
 * Invest tabs use (monthSummary, txsInMonth, buildInvestView), so the sheets match what is on screen.
 * The investment plan only exists for the budget month containing `today`; for any other month the sheet says so.
 */
export function buildExportData(data: InvestData, month: string, today: ISODate): ExportData {
  const { settings, txs, accounts, categories, streams } = data
  const startDay = settings.budgetMonthStartDay
  const view = buildInvestView(data, today)
  // The month on screen uses the Invest tab's tax year exactly; other months use the year their period starts in.
  const taxYear = month === view.month ? view.taxYear : taxYearOfBudgetMonth(month, startDay)
  const years = Object.keys(settings.allowances).sort()
  const limitsYear = settings.allowances[taxYear] ? taxYear : years.filter((y) => y < taxYear).at(-1)
  const configured = limitsYear ? settings.allowances[limitsYear] : {}
  const limits = Object.fromEntries(WRAPPERS.map((w) => [w, configured?.[w] ?? 0])) as Record<Wrapper, Pence>
  const used = Object.fromEntries(
    WRAPPERS.map((w) => [w, data.used.find((u) => u.taxYear === taxYear && u.wrapper === w)?.usedPence ?? 0]),
  ) as Record<Wrapper, Pence>
  return {
    month,
    monthText: monthText(month, startDay),
    summary: monthSummary({ month, startDay, txs, accounts, categories, streams }),
    txs: txsInMonth(txs, month, startDay),
    categories,
    streams,
    debts: data.debts,
    savings: data.pots,
    sinking: data.funds,
    plan: month === view.month ? view.plan : null,
    allowances: { taxYear, limits, used },
    log: withTaxYears(data.log, startDay),
    accounts,
    holdings: data.holdings,
    platforms: data.platforms,
  }
}
