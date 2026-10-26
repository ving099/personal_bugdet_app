import { splitPence } from '../domain/money'
import type { Bucket, Holding, Pence } from '../domain/types'

export interface HoldingAmount {
  holdingId: string
  bucket: Bucket
  pence: Pence
}

/** A usable weight is finite and not negative. */
export const isValidWeight = (w: number) => Number.isFinite(w) && w >= 0

/**
 * Splits a bucket's pence across its holdings by `weight` (largest remainder). [] for no holdings.
 * Callers must ensure weights are valid and at least one is positive (splitBuckets checks this).
 */
export function splitWithinBucket(bucketPence: Pence, bucket: Bucket, holdings: Holding[]): HoldingAmount[] {
  const inBucket = holdings.filter((h) => h.bucket === bucket)
  if (inBucket.length === 0) return []
  const parts = splitPence(bucketPence, inBucket.map((h) => h.weight))
  return inBucket.map((h, i) => ({ holdingId: h.id, bucket, pence: parts[i] }))
}

/**
 * Splits `amountPence` between the growth and aggressive buckets by `bucketSplit`, then within each
 * bucket by holding weight. Always sums exactly to the amount. A zero amount returns zero-pence
 * entries (one per holding). Throws RangeError for a negative amount and a plain Error naming the
 * bucket when a bucket has no holdings, only zero-weight holdings, or any negative/non-finite weight.
 * `holding.platforms` is ignored here.
 */
export function splitBuckets(
  amountPence: Pence,
  bucketSplit: { growth: number; aggressive: number },
  holdings: Holding[],
): HoldingAmount[] {
  if (!Number.isInteger(amountPence) || amountPence < 0) {
    throw new RangeError(`splitBuckets: amount must be a non-negative integer pence (got ${amountPence})`)
  }
  for (const bucket of ['growth', 'aggressive'] as const) {
    const inBucket = holdings.filter((h) => h.bucket === bucket)
    if (inBucket.length === 0) throw new Error(`splitBuckets: no ${bucket} holdings configured`)
    const bad = inBucket.find((h) => !isValidWeight(h.weight))
    if (bad) throw new Error(`splitBuckets: ${bucket} holding ${bad.id} has an invalid weight (${bad.weight})`)
    if (!inBucket.some((h) => h.weight > 0)) {
      throw new Error(`splitBuckets: all ${bucket} holding weights are zero`)
    }
  }
  const [growth, aggressive] = splitPence(amountPence, [bucketSplit.growth, bucketSplit.aggressive])
  return [
    ...splitWithinBucket(growth, 'growth', holdings),
    ...splitWithinBucket(aggressive, 'aggressive', holdings),
  ]
}
