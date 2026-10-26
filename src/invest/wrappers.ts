import { monthsLeftInTaxYear, taxYearOf } from '../domain/dates'
import type { AllowanceUsed, ISODate, Pence, Settings, Wrapper } from '../domain/types'

export interface WrapperAllocationInput {
  investablePence: Pence
  today: ISODate
  settings: Pick<Settings, 'wrapperOrder' | 'wrapperShares' | 'allowances'>
  used: AllowanceUsed[]
  lisaEnabled: boolean
}

export interface WrapperAllocation {
  wrapper: Wrapper
  pence: Pence
  note?: string
}

/**
 * Splits the investable amount across wrappers for the tax year containing `today`.
 *
 * Order of allocation: by default pension, then ISA slot (with LISA carved from inside it), then GIA.
 * `settings.wrapperOrder` decides whether the pension or the ISA slot comes first (see pensionFirst); LISA always
 * sits inside the ISA slot and GIA always takes what is left, wherever they appear in the order.
 * - Pension = min(floor(pension% x investable), remaining pension allowance for the year), and when the ISA slot
 *   comes first, also at most what the ISA slot left. Not divided by months left: monthly pension contributions
 *   are far below the annual cap.
 * - ISA slot = min(money available to it, floor(remainingIsa / monthsLeft)), where the money available is the
 *   remainder after the pension, or the whole investable amount when the ISA comes first. remainingIsa is the ISA
 *   allowance minus used ISA and LISA rows for this tax year (LISA counts against the ISA limit).
 * - LISA (only when enabled) = min(ISA slot, floor(remainingLisa / monthsLeft), explicit LISA
 *   share if the user set one). With no LISA share it takes the whole carve-out up to its cap.
 *   ISA gets the rest of the slot, so LISA + ISA <= ISA slot.
 * - GIA takes the remainder, so the result always sums exactly to investablePence.
 *
 * Output follows the priority: [pension, isa, (lisa), gia] or [isa, (lisa), pension, gia].
 *
 * Allowance lookup: if `allowances` has an entry for the current tax year it is used as is
 * (a wrapper missing or 0 inside a configured year means zero room). If the year is missing,
 * the latest configured year at or before it (by starting year) supplies the limits and the
 * pension/ISA/LISA entries carry a "not set; using X limits" note. If no earlier year exists,
 * room is zero and those entries say no allowances are configured.
 * `wrapperShares.pension` / `.lisa`, when given, must be finite numbers in 0..100.
 */
/**
 * True when the pension comes before the ISA slot in `order` (the ISA slot's place is the first of 'isa' and 'lisa').
 * A missing or unusable order (not a list, or without both a pension and an ISA entry) gives the default: true.
 */
export function pensionFirst(order: unknown): boolean {
  if (!Array.isArray(order)) return true
  const pension = order.indexOf('pension')
  const isa = [order.indexOf('isa'), order.indexOf('lisa')].filter((i) => i >= 0)
  if (pension < 0 || isa.length === 0) return true
  return pension < Math.min(...isa)
}

export function allocateWrappers(input: WrapperAllocationInput): WrapperAllocation[] {
  const { investablePence, today, settings, used, lisaEnabled } = input
  if (!Number.isInteger(investablePence)) {
    throw new RangeError(`allocateWrappers: investablePence must be an integer, got ${investablePence}`)
  }
  for (const u of used) {
    if (!Number.isFinite(u.usedPence) || u.usedPence < 0) {
      throw new RangeError(`allocateWrappers: usedPence must be a non-negative number, got ${u.usedPence}`)
    }
  }

  const taxYear = taxYearOf(today)
  const monthsLeft = monthsLeftInTaxYear(today)
  for (const w of ['pension', 'lisa'] as const) {
    const v = settings.wrapperShares[w]
    if (v !== undefined && (!Number.isFinite(v) || v < 0 || v > 100)) {
      throw new RangeError(`allocateWrappers: wrapperShares.${w} must be between 0 and 100, got ${v}`)
    }
  }

  const budget = Math.max(0, investablePence)
  const startYear = (ty: string) => Number(ty.slice(0, 4))
  let limitsYear: string | undefined = settings.allowances[taxYear] ? taxYear : undefined
  if (!limitsYear) {
    limitsYear = Object.keys(settings.allowances)
      .filter((k) => startYear(k) <= startYear(taxYear))
      .sort((a, b) => startYear(b) - startYear(a))[0]
  }
  const limits = limitsYear ? settings.allowances[limitsYear] : undefined
  const allowance = (w: Wrapper): Pence => limits?.[w] ?? 0
  const yearNote = !limitsYear
    ? `No allowances configured for ${taxYear} \u2014 check Settings`
    : limitsYear !== taxYear
      ? `Allowances for ${taxYear} not set; using ${limitsYear} limits \u2014 check Settings`
      : undefined
  const withNote = (note?: string) => {
    const n = [yearNote, note].filter(Boolean).join('; ')
    return n ? { note: n } : {}
  }
  const usedIn = (w: Wrapper): Pence =>
    used.filter((u) => u.taxYear === taxYear && u.wrapper === w).reduce((a, u) => a + u.usedPence, 0)

  const remainingPension = Math.max(0, allowance('pension') - usedIn('pension'))
  const remainingLisa = Math.max(0, allowance('lisa') - usedIn('lisa'))
  const remainingIsa = Math.max(0, allowance('isa') - usedIn('isa') - usedIn('lisa'))

  const first = pensionFirst(settings.wrapperOrder)
  const monthlyIsaRoom = Math.floor(remainingIsa / monthsLeft)
  const pensionWanted = Math.floor((budget * (settings.wrapperShares.pension ?? 0)) / 100)
  const pensionAllowed = Math.min(pensionWanted, remainingPension)
  let pension: Pence
  let isaSlot: Pence
  if (first) {
    pension = pensionAllowed
    isaSlot = Math.min(budget - pension, monthlyIsaRoom)
  } else {
    isaSlot = Math.min(budget, monthlyIsaRoom)
    pension = Math.min(pensionAllowed, budget - isaSlot)
  }
  const availableToIsa = first ? budget - pension : budget

  // Pension
  let pensionNote: string | undefined
  if (pension < pensionAllowed) {
    pensionNote = 'Less than your pension share: the ISA comes first in your order'
  } else if (pension < pensionWanted && limitsYear) {
    pensionNote =
      allowance('pension') === 0
        ? `No pension allowance for ${limitsYear}`
        : remainingPension === 0
          ? `Pension allowance used up for ${taxYear}`
          : `Capped by remaining pension allowance for ${taxYear}`
  }

  // ISA slot (LISA is carved from inside)
  let slotNote: string | undefined
  if (isaSlot < availableToIsa && limitsYear) {
    slotNote =
      remainingIsa === 0
        ? allowance('isa') === 0
          ? `No ISA allowance for ${limitsYear}`
          : `ISA room used up for ${taxYear}`
        : `Capped to spread remaining ISA room over ${monthsLeft} month${monthsLeft === 1 ? '' : 's'}`
  }

  let lisa = 0
  let lisaNote: string | undefined
  if (lisaEnabled) {
    const share = settings.wrapperShares.lisa
    const shareCap = share === undefined ? Infinity : Math.floor((budget * share) / 100)
    const monthlyLisaRoom = Math.floor(remainingLisa / monthsLeft)
    lisa = Math.min(isaSlot, monthlyLisaRoom, shareCap)
    if (lisa < isaSlot && limitsYear) {
      lisaNote =
        remainingLisa === 0
          ? allowance('lisa') === 0
            ? `No LISA allowance for ${limitsYear}`
            : `LISA allowance used up for ${taxYear}`
          : lisa === monthlyLisaRoom
            ? `Capped to spread remaining LISA allowance over ${monthsLeft} month${monthsLeft === 1 ? '' : 's'}`
            : undefined
    }
  }
  const isa = isaSlot - lisa
  const gia = budget - pension - isaSlot

  const pensionLine: WrapperAllocation = { wrapper: 'pension', pence: pension, ...withNote(pensionNote) }
  const isaLines: WrapperAllocation[] = [{ wrapper: 'isa', pence: isa, ...withNote(slotNote) }]
  if (lisaEnabled) isaLines.push({ wrapper: 'lisa', pence: lisa, ...withNote(lisaNote) })
  const ordered = first ? [pensionLine, ...isaLines] : [...isaLines, pensionLine]
  return [...ordered, { wrapper: 'gia', pence: gia }]
}
