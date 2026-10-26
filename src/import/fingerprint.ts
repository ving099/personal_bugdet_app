import type { ParsedTx } from './profile'

function normaliseDescription(d: string): string {
  return d.trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * Stable fingerprint per row: account, date, amount, normalised description and the
 * occurrence index within that identical group, so genuine duplicates stay distinct
 * and the Nth identical row of a re-imported file always maps to the Nth stored one.
 */
export function assignFingerprints<T extends ParsedTx>(txs: T[]): (T & { fingerprint: string })[] {
  const seen = new Map<string, number>()
  return txs.map((t) => {
    const key = JSON.stringify([t.accountId, t.date, t.amountPence, normaliseDescription(t.description)])
    const n = seen.get(key) ?? 0
    seen.set(key, n + 1)
    return { ...t, fingerprint: `${key}#${n}` }
  })
}
