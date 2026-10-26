import type { Pence } from '../domain/types'

export interface InvestableInput {
  incomePence: Pence
  spendPence: Pence
  sinkingPence: Pence
  debtMinimumsPence: Pence
  highAprPayoffCapacityPence: Pence
  emergencyGapPence: Pence
  bufferPercent: number
  emergencyTopUpSharePercent: number
  monthsOfHistory: number
}

export interface InvestableLine {
  label: string
  pence: Pence
}

export type InvestableResult =
  | {
      ok: true
      investablePence: Pence
      lines: InvestableLine[]
      extraDebtPence: Pence
      emergencyTopUpPence: Pence
      biggestDrainLabel: string
      notes: string[]
    }
  | {
      ok: false
      reason: 'no-income' | 'no-surplus'
      lines: InvestableLine[]
      biggestDrainLabel: string
    }

function requirePence(name: string, v: number): void {
  if (!Number.isFinite(v) || v < 0) {
    throw new RangeError(`${name} must be a finite, non-negative pence amount (got ${v})`)
  }
}

function requirePercent(name: string, v: number): void {
  if (!Number.isFinite(v) || v < 0 || v > 100) {
    throw new RangeError(`${name} must be between 0 and 100 (got ${v})`)
  }
}

/** Turns already-computed monthly figures into the investable amount. Pure; integer pence. */
export function computeInvestable(input: InvestableInput): InvestableResult {
  requirePence('incomePence', input.incomePence)
  requirePence('spendPence', input.spendPence)
  requirePence('sinkingPence', input.sinkingPence)
  requirePence('debtMinimumsPence', input.debtMinimumsPence)
  requirePence('highAprPayoffCapacityPence', input.highAprPayoffCapacityPence)
  requirePence('emergencyGapPence', input.emergencyGapPence)
  requirePercent('bufferPercent', input.bufferPercent)
  requirePercent('emergencyTopUpSharePercent', input.emergencyTopUpSharePercent)
  if (!Number.isInteger(input.monthsOfHistory) || input.monthsOfHistory < 0) {
    throw new RangeError(
      `monthsOfHistory must be a non-negative integer (got ${input.monthsOfHistory})`,
    )
  }

  const income = input.incomePence
  const buffer = Math.round((income * input.bufferPercent) / 100)
  const baseLines: InvestableLine[] = [
    { label: 'Spending (3-month average)', pence: input.spendPence },
    { label: 'Sinking funds', pence: input.sinkingPence },
    { label: 'Debt minimums', pence: input.debtMinimumsPence },
    { label: 'Safety buffer', pence: buffer },
  ]
  let biggest = baseLines[0]
  for (const l of baseLines) if (l.pence > biggest.pence) biggest = l
  const biggestDrainLabel = biggest.label

  if (income <= 0) {
    return { ok: false, reason: 'no-income', lines: baseLines, biggestDrainLabel }
  }

  const surplus0 = income - input.spendPence - input.sinkingPence - input.debtMinimumsPence - buffer
  if (surplus0 <= 0) {
    return { ok: false, reason: 'no-surplus', lines: baseLines, biggestDrainLabel }
  }

  const emergency = Math.min(
    input.emergencyGapPence,
    Math.round((input.emergencyTopUpSharePercent * surplus0) / 100),
  )
  const surplus1 = surplus0 - emergency
  const extraDebt = Math.min(Math.max(surplus1, 0), input.highAprPayoffCapacityPence)
  const investable = surplus1 - extraDebt

  const lines = [...baseLines]
  if (emergency > 0) lines.push({ label: 'Emergency fund top-up', pence: emergency })
  if (extraDebt > 0) lines.push({ label: 'Extra debt payment', pence: extraDebt })

  const notes: string[] = []
  const m = input.monthsOfHistory
  if (m === 0) {
    notes.push('No history yet; the estimate relies on your expected income only.')
  } else if (m < 3) {
    notes.push(
      `Based on ${m} ${m === 1 ? 'month' : 'months'} of history; the estimate will firm up as you import more statements.`,
    )
  }
  if (emergency > 0) {
    notes.push(
      `${input.emergencyTopUpSharePercent}% of your surplus (capped at the remaining gap) goes to topping up your emergency fund first.`,
    )
  }
  if (extraDebt > 0) {
    notes.push('Part of your surplus goes to extra payments on high-interest debt before investing.')
  }
  if (investable === 0) {
    notes.push('Your whole surplus is going to the emergency fund and debt, so nothing is left to invest this month.')
  }

  return {
    ok: true,
    investablePence: investable,
    lines,
    extraDebtPence: extraDebt,
    emergencyTopUpPence: emergency,
    biggestDrainLabel,
    notes,
  }
}
