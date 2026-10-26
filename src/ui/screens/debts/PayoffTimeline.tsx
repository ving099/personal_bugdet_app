import { useMemo, useState } from 'react'
import { avalanchePlan } from '../../../debt/debt'
import { formatGBP } from '../../../domain/money'
import type { Debt, ISODate, Pence } from '../../../domain/types'
import Card from '../../components/Card'
import { MoneyInput } from '../../components/forms'
import { parseMoney, penceToInput } from '../../formValues'
import { balanceSeries, formatMonthYear, formatShortMonth, payoffMilestones, type SeriesPoint } from './debtsModel'

const W = 320
const H = 110

function Chart({ series, label }: { series: SeriesPoint[]; label: string }) {
  const max = Math.max(...series.map((p) => p.total), 1)
  const x = (i: number) => (series.length < 2 ? 0 : (i / (series.length - 1)) * W)
  const y = (t: number) => 6 + (1 - t / max) * (H - 12)
  const points = series.map((p, i) => `${x(i).toFixed(1)},${y(p.total).toFixed(1)}`).join(' ')
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} preserveAspectRatio="none">
        <line className="chart-base" x1="0" x2={W} y1={H - 6} y2={H - 6} />
        <polyline className="chart-line" points={points} />
      </svg>
      <figcaption className="chart-axis" aria-hidden="true">
        <span>{formatShortMonth(series[0].date)}</span>
        <span>{formatShortMonth(series[series.length - 1].date)}</span>
      </figcaption>
    </figure>
  )
}

interface Props {
  debts: Debt[]
  today: ISODate
  extraDebtPence?: Pence
}

export default function PayoffTimeline({ debts, today, extraDebtPence }: Props) {
  const [extra, setExtra] = useState(() => penceToInput(extraDebtPence ?? 0))
  const parsed = extra.trim() === '' ? ({ ok: true, pence: 0 } as const) : parseMoney(extra)
  const negative = parsed.ok && parsed.pence < 0
  const overpay = parsed.ok && parsed.pence >= 0 ? parsed.pence : 0

  const view = useMemo(() => {
    const plan = avalanchePlan({ debts, monthlyOverpaymentPence: overpay, startDate: today })
    const series = balanceSeries(plan, debts, today)
    return { plan, series, milestones: payoffMilestones(plan, debts) }
  }, [debts, overpay, today])

  const { plan, series, milestones } = view
  const start = series[0].total
  const end = series[series.length - 1]
  const headline =
    start === 0
      ? 'No balance left to pay off.'
      : plan.debtFreeDate
        ? `Debt-free by ${formatMonthYear(plan.debtFreeDate)}`
        : 'Not payable within 50 years at these payments. Raise your payments to see a date.'
  const chartLabel =
    start === 0
      ? ''
      : plan.debtFreeDate
        ? `Total remaining debt falls from ${formatGBP(start)} today to ${formatGBP(0)} by ${formatMonthYear(plan.debtFreeDate)}.`
        : `Total remaining debt is ${formatGBP(start)} today and ${formatGBP(end.total)} after 50 years at these payments.`

  return (
    <div className="payoff">
      <h3 className="import-subheading">Payoff timeline</h3>
      <div className="payoff-input">
        <MoneyInput label="Extra per month" value={extra} onChange={setExtra}
          hint="The Invest tab shows how much extra the plan puts towards debt." />
        {negative && <p className="field-error">Extra cannot be negative.</p>}
      </div>
      <Card className="debtfree">
        <p className="debtfree-line" role="status">
          {headline}
        </p>
        {start > 0 && (
          <>
            <p className="item-meta">Highest interest first, then the next. When a debt is cleared, its payment moves on to the next one.</p>
            <Chart series={series} label={chartLabel} />
          </>
        )}
      </Card>
      {milestones.length > 0 && (
        <ul className="milestones" aria-label="When each debt is cleared">
          {milestones.map((m) => (
            <li key={m.debtId}>
              {m.date ? `${m.name} cleared ${formatShortMonth(m.date)}` : `${m.name} not cleared within 50 years at these payments`}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
