import Money from '../../components/Money'
import { breakdownLines, type InvestView } from './investModel'

/** "How we got this number": income, then each deduction from computeInvestable, then the result. */
export default function Breakdown({ view }: { view: InvestView }) {
  const lines = breakdownLines(view)
  return (
    <section className="invest-section" aria-labelledby="breakdown-heading">
      <h2 className="invest-heading" id="breakdown-heading">How we got this number</h2>
      <ul className="breakdown" aria-labelledby="breakdown-heading">
        {lines.map((l) => (
          <li key={l.label} className={l.total ? 'breakdown-line breakdown-total' : 'breakdown-line'}>
            <span className="breakdown-label">{l.label}</span>
            <Money pence={l.pence} tone={l.total ? 'none' : 'auto'} />
          </li>
        ))}
      </ul>
    </section>
  )
}
