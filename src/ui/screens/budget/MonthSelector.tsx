import { Button, Select } from '../../components/forms'
import { ChevronLeftIcon, ChevronRightIcon } from '../../components/icons'
import { formatPeriod, monthLabel } from './budgetModel'

interface Props {
  months: string[]
  value: string
  startDay: number
  onChange: (month: string) => void
}

export default function MonthSelector({ months, value, startDay, onChange }: Props) {
  const index = months.indexOf(value)
  const go = (delta: number) => {
    const next = months[index + delta]
    if (next) onChange(next)
  }
  return (
    <div className="month-select">
      <div className="month-controls">
        <Button variant="secondary" aria-label="Previous month" aria-disabled={index <= 0} onClick={() => go(-1)}>
          <ChevronLeftIcon />
        </Button>
        <div className="month-pick">
          <Select
            label="Budget month"
            value={value}
            options={[...months].reverse().map((m) => ({ value: m, label: monthLabel(m) }))}
            onChange={onChange}
          />
        </div>
        <Button variant="secondary" aria-label="Next month" aria-disabled={index >= months.length - 1} onClick={() => go(1)}>
          <ChevronRightIcon />
        </Button>
      </div>
      <p className="month-range">{formatPeriod(value, startDay)}</p>
    </div>
  )
}
