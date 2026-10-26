import Card from '../../components/Card'
import Money from '../../components/Money'
import { formatGBP } from '../../../domain/money'
import { monthLabel } from '../budget/budgetModel'
import { displayLabel, reasonText, type InvestView } from './investModel'

/** The figure itself, or why there is none. The only raised card on the tab. */
export default function InvestHero({ view }: { view: InvestView }) {
  const { investable } = view
  return (
    <Card className="invest-hero" labelledBy="invest-hero-heading">
      <h2 className="invest-hero-heading" id="invest-hero-heading">Invest this month</h2>
      {investable.ok ? (
        <>
          <p className="invest-figure">
            <Money pence={investable.investablePence} size="hero" />
          </p>
          <p className="item-meta">For {monthLabel(view.month)}, after bills, debts and a safety buffer.</p>
          {investable.notes.length > 0 && (
            <ul className="note-list">
              {investable.notes.map((n) => <li key={n}>{n}</li>)}
            </ul>
          )}
        </>
      ) : (
        <NotOk view={view} />
      )}
    </Card>
  )
}

function NotOk({ view }: { view: InvestView }) {
  const { investable } = view
  const text = reasonText(investable)
  const drain = investable.lines.find((l) => l.label === investable.biggestDrainLabel)
  return (
    <>
      <p className="invest-none">{text.short}</p>
      <p className="invest-reason">{text.long}</p>
      {drain && drain.pence > 0 && (
        <p className="invest-drain">{`Biggest cost: ${displayLabel(drain.label, view.input)}, ${formatGBP(drain.pence)}`}</p>
      )}
    </>
  )
}
