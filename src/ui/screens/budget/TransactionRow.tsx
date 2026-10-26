import type { Transaction } from '../../../domain/types'
import Money from '../../components/Money'
import { Button } from '../../components/forms'
import { formatDisplayDate } from '../import/importFlow'
import { useFlagsMenu, type Flag } from './FlagsMenu'

interface Props {
  tx: Transaction
  onChangeCategory: (tx: Transaction) => void
  onFlag: (tx: Transaction, flag: Flag, value: boolean) => void
}

export default function TransactionRow({ tx, onChangeCategory, onFlag }: Props) {
  const flags = useFlagsMenu(tx, onFlag)
  return (
    <li className="txn">
      <div className="txn-main">
        <p className="txn-desc">{tx.description}</p>
        <p className="txn-meta">
          <span>{formatDisplayDate(tx.date)}</span>
          {tx.isRefund && <span className="chip">Refund</span>}
          {tx.isTransfer && <span className="chip">Transfer</span>}
        </p>
      </div>
      <p className="txn-amount">
        <Money pence={tx.amountPence} tone="auto" />
      </p>
      <div className="txn-actions">
        <Button variant="secondary" onClick={() => onChangeCategory(tx)}>
          Change category<span className="sr-only">{` for ${tx.description}`}</span>
        </Button>
        {flags.button}
      </div>
      {flags.panel}
    </li>
  )
}
