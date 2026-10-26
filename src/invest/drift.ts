import type { Bucket, Holding, InvestmentLog, OpeningHolding, Pence } from '../domain/types'

export interface DriftReport {
  growthPct: number
  aggressivePct: number
  underweight: Bucket | null
  biasNote: string
}

/** A bucket is underweight only when its share is below target by strictly more than this. */
export const DRIFT_TOLERANCE_POINTS = 2

const round1 = (n: number) => Math.round(n * 10) / 10
const label = (b: Bucket) => (b === 'growth' ? 'Growth' : 'Aggressive')
const show = (n: number) => String(Number(n.toFixed(1)))

/**
 * Actual per-bucket value = opening values + logged actualPence, mapped via `holdings`
 * (unknown holding ids are ignored). Percentages are of the combined total, one decimal place;
 * 0/0 when the total is not positive. Target = bucketSplit normalised to percentages.
 */
export function driftReport(input: {
  opening: OpeningHolding[]
  log: InvestmentLog[]
  holdings: Holding[]
  bucketSplit: Record<Bucket, number>
}): DriftReport {
  const bucketOf = new Map(input.holdings.map((h) => [h.id, h.bucket]))
  const value: Record<Bucket, Pence> = { growth: 0, aggressive: 0 }
  for (const o of input.opening) {
    const b = bucketOf.get(o.holdingId)
    if (b) value[b] += o.valuePence
  }
  for (const l of input.log) {
    const b = bucketOf.get(l.holdingId)
    if (b) value[b] += l.actualPence
  }
  const { growth: tg, aggressive: ta } = input.bucketSplit
  const targetSum = tg + ta
  const target: Record<Bucket, number> =
    targetSum > 0 ? { growth: (tg / targetSum) * 100, aggressive: (ta / targetSum) * 100 } : { growth: 0, aggressive: 0 }
  const targetText = `${show(target.growth)}/${show(target.aggressive)}`

  const total = value.growth + value.aggressive
  if (total <= 0) {
    return {
      growthPct: 0,
      aggressivePct: 0,
      underweight: null,
      biasNote: 'No holdings recorded yet — using your target split.',
    }
  }
  const actual: Record<Bucket, number> = {
    growth: (value.growth / total) * 100,
    aggressive: (value.aggressive / total) * 100,
  }
  const gaps: Record<Bucket, number> = {
    growth: target.growth - actual.growth,
    aggressive: target.aggressive - actual.aggressive,
  }
  let underweight: Bucket | null = null
  for (const b of ['growth', 'aggressive'] as const) {
    if (gaps[b] > DRIFT_TOLERANCE_POINTS && (underweight === null || gaps[b] > gaps[underweight])) underweight = b
  }
  const biasNote = underweight
    ? `${label(underweight)} is ${show(round1(actual[underweight]))}% of your portfolio vs a ${show(
        target[underweight],
      )}% target, so new money leans towards it.`
    : `Within ${DRIFT_TOLERANCE_POINTS} points of your ${targetText} target.`
  return { growthPct: round1(actual.growth), aggressivePct: round1(actual.aggressive), underweight, biasNote }
}
