import { useId, useState } from 'react'
import type { Transaction } from '../../../domain/types'
import { Button, Checkbox } from '../../components/forms'

export type Flag = 'isRefund' | 'isTransfer'

/** A button that opens the refund and transfer toggles for one transaction. Panel renders in `panel`. */
export function useFlagsMenu(tx: Transaction, onFlag: (tx: Transaction, flag: Flag, value: boolean) => void) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const button = (
    <Button variant="secondary" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)}>
      Flags{' '}<span className="sr-only">{`for ${tx.description}`}</span>
    </Button>
  )
  const panel = open ? (
    <div className="txn-flags" id={panelId} role="group" aria-label={`Flags for ${tx.description}`}>
      <Checkbox label="This is a refund" checked={tx.isRefund} onChange={(v) => onFlag(tx, 'isRefund', v)} />
      <Checkbox label="This is a transfer" checked={tx.isTransfer} onChange={(v) => onFlag(tx, 'isTransfer', v)} />
      <p className="field-hint">Importing another statement can flag matching transfers again.</p>
    </div>
  ) : null
  return { button, panel }
}
