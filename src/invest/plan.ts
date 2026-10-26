import { splitPence } from '../domain/money'
import type { Bucket, Holding, Pence, Platform, Settings, Wrapper } from '../domain/types'
import type { DriftReport } from './drift'
import type { InvestableLine, InvestableResult } from './investable'
import { splitWithinBucket, type HoldingAmount } from './split'
import type { WrapperAllocation } from './wrappers'

export interface PlanLine {
  wrapper: Wrapper
  pence: Pence
  /** Platform id, or 'choose' when no default is set for the wrapper. */
  platformId: string
  note?: string
  holdings: HoldingAmount[]
}

export interface MonthlyPlan {
  ok: boolean
  reason?: 'no-income' | 'no-surplus'
  totalPence: Pence
  lines: PlanLine[]
  /** Per-holding totals across all wrapper lines ('unallocated' when a bucket has no holdings). */
  holdings: HoldingAmount[]
  effectiveSplit: { growth: number; aggressive: number }
  extraDebtPence: Pence
  emergencyTopUpPence: Pence
  investableLines: InvestableLine[]
  biggestDrainLabel: string
  notes: string[]
  warnings: string[]
}

/** Max percentage points moved towards an underweight bucket. */
export const MAX_DRIFT_SHIFT_POINTS = 10

const WRAPPER_NAMES: Record<Wrapper, string> = { pension: 'pension', isa: 'ISA', lisa: 'LISA', gia: 'GIA' }

/**
 * Effective split: target = bucketSplit normalised to percentages. If a bucket is underweight,
 * shift = min(10, round(targetPct - actualPct)) points move from the other bucket to it, capped at
 * what the other bucket has so it never goes below 0.
 */
function effectiveSplit(settings: Settings, drift: DriftReport) {
  const { growth: g, aggressive: a } = settings.bucketSplit
  const sum = g + a
  const target = sum > 0 ? { growth: (g / sum) * 100, aggressive: (a / sum) * 100 } : { growth: 50, aggressive: 50 }
  const under: Bucket | null = drift.underweight
  if (!under) return target
  const other: Bucket = under === 'growth' ? 'aggressive' : 'growth'
  const actual = under === 'growth' ? drift.growthPct : drift.aggressivePct
  const gap = target[under] - actual
  const shift = Math.min(target[other], Math.min(MAX_DRIFT_SHIFT_POINTS, Math.max(0, Math.round(gap))))
  return { ...target, [under]: target[under] + shift, [other]: target[other] - shift } as typeof target
}

/** Composes investable, wrapper allocation, drift and holdings into the monthly plan. Pure. */
export function buildMonthlyPlan(input: {
  investable: InvestableResult
  wrappers: WrapperAllocation[]
  holdings: Holding[]
  platforms: Platform[]
  defaultPlatformByWrapper: Partial<Record<Wrapper, string>>
  settings: Settings
  drift: DriftReport
}): MonthlyPlan {
  const { investable, holdings, platforms, settings } = input
  const split = effectiveSplit(settings, input.drift)
  if (!investable.ok) {
    return {
      ok: false,
      reason: investable.reason,
      totalPence: 0,
      lines: [],
      holdings: [],
      effectiveSplit: split,
      extraDebtPence: 0,
      emergencyTopUpPence: 0,
      investableLines: investable.lines,
      biggestDrainLabel: investable.biggestDrainLabel,
      notes: [],
      warnings: [],
    }
  }

  const warnings: string[] = []
  const emptyBuckets = (['growth', 'aggressive'] as const).filter((b) => !holdings.some((h) => h.bucket === b))
  for (const b of emptyBuckets) warnings.push(`No ${b} holdings configured — add one in Settings`)

  const totals = new Map<string, HoldingAmount>()
  const lines: PlanLine[] = []
  for (const w of input.wrappers) {
    if (w.pence <= 0) continue
    const [growthPence, aggressivePence] = splitPence(w.pence, [split.growth, split.aggressive])
    const bucketPence: Record<Bucket, Pence> = { growth: growthPence, aggressive: aggressivePence }
    const parts: HoldingAmount[] = []
    for (const b of ['growth', 'aggressive'] as const) {
      if (emptyBuckets.includes(b)) {
        if (bucketPence[b] > 0) parts.push({ holdingId: 'unallocated', bucket: b, pence: bucketPence[b] })
      } else {
        parts.push(...splitWithinBucket(bucketPence[b], b, holdings))
      }
    }
    const platformId = input.defaultPlatformByWrapper[w.wrapper] ?? 'choose'
    const wName = WRAPPER_NAMES[w.wrapper]
    if (platformId !== 'choose') {
      const platform = platforms.find((p) => p.id === platformId)
      const pName = platform?.name ?? platformId
      if (!platform || !platform.wrappersSupported.includes(w.wrapper)) {
        warnings.push(`${pName} does not support the ${wName} — choose another platform for it.`)
      } else {
        for (const part of parts) {
          const h = holdings.find((x) => x.id === part.holdingId)
          if (h && part.pence > 0 && !h.platforms.includes(platformId)) {
            warnings.push(
              `${pName} ${wName}: ${h.exampleName} (${h.ticker}) is not available on ${pName} — choose another platform for the ${wName}.`,
            )
          }
        }
      }
    }
    for (const part of parts) {
      const t = totals.get(part.holdingId)
      if (t) t.pence += part.pence
      else totals.set(part.holdingId, { ...part })
    }
    lines.push({ wrapper: w.wrapper, pence: w.pence, platformId, ...(w.note ? { note: w.note } : {}), holdings: parts })
  }

  const notes = [...investable.notes]
  for (const w of input.wrappers) if (w.note) notes.push(w.note)

  return {
    ok: true,
    totalPence: investable.investablePence,
    lines,
    holdings: [...totals.values()],
    effectiveSplit: split,
    extraDebtPence: investable.extraDebtPence,
    emergencyTopUpPence: investable.emergencyTopUpPence,
    investableLines: investable.lines,
    biggestDrainLabel: investable.biggestDrainLabel,
    notes,
    warnings,
  }
}
