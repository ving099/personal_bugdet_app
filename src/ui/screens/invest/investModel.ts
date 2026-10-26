import { sinkingMonthlyPence, smoothedIncome, trailingSpend } from '../../../budget/summary'
import { highAprDebts } from '../../../debt/debt'
import { budgetMonthOf, taxYearOf, taxYearOfBudgetMonth } from '../../../domain/dates'
import type {
  Account, AllowanceUsed, Bucket, Category, Debt, Holding, ISODate, IncomeStream, InvestmentLog, OpeningHolding,
  Pence, Platform, SavingsPot, Settings, SinkingFund, Transaction, Wrapper,
} from '../../../domain/types'
import { formatGBP } from '../../../domain/money'
import { driftReport, type DriftReport } from '../../../invest/drift'
import { computeInvestable, type InvestableInput, type InvestableResult } from '../../../invest/investable'
import { buildMonthlyPlan, type MonthlyPlan } from '../../../invest/plan'
import { allocateWrappers, type WrapperAllocation } from '../../../invest/wrappers'

/** Everything the investing engines read, straight from the database. */
export interface InvestData {
  settings: Settings
  accounts: Account[]
  categories: Category[]
  streams: IncomeStream[]
  txs: Transaction[]
  debts: Debt[]
  pots: SavingsPot[]
  funds: SinkingFund[]
  used: AllowanceUsed[]
  holdings: Holding[]
  platforms: Platform[]
  opening: OpeningHolding[]
  log: InvestmentLog[]
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

/**
 * The monthly figures computeInvestable needs, for the budget month containing `today`.
 * Spending and income come from the three budget months before it; `categories` is always passed so
 * excluded categories are ignored exactly as on the Budget tab.
 */
export function investableInputFor(data: InvestData, today: ISODate): { input: InvestableInput; month: string } {
  const { settings, accounts, categories, streams, txs } = data
  const startDay = settings.budgetMonthStartDay
  const month = budgetMonthOf(today, startDay)
  const spend = trailingSpend({ asOfMonth: month, startDay, txs, accounts, categories })
  const income = smoothedIncome({ asOfMonth: month, startDay, txs, accounts, streams, categories })
  const high = highAprDebts(data.debts, settings.aprThresholdPercent, today)
  const pot = settings.emergencyFundPotId ? data.pots.find((p) => p.id === settings.emergencyFundPotId) : undefined
  return {
    month,
    input: {
      incomePence: income.totalPence,
      spendPence: spend.averagePence,
      sinkingPence: sinkingMonthlyPence(data.funds),
      debtMinimumsPence: sum(data.debts.map((d) => d.minimumPaymentPence)),
      highAprPayoffCapacityPence: sum(high.map((d) => d.balancePence)),
      emergencyGapPence: pot ? Math.max(0, pot.targetPence - pot.balancePence) : 0,
      bufferPercent: settings.bufferPercent,
      emergencyTopUpSharePercent: settings.emergencyTopUpSharePercent,
      monthsOfHistory: Math.max(spend.monthsUsed, income.monthsUsed),
    },
  }
}

/**
 * Allowance used as it stood before this month's ticked lines, so ticking a line off does not reshuffle the
 * plan it came from. Only logs for this budget month AND this tax year are taken back out, and only from
 * that tax year's rows; never below zero.
 */
export function planForUsed(used: AllowanceUsed[], log: InvestmentLog[], month: string, taxYear: string): AllowanceUsed[] {
  const thisMonth = log.filter((l) => l.month === month && l.taxYear === taxYear)
  return used.map((u) => {
    if (u.taxYear !== taxYear) return u
    const logged = sum(thisMonth.filter((l) => l.wrapper === u.wrapper).map((l) => l.actualPence))
    return { ...u, usedPence: Math.max(0, u.usedPence - logged) }
  })
}

export interface InvestView {
  month: string
  taxYear: string
  input: InvestableInput
  investable: InvestableResult
  wrappers: WrapperAllocation[]
  plan: MonthlyPlan
  /** Portfolio now: opening holdings plus every logged purchase. */
  drift: DriftReport
  /** Portfolio before this month's purchases; this month's split comes from it. */
  planDrift: DriftReport
  /** This month's ticked lines for this tax year, keyed `wrapper:holdingId` (matches plan rows). */
  logged: Map<string, InvestmentLog>
  /** This month's ticked lines (any tax year) that no plan line on screen shows; listed so they can be undone. */
  otherLogged: InvestmentLog[]
  groups: PlanGroup[]
}

export type InvestState = 'invest' | 'zero' | 'none'

/** 'invest': a plan to show; 'zero': worked out, but nothing left over; 'none': no figure (see reasonText). */
export function investState(result: InvestableResult): InvestState {
  if (!result.ok) return 'none'
  return result.investablePence > 0 ? 'invest' : 'zero'
}

export const lineKey = (wrapper: Wrapper, holdingId: string) => `${wrapper}:${holdingId}`

/** Fills in the tax year on log rows that were stored without one (old backups). */
export function withTaxYears(log: InvestmentLog[], startDay: number): InvestmentLog[] {
  return log.map((l) => (l.taxYear ? l : { ...l, taxYear: taxYearOfBudgetMonth(l.month, startDay) }))
}

/** The plain-English reason shown when the engines reject the figures (see buildInvestView). */
export const INVALID_DATA_TEXT = "We couldn't work out a figure from your data. Check your latest transactions and debts."

const EMPTY_INPUT: InvestableInput = {
  incomePence: 0, spendPence: 0, sinkingPence: 0, debtMinimumsPence: 0, highAprPayoffCapacityPence: 0,
  emergencyGapPence: 0, bufferPercent: 0, emergencyTopUpSharePercent: 0, monthsOfHistory: 0,
}

/**
 * The live plan for the budget month containing `today`. Never throws: the engines throw (RangeError and similar)
 * when a stored figure is out of range, and this runs during render on Home, Invest and Debts, so a throw would
 * blank the app. Instead it returns a view whose investable is `{ ok: false, reason: 'invalid-data' }`, which the
 * screens show like any other "no figure" reason.
 */
export function buildInvestView(data: InvestData, today: ISODate): InvestView {
  try {
    return computeInvestView(data, today)
  } catch {
    return invalidDataView(data, today)
  }
}

function invalidDataView(data: InvestData, today: ISODate): InvestView {
  const startDay = data.settings.budgetMonthStartDay
  let month = today.slice(0, 7)
  try {
    month = budgetMonthOf(today, startDay)
  } catch {
    /* keep the calendar month */
  }
  let input = EMPTY_INPUT
  try {
    input = investableInputFor(data, today).input
  } catch {
    /* the figures themselves could not be read; show none */
  }
  const investable: InvestableResult = { ok: false, reason: 'invalid-data', lines: [], biggestDrainLabel: '' }
  const noDrift: DriftReport = { growthPct: 0, aggressivePct: 0, underweight: null, biasNote: '' }
  let drift = noDrift
  let planDrift = noDrift
  try {
    const log = withTaxYears(data.log, startDay)
    const base = { opening: data.opening, holdings: data.holdings, bucketSplit: data.settings.bucketSplit }
    drift = driftReport({ ...base, log })
    planDrift = driftReport({ ...base, log: log.filter((l) => l.month < month) })
  } catch {
    /* leave the portfolio view empty */
  }
  const plan: MonthlyPlan = {
    ok: false, reason: 'invalid-data', totalPence: 0, lines: [], holdings: [], effectiveSplit: { growth: 0, aggressive: 0 },
    extraDebtPence: 0, emergencyTopUpPence: 0, investableLines: [], biggestDrainLabel: '', notes: [], warnings: [],
  }
  const taxYear = taxYearOf(today)
  // Every logged line for this month stays listed, so it can still be corrected or undone.
  const otherLogged = data.log.filter((l) => l.month === month)
  return {
    month, taxYear, input, investable, wrappers: [], plan, groups: [], logged: new Map(), otherLogged, drift, planDrift,
  }
}

function computeInvestView(data: InvestData, today: ISODate): InvestView {
  const { settings } = data
  const { input, month } = investableInputFor(data, today)
  const taxYear = taxYearOf(today)
  const investable = computeInvestable(input)
  const log = withTaxYears(data.log, settings.budgetMonthStartDay)
  const wrappers = allocateWrappers({
    investablePence: investable.ok ? investable.investablePence : 0,
    today,
    settings,
    used: planForUsed(data.used, log, month, taxYear),
    lisaEnabled: settings.lisaEnabled,
  })
  const base = { opening: data.opening, holdings: data.holdings, bucketSplit: settings.bucketSplit }
  // The split for this month is set from the portfolio before this month's purchases, so it stays put while ticking.
  const startOfMonth = driftReport({ ...base, log: log.filter((l) => l.month < month) })
  const plan = buildMonthlyPlan({
    investable, wrappers, holdings: data.holdings, platforms: data.platforms,
    defaultPlatformByWrapper: settings.defaultPlatformByWrapper, settings, drift: startOfMonth,
  })
  const groups = investState(investable) === 'invest' ? planGroups(plan, data.holdings, month, taxYear) : []
  const shown = new Set(groups.flatMap((g) => g.rows.map((r) => lineKey(r.wrapper, r.holdingId))))
  const logged = new Map<string, InvestmentLog>()
  const otherLogged: InvestmentLog[] = []
  for (const l of log.filter((x) => x.month === month)) {
    const key = lineKey(l.wrapper, l.holdingId)
    if (l.taxYear === taxYear && shown.has(key) && !logged.has(key)) logged.set(key, l)
    else otherLogged.push(l)
  }
  return {
    month, taxYear, input, investable, wrappers, plan, groups, logged, otherLogged,
    drift: driftReport({ ...base, log }), planDrift: startOfMonth,
  }
}

export const WRAPPER_NAMES: Record<Wrapper, string> = {
  pension: 'Pension (SIPP)', isa: 'Stocks and shares ISA', lisa: 'Lifetime ISA', gia: 'General investment account',
}
export const SHORT_WRAPPER: Record<Wrapper, string> = { pension: 'pension', isa: 'ISA', lisa: 'LISA', gia: 'GIA' }
/** Wrappers with a yearly allowance; logging into them raises AllowanceUsed. */
export const ALLOWANCE_WRAPPERS: readonly Wrapper[] = ['pension', 'isa', 'lisa']

const PLAIN: Record<string, string> = {
  'Spending (3-month average)': 'Spending (3-month average)',
  'Sinking funds': 'Set aside for yearly bills',
  'Debt minimums': 'Minimum debt payments',
  'Safety buffer': 'Safety buffer',
  'Emergency fund top-up': 'Emergency fund top-up',
  'Extra debt payment': 'Extra payment on high-interest debt',
}
export const plainLabel = (engineLabel: string) => PLAIN[engineLabel] ?? engineLabel

/** The plain-English label for one of computeInvestable's lines, as the breakdown shows it. */
export const displayLabel = (engineLabel: string, input: Pick<InvestableInput, 'bufferPercent'>) =>
  engineLabel === 'Safety buffer' ? `Safety buffer (${input.bufferPercent}% of income)` : plainLabel(engineLabel)

export interface BreakdownLine {
  label: string
  /** Signed: income positive, deductions negative. */
  pence: Pence
  total?: boolean
}

/** "How we got this number": income, each deduction from computeInvestable, then what is left to invest. */
export function breakdownLines(view: Pick<InvestView, 'input' | 'investable'>): BreakdownLine[] {
  const { input, investable } = view
  // No trustworthy figures to break down.
  if (!investable.ok && investable.reason === 'invalid-data') return []
  const lines: BreakdownLine[] = [
    { label: 'Income (expected, or your 3-month average if lower)', pence: input.incomePence },
    ...investable.lines.map((l) => ({ label: displayLabel(l.label, input), pence: -l.pence })),
  ]
  if (investable.ok) lines.push({ label: 'Invest this month', pence: investable.investablePence, total: true })
  else lines.push({ label: 'Shortfall this month', pence: lines.reduce((s, l) => s + l.pence, 0), total: true })
  return lines
}

export function reasonText(result: InvestableResult): { short: string; long: string } {
  if (result.ok) return { short: '', long: '' }
  if (result.reason === 'invalid-data') return { short: "Couldn't work out a figure", long: INVALID_DATA_TEXT }
  if (result.reason === 'no-income') {
    return {
      short: 'Add your income first',
      long: 'There is no income to work from yet. Add an income stream with its expected monthly pay, or import a statement with your pay in it.',
    }
  }
  return {
    short: 'Nothing spare this month',
    long: 'Nothing is left to invest this month: your spending, bills, debt payments and safety buffer use up all of your income.',
  }
}

/** Deterministic: one log row per tax year, budget month, wrapper and fund. */
export const logId = (taxYear: string, month: string, wrapper: Wrapper, holdingId: string) =>
  `${taxYear}:${month}:${wrapper}:${holdingId}`

const CAP_WRAPPER: Record<Wrapper, string> = { pension: 'Pension', isa: 'ISA', lisa: 'LISA', gia: 'GIA' }

/** 'Pension £73.62, ISA £220.88': where this month's money goes, at a glance. */
export function wrapperSummary(plan: MonthlyPlan): string {
  return plan.lines.filter((l) => l.pence > 0).map((l) => `${CAP_WRAPPER[l.wrapper]} ${formatGBP(l.pence)}`).join(', ')
}

export interface PlanRow {
  id: string
  wrapper: Wrapper
  holdingId: string
  bucket: Bucket
  name: string
  ticker: string
  plannedPence: Pence
}

export interface PlanGroup {
  wrapper: Wrapper
  pence: Pence
  platformId: string
  note?: string
  rows: PlanRow[]
  /** Money in a bucket with no fund set up (shown, but cannot be ticked). */
  unallocated: { bucket: Bucket; pence: Pence }[]
}

/** The plan card, one group per wrapper, one row per fund with money in it. Rows sum to the wrapper amount. */
export function planGroups(plan: MonthlyPlan, holdings: Holding[], month: string, taxYear: string): PlanGroup[] {
  return plan.lines.map((line) => {
    const rows: PlanRow[] = []
    const unallocated: PlanGroup['unallocated'] = []
    for (const part of line.holdings) {
      if (part.pence <= 0) continue
      const h = holdings.find((x) => x.id === part.holdingId)
      if (!h) {
        unallocated.push({ bucket: part.bucket, pence: part.pence })
        continue
      }
      rows.push({
        id: logId(taxYear, month, line.wrapper, h.id), wrapper: line.wrapper, holdingId: h.id, bucket: part.bucket,
        name: h.exampleName, ticker: h.ticker, plannedPence: part.pence,
      })
    }
    return { wrapper: line.wrapper, pence: line.pence, platformId: line.platformId, ...(line.note ? { note: line.note } : {}), rows, unallocated }
  })
}
