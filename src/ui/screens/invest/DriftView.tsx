import type { Bucket } from '../../../domain/types'
import { MAX_DRIFT_SHIFT_POINTS } from '../../../invest/plan'
import SplitBar from '../../components/SplitBar'
import type { InvestView } from './investModel'

const show = (n: number) => String(Number(n.toFixed(1)))

/** Portfolio now (opening holdings plus everything logged) against the target split. No selling suggestions. */
export default function DriftView({ view, bucketSplit }: { view: InvestView; bucketSplit: Record<Bucket, number> }) {
  const { drift, plan, investable } = view
  const sum = bucketSplit.growth + bucketSplit.aggressive
  const target = sum > 0 ? (bucketSplit.growth / sum) * 100 : 50
  const hasHoldings = drift.growthPct + drift.aggressivePct > 0
  const split = plan.effectiveSplit
  const shifted = Math.abs(split.growth - target) > 0.05
  return (
    <section className="invest-section" aria-labelledby="drift-heading">
      <h2 className="invest-heading" id="drift-heading">Growth and aggressive balance</h2>
      {hasHoldings && (
        <>
          <p className="invest-intro">{`Your portfolio now, against a ${show(target)}% growth target.`}</p>
          <SplitBar growthPct={drift.growthPct} aggressivePct={drift.aggressivePct} targetGrowthPct={target} />
        </>
      )}
      <p className="drift-note">{drift.biasNote}</p>
      {investable.ok && (
        <p className="drift-note">{`This month's new money: ${show(split.growth)}% growth, ${show(split.aggressive)}% aggressive.`}</p>
      )}
      {investable.ok && shifted && (
        <p className="item-meta">{`New money leans at most ${MAX_DRIFT_SHIFT_POINTS} points towards the lighter side each month. Nothing is sold.`}</p>
      )}
    </section>
  )
}
