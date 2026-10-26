import { txsInMonth } from '../budget/months'
import { monthSummary } from '../budget/summary'
import { taxYearOfBudgetMonth } from '../domain/dates'
import type { ISODate, Wrapper, Pence } from '../domain/types'
import type { ExportData } from '../export/workbook'
import { buildInvestView, withTaxYears, type InvestData } from './screens/invest/investModel'

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
  }
}
