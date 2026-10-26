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
 * Order of allocation: pension, then ISA slot (with LISA carved from inside it), then GIA.
 * - Pension = min(floor(pension% x investable), remaining pension allowance for the year).
 *   Not divided by months left: monthly pension contributions are far below the annual cap.
 * - ISA slot = min(remainder, floor(remainingIsa / monthsLeft)). remainingIsa is the ISA
 *   allowance minus used ISA and LISA rows for this tax year (LISA counts against the ISA limit).
 * - LISA (only when enabled) = min(ISA slot, floor(remainingLisa / monthsLeft), explicit LISA
 *   share if the user set one). With no LISA share it takes the whole carve-out up to its cap.
 *   ISA gets the rest of the slot, so LISA + ISA <= ISA slot.
 * - GIA takes the remainder, so the result always sums exactly to investablePence.
 *
 * Output is always [pension, isa, (lisa), gia]; `settings.wrapperOrder` is not used for
 * ordering because the allocation order is fixed by the rules above.
 * A tax year with no configured allowance is treated as zero room.
 */
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
  const budget = Math.max(0, investablePence)
  const allowance = (w: Wrapper): Pence => settings.allowances[taxYear]?.[w] ?? 0
  const usedIn = (w: Wrapper): Pence =>
    used.filter((u) => u.taxYear === taxYear && u.wrapper === w).reduce((a, u) => a + u.usedPence, 0)

  const remainingPension = Math.max(0, allowance('pension') - usedIn('pension'))
  const remainingLisa = Math.max(0, allowance('lisa') - usedIn('lisa'))
  const remainingIsa = Math.max(0, allowance('isa') - usedIn('isa') - usedIn('lisa'))

  // Pension
  const pensionWanted = Math.floor((budget * (settings.wrapperShares.pension ?? 0)) / 100)
  const pension = Math.min(pensionWanted, remainingPension)
  const pensionNote =
    pension < pensionWanted ? `Capped by remaining pension allowance for ${taxYear}` : undefined

  // ISA slot (LISA is carved from inside)
  const afterPension = budget - pension
  const monthlyIsaRoom = Math.floor(remainingIsa / monthsLeft)
  const isaSlot = Math.min(afterPension, monthlyIsaRoom)
  let slotNote: string | undefined
  if (isaSlot < afterPension) {
    slotNote =
      remainingIsa === 0
        ? `ISA room used up for ${taxYear}`
        : `Capped to spread remaining ISA room over ${monthsLeft} month${monthsLeft === 1 ? '' : 's'}`
  }

  let lisa = 0
  let lisaNote: string | undefined
  if (lisaEnabled) {
    const share = settings.wrapperShares.lisa
    const shareCap = share === undefined ? Infinity : Math.floor((budget * share) / 100)
    const monthlyLisaRoom = Math.floor(remainingLisa / monthsLeft)
    lisa = Math.min(isaSlot, monthlyLisaRoom, shareCap)
    if (lisa < isaSlot) {
      lisaNote =
        remainingLisa === 0
          ? `LISA allowance used up for ${taxYear}`
          : lisa === monthlyLisaRoom
            ? `Capped to spread remaining LISA allowance over ${monthsLeft} month${monthsLeft === 1 ? '' : 's'}`
            : undefined
    }
  }
  const isa = isaSlot - lisa
  const gia = budget - pension - isaSlot

  const out: WrapperAllocation[] = [
    { wrapper: 'pension', pence: pension, ...(pensionNote && { note: pensionNote }) },
    { wrapper: 'isa', pence: isa, ...(slotNote && { note: slotNote }) },
  ]
  if (lisaEnabled) out.push({ wrapper: 'lisa', pence: lisa, ...(lisaNote && { note: lisaNote }) })
  out.push({ wrapper: 'gia', pence: gia })
  return out
}
