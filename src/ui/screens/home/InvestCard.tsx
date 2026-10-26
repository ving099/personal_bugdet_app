import Card from '../../components/Card'
import Money from '../../components/Money'
import { Button } from '../../components/forms'
import { investState, reasonText, type InvestView } from '../invest/investModel'

/** The one raised card on Home: this month's investable figure, or the short reason there is none. */
export default function InvestCard({ view, onOpen }: { view: InvestView; onOpen: () => void }) {
  const { investable } = view
  const state = investState(investable)
  return (
    <Card className="invest-hero" labelledBy="home-invest-heading">
      <h2 className="invest-hero-heading" id="home-invest-heading">Invest this month</h2>
      {investable.ok && state === 'invest' ? (
        <p className="invest-figure">
          <Money pence={investable.investablePence} size="hero" />
        </p>
      ) : (
        <p className="invest-none">{state === 'zero' ? 'Nothing to invest this month' : reasonText(investable).short}</p>
      )}
      <Button variant="primary" onClick={onOpen}>
        {state === 'invest' ? 'See the plan' : 'See why'}
      </Button>
    </Card>
  )
}
