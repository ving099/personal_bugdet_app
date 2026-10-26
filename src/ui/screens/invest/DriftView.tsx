import type { Bucket } from '../../../domain/types'
import { MAX_DRIFT_SHIFT_POINTS } from '../../../invest/plan'
import SplitBar from '../../components/SplitBar'
import { investState, type InvestView } from './investModel'

const show = (n: number) => String(Number(n.toFixed(1)))

/** Portfolio now (opening holdings plus everything logged) against the target split. No selling suggestions. */
export default function DriftView({ view, bucketSplit }: { view: InvestView; bucketSplit: Record<Bucket, number> }) {
  const { drift, planDrift, plan, investable } = view
  const sum = bucketSplit.growth + bucketSplit.aggressive
  const target = sum > 0 ? (bucketSplit.growth / sum) * 100 : 50
  const hasHoldings = drift.growthPct + drift.aggressivePct > 0
  const split = plan.effectiveSplit
  const shifted = Math.abs(split.growth - target) > 0.05
  const invest = investState(investable) === 'invest'
  return (
    <section className="invest-section" aria-labelledby="drift-heading">
      <h2 className="invest-heading" id="drift-heading">Growth and aggressive balance</h2>
      {hasHoldings && (
        <>
          <p className="invest-intro">{`Your portfolio now, against a ${show(target)}% growth target.`}</p>
          <SplitBar growthPct={drift.growthPct} aggressivePct={drift.aggressivePct} targetGrowthPct={target} />
        </>
      )}
      {hasHoldings && drift.biasNote !== planDrift.biasNote && <p className="drift-note">{`Now: ${drift.biasNote}`}</p>}
      {/* The split below is set from the portfolio before this month's purchases, so say which note drives it. */}
      <p className="drift-note">{`Before this month's purchases: ${planDrift.biasNote}`}</p>
      {invest && (
        <p className="drift-note">{`So this month's new money: ${show(split.growth)}% growth, ${show(split.aggressive)}% aggressive.`}</p>
      )}
      {invest && shifted && (
        <p className="item-meta">{`New money leans at most ${MAX_DRIFT_SHIFT_POINTS} points towards the lighter side each month. Nothing is sold.`}</p>
      )}
    </section>
  )
}
