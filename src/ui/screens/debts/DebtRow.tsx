import type { ReactNode } from 'react'
import type { Debt, ISODate } from '../../../domain/types'
import Money from '../../components/Money'
import { Button } from '../../components/forms'
import { DEBT_KIND_OPTIONS } from '../wizardModel'
import { debtView } from './debtsModel'

interface Props {
  debt: Debt
  today: ISODate
  onEdit: () => void
  onDelete: () => void
  /** The edit form, shown under the row. */
  children?: ReactNode
}

export default function DebtRow({ debt, today, onEdit, onDelete, children }: Props) {
  const v = debtView(debt, today)
  const kind = DEBT_KIND_OPTIONS.find((k) => k.value === debt.kind)?.label
  return (
    <li className="debt">
      <div className="item-head">
        <p className="item-name">
          {debt.name} <span className="chip">{kind}</span>
        </p>
        <p className="item-amount">
          <Money pence={debt.balancePence} />
        </p>
      </div>
      <p className="item-meta">
        <span>{v.aprText}</span>
        <span>
          Minimum <Money pence={debt.minimumPaymentPence} /> a month
        </span>
      </p>
      {v.promoText && <p className="item-meta">{v.promoText}</p>}
      {v.usageText && v.usagePercent !== undefined && (
        <>
          <p className="item-meta">
            <span className="item-strong">{v.usageText}</span>
            <span>{v.usageDetail}</span>
          </p>
          <div className="bar" role="progressbar" aria-label={`${debt.name}: ${v.usageText}`} aria-valuemin={0} aria-valuemax={100}
            aria-valuenow={v.usagePercent} aria-valuetext={v.usageText}>
            <div className="bar-fill" style={{ width: `${v.usagePercent}%` }} />
          </div>
        </>
      )}
      {v.usageHint && <p className="item-meta">{v.usageHint}</p>}
      <div className="item-actions">
        <Button variant="secondary" id={`edit-${debt.id}`} onClick={onEdit}>
          Edit{' '}<span className="sr-only">{`${debt.name}`}</span>
        </Button>
        <Button variant="secondary" onClick={onDelete}>
          Delete{' '}<span className="sr-only">{`${debt.name}`}</span>
        </Button>
      </div>
      {children}
    </li>
  )
}
