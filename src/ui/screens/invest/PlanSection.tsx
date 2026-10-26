import { useState } from 'react'
import type { Bucket, Platform, Wrapper } from '../../../domain/types'
import Money from '../../components/Money'
import SplitBar from '../../components/SplitBar'
import { Select } from '../../components/forms'
import { useDb } from '../../useDb'
import { choosePlatform } from './investDb'
import { lineKey, SHORT_WRAPPER, WRAPPER_NAMES, type InvestData, type InvestView, type PlanGroup } from './investModel'
import PlanRowItem from './PlanRowItem'

const BUCKET_NAMES: Record<Bucket, string> = { growth: 'Growth', aggressive: 'Aggressive' }
const CHOOSE = ''

export default function PlanSection({ data, view }: { data: InvestData; view: InvestView }) {
  const { plan, groups } = view
  const { growth: g, aggressive: a } = data.settings.bucketSplit
  const target = g + a > 0 ? (g / (g + a)) * 100 : 50
  return (
    <section className="invest-section" aria-labelledby="plan-heading">
      <h2 className="invest-heading" id="plan-heading">Your plan</h2>
      <p className="invest-intro">Tick each line once you have bought it. That logs it and counts it against your allowance.</p>
      <SplitBar growthPct={plan.effectiveSplit.growth} aggressivePct={plan.effectiveSplit.aggressive} targetGrowthPct={target} />
      {plan.warnings.length > 0 && (
        <ul className="warning-list" aria-label="Plan warnings">
          {plan.warnings.map((w) => <li key={w} className="warning-text">{w}</li>)}
        </ul>
      )}
      {groups.map((group) => (
        <WrapperGroup key={group.wrapper} group={group} data={data} view={view} />
      ))}
    </section>
  )
}

function WrapperGroup({ group, data, view }: { group: PlanGroup; data: InvestData; view: InvestView }) {
  const headingId = `plan-${group.wrapper}`
  return (
    <section className="plan-group" aria-labelledby={headingId}>
      <h3 className="plan-group-heading" id={headingId}>
        <span>{WRAPPER_NAMES[group.wrapper]}</span> <Money pence={group.pence} />
      </h3>
      {group.wrapper === 'pension' && <p className="item-meta">Money in a pension is locked until pension age.</p>}
      {group.note && <p className="item-meta">{group.note}</p>}
      <PlatformLine wrapper={group.wrapper} platformId={group.platformId} platforms={data.platforms} />
      {(['growth', 'aggressive'] as const).map((bucket) => {
        const rows = group.rows.filter((r) => r.bucket === bucket)
        const loose = group.unallocated.filter((u) => u.bucket === bucket)
        const total = [...rows.map((r) => r.plannedPence), ...loose.map((u) => u.pence)].reduce((s, p) => s + p, 0)
        if (total === 0) return null
        return (
          <div key={bucket} className="plan-bucket">
            <h4 className="plan-bucket-heading">
              <span>{BUCKET_NAMES[bucket]}</span> <Money pence={total} />
            </h4>
            {loose.length > 0 && (
              <p className="warning-text">{`No ${bucket} fund is set up, so this part has nowhere to go. Add one in Settings.`}</p>
            )}
            <ul className="plan-list">
              {rows.map((row) => (
                <PlanRowItem key={row.id} row={row} logged={view.logged.get(lineKey(row.wrapper, row.holdingId))} month={view.month} taxYear={view.taxYear}
                  platformId={group.platformId} />
              ))}
            </ul>
          </div>
        )
      })}
    </section>
  )
}

function PlatformLine({ wrapper, platformId, platforms }: { wrapper: Wrapper; platformId: string; platforms: Platform[] }) {
  const db = useDb()
  const [error, setError] = useState('')
  const chosen = platforms.find((p) => p.id === platformId)
  if (chosen) {
    return (
      <p className="plan-platform">
        Platform: <strong>{chosen.name}</strong>
      </p>
    )
  }
  const offering = platforms.filter((p) => p.wrappersSupported.includes(wrapper))
  return (
    <div className="plan-platform-pick">
      <Select
        label={`Platform for the ${SHORT_WRAPPER[wrapper]}`}
        value={CHOOSE}
        options={[{ value: CHOOSE, label: 'Choose a platform' }, ...offering.map((p) => ({ value: p.id, label: p.name }))]}
        hint={offering.length === 0 ? 'None of your platforms offers this yet; it needs a separate provider.' : 'Saved as your default, the same as in Settings.'}
        disabled={offering.length === 0}
        onChange={(id) => {
          if (id === CHOOSE) return
          setError('')
          choosePlatform(db, wrapper, id).catch(() => setError("Couldn't save the platform. Nothing was changed."))
        }}
      />
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  )
}
