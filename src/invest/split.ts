import { splitPence } from '../domain/money'
import type { Bucket, Holding, Pence } from '../domain/types'

export interface HoldingAmount {
  holdingId: string
  bucket: Bucket
  pence: Pence
}

/** Splits a bucket's pence across its holdings by `weight` (largest remainder). [] for no holdings. */
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
 * bucket when a bucket has no holdings. `holding.platforms` is ignored here.
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
    if (!holdings.some((h) => h.bucket === bucket)) {
      throw new Error(`splitBuckets: no ${bucket} holdings configured`)
    }
  }
  const [growth, aggressive] = splitPence(amountPence, [bucketSplit.growth, bucketSplit.aggressive])
  return [
    ...splitWithinBucket(growth, 'growth', holdings),
    ...splitWithinBucket(aggressive, 'aggressive', holdings),
  ]
}
