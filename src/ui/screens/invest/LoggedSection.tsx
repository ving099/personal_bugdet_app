import type { Holding, InvestmentLog } from '../../../domain/types'
import { monthLabel } from '../budget/budgetModel'
import type { InvestView, PlanRow } from './investModel'
import PlanRowItem from './PlanRowItem'

/** A logged line as a row, using the fund's current details where it still exists. */
function rowOf(log: InvestmentLog, holdings: Holding[]): PlanRow {
  const h = holdings.find((x) => x.id === log.holdingId)
  return {
    id: log.id, wrapper: log.wrapper, holdingId: log.holdingId, bucket: h?.bucket ?? 'growth',
    name: h?.exampleName ?? `A fund no longer in your list (${log.holdingId})`, ticker: h?.ticker ?? '',
    plannedPence: log.plannedPence,
  }
}

/**
 * This month's logged lines that the plan on screen does not show (the plan changed, the fund was removed, there
 * is nothing to invest now, or they count against another tax year). They can still be corrected or undone.
 */
export default function LoggedSection({ view, holdings }: { view: InvestView; holdings: Holding[] }) {
  if (view.otherLogged.length === 0) return null
  return (
    <section className="invest-section" aria-labelledby="logged-heading">
      <h2 className="invest-heading" id="logged-heading">Logged this month</h2>
      <p className="invest-intro">
        {`Lines you ticked off for ${monthLabel(view.month)} that are not in the plan above. Untick one to undo it; its allowance is given back.`}
      </p>
      <ul className="plan-list">
        {view.otherLogged.map((log) => (
          <PlanRowItem key={log.id} row={rowOf(log, holdings)} logged={log} month={log.month} taxYear={log.taxYear}
            platformId={log.platformId} nameSuffix={`, logged for ${log.taxYear}`} />
        ))}
      </ul>
    </section>
  )
}
