import { useLiveQuery } from 'dexie-react-hooks'
import type { ISODate, Pence } from '../../domain/types'
import { todayISO } from '../formValues'
import { useDb } from '../useDb'
import DebtsSection from './debts/DebtsSection'
import SavingsSection from './debts/SavingsSection'
import SinkingSection from './debts/SinkingSection'

interface Props {
  today?: ISODate
  /** Starting value for "Extra per month"; the Invest plan supplies it. */
  extraDebtPence?: Pence
}

export default function DebtsSavings({ today = todayISO(), extraDebtPence }: Props) {
  const db = useDb()
  const data = useLiveQuery(async () => ({
    debts: (await db.debts.toArray()).sort((a, b) => a.name.localeCompare(b.name)),
    pots: (await db.savingsPots.toArray()).sort((a, b) => a.name.localeCompare(b.name)),
    funds: (await db.sinkingFunds.toArray()).sort((a, b) => a.name.localeCompare(b.name)),
  }), [db])
  if (!data) return <div className="loading" role="status">Loading</div>
  return (
    <div className="debts">
      <DebtsSection db={db} debts={data.debts} today={today} extraDebtPence={extraDebtPence} />
      <SavingsSection db={db} pots={data.pots} />
      <SinkingSection db={db} funds={data.funds} />
    </div>
  )
}
