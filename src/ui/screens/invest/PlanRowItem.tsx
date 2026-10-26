import { useId, useRef, useState } from 'react'
import type { InvestmentLog } from '../../../domain/types'
import Money from '../../components/Money'
import { MONEY_ERROR, parseMoney, penceToInput } from '../../formValues'
import { useDb } from '../../useDb'
import { logPlanLine, setLoggedAmount, unlogPlanLine } from './investDb'
import { SHORT_WRAPPER, type PlanRow } from './investModel'

interface Props {
  row: PlanRow
  logged?: InvestmentLog
  month: string
  /** Tax year a new tick counts against. */
  taxYear: string
  platformId: string
  /** Added to the accessible names, e.g. ', logged for 2026/27'. */
  nameSuffix?: string
}

/** One fund line: a checkbox that logs it, and once logged, the amount actually put in. */
export default function PlanRowItem({ row, logged, month, taxYear, platformId, nameSuffix = '' }: Props) {
  const db = useDb()
  const id = useId()
  const busy = useRef(false)
  const [error, setError] = useState('')
  const [amount, setAmount] = useState<string | null>(null)
  const [amountError, setAmountError] = useState('')
  const where = `${row.name} in the ${SHORT_WRAPPER[row.wrapper]}${nameSuffix}`

  async function toggle(on: boolean) {
    // A second click while the first write is running is ignored; the write itself is idempotent too.
    if (busy.current) return
    busy.current = true
    setError('')
    try {
      if (on) await logPlanLine(db, { row, month, taxYear, actualPence: row.plannedPence, platformId })
      else if (logged) await unlogPlanLine(db, logged.id)
      setAmount(null)
    } catch {
      setError(on ? "Couldn't log that. Nothing was changed." : "Couldn't undo that. Nothing was changed.")
    } finally {
      busy.current = false
    }
  }

  async function saveAmount() {
    if (amount === null || !logged) return
    const parsed = parseMoney(amount)
    if (!parsed.ok || parsed.pence < 0) {
      setAmountError(parsed.ok ? 'The amount cannot be negative.' : MONEY_ERROR)
      return
    }
    setAmountError('')
    setError('')
    try {
      await setLoggedAmount(db, logged.id, parsed.pence)
      setAmount(null)
    } catch {
      setError("Couldn't save the amount. Nothing was changed.")
    }
  }

  return (
    <li className="plan-row">
      <div className="plan-line">
        {/* The label wraps the box, so its whole 48px cell (not just the 24px box) toggles the line. */}
        <label className="plan-label">
          <input className="check-box" type="checkbox" checked={!!logged} aria-label={`Bought ${where}`}
            onChange={(e) => void toggle(e.target.checked)} />
          <span className="plan-text">
            <span className="plan-fund">{row.name}</span>
            {row.ticker && <span className="plan-ticker">{row.ticker}</span>}
          </span>
        </label>
        <span className="plan-amount"><Money pence={row.plannedPence} /></span>
      </div>
      {logged && (
        <div className="plan-actual">
          <label className="field-label" htmlFor={`${id}-amount`}>Amount put in</label>
          <input id={`${id}-amount`} className="input" type="text" inputMode="decimal" autoComplete="off"
            aria-label={`Amount put in, ${where}`}
            aria-invalid={amountError ? true : undefined}
            aria-describedby={amountError ? `${id}-amount-error` : undefined}
            value={amount ?? penceToInput(logged.actualPence)}
            onChange={(e) => setAmount(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void saveAmount()
              }
            }}
            onBlur={() => void saveAmount()} />
          {amountError && <p className="field-error" id={`${id}-amount-error`}>{amountError}</p>}
        </div>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
    </li>
  )
}
