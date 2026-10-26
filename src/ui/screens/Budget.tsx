import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { txsInMonth } from '../../budget/months'
import { monthSummary } from '../../budget/summary'
import { budgetMonthOf } from '../../domain/dates'
import type { ISODate } from '../../domain/types'
import Card from '../components/Card'
import EmptyState from '../components/EmptyState'
import ExportButton from '../components/ExportButton'
import Money from '../components/Money'
import { todayISO } from '../formValues'
import { useDb } from '../useDb'
import { buildBudgetRows, monthChoices, unassignedCredits } from './budget/budgetModel'
import IncomeSection from './budget/IncomeSection'
import MonthSelector from './budget/MonthSelector'
import SpendingSection from './budget/SpendingSection'

export default function Budget({ today = todayISO() }: { today?: ISODate }) {
  const db = useDb()
  const data = useLiveQuery(async () => ({
    settings: await db.settings.get('main'),
    accounts: await db.accounts.toArray(),
    categories: await db.categories.toArray(),
    streams: await db.incomeStreams.toArray(),
    txs: await db.transactions.toArray(),
  }), [db])
  const [picked, setPicked] = useState<string | null>(null)

  const startDay = data?.settings?.budgetMonthStartDay ?? 1
  const current = budgetMonthOf(today, startDay)
  const months = useMemo(() => (data ? monthChoices(data.txs, current, startDay) : [current]), [data, current, startDay])
  const month = picked && months.includes(picked) ? picked : current

  const view = useMemo(() => {
    if (!data?.settings) return null
    const { txs, accounts, categories, streams } = data
    const summary = monthSummary({ month, startDay, txs, accounts, categories, streams })
    const monthTxs = txsInMonth(txs, month, startDay)
    return {
      summary,
      monthTxs,
      rows: buildBudgetRows({ spentByCategory: summary.spentByCategory, categories, monthTxs, accounts }),
      credits: unassignedCredits(monthTxs, accounts),
    }
  }, [data, month, startDay])

  if (!data || !view) return <div className="loading" role="status">Loading</div>
  const { summary, rows } = view
  return (
    <div className="budget">
      <MonthSelector months={months} value={month} startDay={startDay} onChange={setPicked} />
      {data.txs.length === 0 ? (
        <EmptyState title="No transactions yet" body="Import a statement to see where your money goes." />
      ) : (
        <Card className="budget-summary">
          <dl className="summary-grid">
            <div className="summary-main">
              <dt>Left</dt>
              <dd><Money pence={summary.leftPence} size="hero" /></dd>
            </div>
            <div>
              <dt>Income received</dt>
              <dd><Money pence={summary.totalIncomePence} /></dd>
            </div>
            <div>
              <dt>Spent</dt>
              <dd><Money pence={summary.totalSpentPence} /></dd>
            </div>
          </dl>
        </Card>
      )}
      <SpendingSection
        db={db}
        rows={rows}
        monthTxs={view.monthTxs}
        allTxs={data.txs}
        accounts={data.accounts}
        categories={data.categories}
      />
      <IncomeSection db={db} streams={data.streams} incomeByStream={summary.incomeByStream} credits={view.credits} />
      <ExportButton month={month} today={today} />
    </div>
  )
}
