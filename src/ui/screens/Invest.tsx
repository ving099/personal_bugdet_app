import type { ISODate } from '../../domain/types'
import { todayISO } from '../formValues'
import Breakdown from './invest/Breakdown'
import DriftView from './invest/DriftView'
import InvestHero from './invest/InvestHero'
import { useInvestPlan } from './invest/investDb'
import PlanSection from './invest/PlanSection'

/** The one line the spec requires on this tab (section 6.5). Shown exactly once. */
export const DISCLAIMER =
  "Starting rules, not personal advice. Check each fund's key information document and your platform's availability before buying."

export default function Invest({ today = todayISO() }: { today?: ISODate }) {
  const live = useInvestPlan(today)
  if (!live) return <div className="loading" role="status">Loading</div>
  const { data, view } = live
  return (
    <div className="invest">
      <InvestHero view={view} />
      <Breakdown view={view} />
      {view.investable.ok && <PlanSection data={data} view={view} />}
      <DriftView view={view} bucketSplit={data.settings.bucketSplit} />
      <p className="disclaimer">{DISCLAIMER}</p>
    </div>
  )
}
