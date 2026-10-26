import { taxYearOf } from '../../domain/dates'
import type {
  Account, AccountKind, AllowanceUsed, Debt, Holding, ISODate, IncomeStream, OpeningHolding, Platform,
  SavingsPot, Settings, SinkingFund, Wrapper,
} from '../../domain/types'
import { parseMoney, parseNumber } from '../formValues'
import { validateMonthStartDay, validatePercent } from './settingsValidation'

export const WIZARD_STEPS = [
  'Accounts',
  'Income streams',
  'Debts',
  'Savings pots',
  'Sinking funds',
  'Allowances used this tax year',
  'Opening holdings',
  'Settings basics',
] as const
export type StepIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7

export interface AccountDraft { id: string; name: string; bank: string; kind: AccountKind }
export interface IncomeDraft { id: string; label: string; amount: string }
export interface DebtDraft {
  id: string; name: string; kind: Debt['kind']; balance: string; apr: string; minimum: string
  limit: string; promoApr: string; promoEnds: string
}
export interface PotDraft { id: string; name: string; balance: string; target: string; emergency: boolean }
export interface SinkingDraft { id: string; name: string; yearly: string; dueMonth: string }
export interface HoldingDraft { value: string; wrapper: Wrapper; platformId: string }

export interface WizardDraft {
  accounts: AccountDraft[]
  incomes: IncomeDraft[]
  debts: DebtDraft[]
  pots: PotDraft[]
  sinkingFunds: SinkingDraft[]
  lisaEnabled: boolean
  allowanceUsed: { isa: string; lisa: string; pension: string }
  holdings: Record<string, HoldingDraft>
  startDay: string
  aprThreshold: string
  buffer: string
}

export interface WizardContext {
  today: ISODate
  holdings: Holding[]
  platforms: Platform[]
  settings: Settings
  newId: () => string
}

export function emptyDraft(ctx: Pick<WizardContext, 'holdings' | 'platforms' | 'settings'>): WizardDraft {
  const { settings } = ctx
  return {
    accounts: [],
    incomes: [],
    debts: [],
    pots: [],
    sinkingFunds: [],
    lisaEnabled: settings.lisaEnabled ?? false,
    allowanceUsed: { isa: '', lisa: '', pension: '' },
    holdings: Object.fromEntries(
      ctx.holdings.map((h) => [
        h.id,
        { value: '', wrapper: 'gia' as Wrapper, platformId: h.platforms[0] ?? ctx.platforms[0]?.id ?? '' },
      ]),
    ),
    startDay: String(settings.budgetMonthStartDay),
    aprThreshold: String(settings.aprThresholdPercent),
    buffer: String(settings.bufferPercent),
  }
}

const blank = (s: string) => s.trim() === ''
const pence = (s: string) => {
  const r = parseMoney(s)
  return r.ok ? r.pence : 0
}
/** Rejects negatives: nothing in the wizard is a negative amount. */
const nonNegMoneyOk = (s: string, required: boolean) => {
  if (blank(s)) return !required
  const r = parseMoney(s)
  return r.ok && r.pence >= 0
}

export function aprOk(s: string, required: boolean): boolean {
  if (blank(s)) return !required
  const n = parseNumber(s)
  return n !== undefined && n >= 0 && n <= 1000
}

export function isoDateOk(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const t = new Date(Date.UTC(y, mo - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d
}

export function debtRowValid(d: DebtDraft): boolean {
  const promo = !blank(d.promoApr) || !blank(d.promoEnds)
  return (
    !blank(d.name) &&
    nonNegMoneyOk(d.balance, true) &&
    aprOk(d.apr, true) &&
    nonNegMoneyOk(d.minimum, true) &&
    nonNegMoneyOk(d.limit, false) &&
    (!promo || (aprOk(d.promoApr, true) && isoDateOk(d.promoEnds)))
  )
}

export function stepValid(step: StepIndex, d: WizardDraft): boolean {
  switch (step) {
    case 0:
      return d.accounts.every((a) => !blank(a.name))
    case 1:
      return d.incomes.every((i) => !blank(i.label) && nonNegMoneyOk(i.amount, true))
    case 2:
      return d.debts.every(debtRowValid)
    case 3:
      return d.pots.every((p) => !blank(p.name) && nonNegMoneyOk(p.balance, true) && nonNegMoneyOk(p.target, false))
    case 4:
      return d.sinkingFunds.every((s) => !blank(s.name) && nonNegMoneyOk(s.yearly, true))
    case 5:
      return (['isa', 'lisa', 'pension'] as const).every((w) => nonNegMoneyOk(d.allowanceUsed[w], false))
    case 6:
      return Object.values(d.holdings).every((h) => nonNegMoneyOk(h.value, false))
    case 7:
      return (
        validateMonthStartDay(d.startDay) === undefined &&
        validatePercent(d.aprThreshold) === undefined &&
        validatePercent(d.buffer) === undefined
      )
  }
}

export function monthlySetAside(yearly: string): number | undefined {
  const r = parseMoney(yearly)
  return r.ok && r.pence >= 0 ? Math.round(r.pence / 12) : undefined
}

export interface WizardWrites {
  accounts: Account[]
  incomeStreams: IncomeStream[]
  debts: Debt[]
  savingsPots: SavingsPot[]
  sinkingFunds: SinkingFund[]
  allowancesUsed: AllowanceUsed[]
  openingHoldings: OpeningHolding[]
  settingsPatch: Partial<Settings>
}

/** Turns a validated draft into rows. Blank optional values become 0 or are left out. */
export function buildWrites(d: WizardDraft, ctx: WizardContext): WizardWrites {
  const taxYear = taxYearOf(ctx.today)
  const emergency = d.pots.find((p) => p.emergency && !blank(p.name))
  return {
    accounts: d.accounts.map((a) => ({ id: a.id, name: a.name.trim(), bank: a.bank.trim(), kind: a.kind })),
    incomeStreams: d.incomes.map((i) => ({ id: i.id, label: i.label.trim(), expectedMonthlyNetPence: pence(i.amount) })),
    debts: d.debts.map((x): Debt => ({
      id: x.id,
      name: x.name.trim(),
      kind: x.kind,
      balancePence: pence(x.balance),
      creditLimitOrOriginalPence: pence(x.limit),
      aprPercent: Number(parseNumber(x.apr)),
      minimumPaymentPence: pence(x.minimum),
      ...(!blank(x.promoApr) ? { promoAprPercent: Number(parseNumber(x.promoApr)), promoEndsOn: x.promoEnds } : {}),
    })),
    savingsPots: d.pots.map((p) => ({
      id: p.id,
      name: p.name.trim(),
      balancePence: pence(p.balance),
      targetPence: pence(p.target),
      isEmergencyFund: p.emergency,
    })),
    sinkingFunds: d.sinkingFunds.map((s) => ({
      id: s.id,
      name: s.name.trim(),
      yearlyAmountPence: pence(s.yearly),
      dueMonth: Number(s.dueMonth),
    })),
    allowancesUsed: (['isa', 'lisa', 'pension'] as const)
      .filter((w) => (w !== 'lisa' || d.lisaEnabled) && !blank(d.allowanceUsed[w]))
      .map((w) => ({ taxYear, wrapper: w, usedPence: pence(d.allowanceUsed[w]) })),
    openingHoldings: ctx.holdings
      .filter((h) => !blank(d.holdings[h.id]?.value ?? ''))
      .map((h) => ({
        id: ctx.newId(),
        holdingId: h.id,
        valuePence: pence(d.holdings[h.id].value),
        asOf: ctx.today,
        wrapper: d.holdings[h.id].wrapper,
        platformId: d.holdings[h.id].platformId,
      })),
    settingsPatch: {
      budgetMonthStartDay: Number(parseNumber(d.startDay)),
      aprThresholdPercent: Number(parseNumber(d.aprThreshold)),
      bufferPercent: Number(parseNumber(d.buffer)),
      lisaEnabled: d.lisaEnabled,
      ...(emergency ? { emergencyFundPotId: emergency.id } : {}),
      onboardingDone: true,
    },
  }
}

/** Growth bucket first, then heavier weights first, so lists read the same everywhere. */
export function sortHoldings<T extends { bucket: string; weight: number; id: string }>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) => Number(a.bucket !== 'growth') - Number(b.bucket !== 'growth') || b.weight - a.weight || a.id.localeCompare(b.id),
  )
}
