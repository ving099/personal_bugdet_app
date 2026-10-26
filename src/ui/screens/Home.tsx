import { useMemo } from 'react'
import { txsInMonth } from '../../budget/months'
import { monthDebtPayments, monthSummary } from '../../budget/summary'
import type { ISODate } from '../../domain/types'
import EmptyState from '../components/EmptyState'
import ExportButton from '../components/ExportButton'
import Money from '../components/Money'
import { Button } from '../components/forms'
import { todayISO } from '../formValues'
import { formatPeriod, monthLabel } from './budget/budgetModel'
import { totalBalance } from './debts/debtsModel'
import { attentionItems, type HomeTarget } from './home/homeModel'
import InvestCard from './home/InvestCard'
import NeedsAttention from './home/NeedsAttention'
import { useInvestPlan } from './invest/investDb'

interface Props {
  today?: ISODate
  /** Switches tab, the same way the tab bar does. */
  onNavigate?: (tab: HomeTarget) => void
}

export default function Home({ today = todayISO(), onNavigate = () => {} }: Props) {
  const live = useInvestPlan(today)

  const view = useMemo(() => {
    if (!live) return null
    const { data, view: invest } = live
    const { settings, txs, accounts, categories, streams } = data
    const startDay = settings.budgetMonthStartDay
    const month = invest.month
    const summary = monthSummary({ month, startDay, txs, accounts, categories, streams })
    const monthTxs = txsInMonth(txs, month, startDay)
    return {
      month,
      startDay,
      summary,
      debtPence: totalBalance(data.debts),
      attention: attentionItems({
        monthTxs, spentByCategory: summary.spentByCategory, accounts, categories, settings, today,
        debtPaymentsPence: monthDebtPayments({ month, startDay, txs, accounts }),
        debtMinimumsPence: data.debts.reduce((a, d) => a + d.minimumPaymentPence, 0),
      }),
      brandNew: txs.length === 0 && streams.length === 0 && data.debts.length === 0,
    }
  }, [live, today])

  if (!live || !view) return <div className="loading" role="status">Loading</div>
  if (view.brandNew) {
    return (
      <EmptyState
        title="Nothing to show yet"
        body="Import a bank statement to see where your money goes and what you can invest this month."
        action={<Button variant="primary" onClick={() => onNavigate('import')}>Import a statement</Button>}
      />
    )
  }
  const { summary } = view
  return (
    <div className="home">
      <InvestCard view={live.view} onOpen={() => onNavigate('invest')} />
      <section className="home-section" aria-labelledby="home-month">
        <h2 className="invest-heading" id="home-month">{monthLabel(view.month)}</h2>
        <p className="month-range">{formatPeriod(view.month, view.startDay)}</p>
        <dl className="home-figures">
          <div>
            <dt>Income received</dt>
            <dd><Money pence={summary.totalIncomePence} /></dd>
          </div>
          <div>
            <dt>Spent</dt>
            <dd><Money pence={summary.totalSpentPence} /></dd>
          </div>
          <div>
            <dt>Left</dt>
            <dd><Money pence={summary.leftPence} /></dd>
          </div>
          <div>
            <dt>Debt remaining</dt>
            <dd><Money pence={view.debtPence} /></dd>
          </div>
        </dl>
      </section>
      <NeedsAttention items={view.attention} onNavigate={onNavigate} />
      <ExportButton month={view.month} today={today} />
    </div>
  )
}
