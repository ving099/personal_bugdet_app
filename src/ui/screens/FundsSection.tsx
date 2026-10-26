import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import type { Bucket, Holding, Platform } from '../../domain/types'
import { Checkbox, NumberInput, RowEditor, Select, TextInput } from '../components/forms'
import { useDb } from '../useDb'
import { SaveRow, SettingsSection } from './SettingsSection'
import { NO_WEIGHT_WARNING, bucketsWithNoWeight, validateWeight } from './settingsValidation'
import { sortHoldings } from './wizardModel'
import { useSaveStatus } from './useSaveStatus'

interface FundDraft {
  id: string
  bucket: Bucket
  weight: string
  fundType: string
  exampleName: string
  ticker: string
  platforms: string[]
}

const BUCKETS: { value: Bucket; label: string }[] = [
  { value: 'growth', label: 'Growth' },
  { value: 'aggressive', label: 'Aggressive' },
]

function toDraft(h: Holding): FundDraft {
  return { ...h, weight: String(h.weight), platforms: [...h.platforms] }
}

function FundsEditor({ holdings, platforms }: { holdings: Holding[]; platforms: Platform[] }) {
  const db = useDb()
  const { status, run, setStatus, clear } = useSaveStatus()
  const [rows, setRows] = useState<FundDraft[]>(() => sortHoldings(holdings).map(toDraft))
  const [attempted, setAttempted] = useState(false)
  const empty = bucketsWithNoWeight(rows)

  function edit(id: string, patch: Partial<FundDraft>) {
    clear()
    setRows(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  async function save() {
    clear()
    const bad = rows.some((r) => validateWeight(r.weight) !== undefined || !r.exampleName.trim() || !r.ticker.trim())
    if (bad) {
      setAttempted(true)
      setStatus('Fix the highlighted fields first.')
      return
    }
    const next: Holding[] = rows.map((r) => ({
      id: r.id,
      bucket: r.bucket,
      weight: Number(r.weight),
      fundType: r.fundType.trim() || 'Fund',
      exampleName: r.exampleName.trim(),
      ticker: r.ticker.trim(),
      platforms: r.platforms,
    }))
    await run(async () => {
      await db.transaction('rw', db.holdings, async () => {
        const keep = new Set(next.map((h) => h.id))
        const gone = (await db.holdings.toCollection().primaryKeys()).filter((k) => !keep.has(k))
        await db.holdings.bulkDelete(gone)
        await db.holdings.bulkPut(next)
      })
    })
  }

  return (
    <>
      <p className="settings-note">Example funds are starting points, not recommendations. Check each one before you buy.</p>
      <RowEditor
        items={rows}
        getKey={(r) => r.id}
        noun="fund"
        emptyText="No example funds."
        onAdd={() => {
          clear()
          setRows([
            ...rows,
            {
              id: globalThis.crypto.randomUUID(), bucket: 'growth', weight: '1', fundType: '', exampleName: '', ticker: '',
              platforms: [],
            },
          ])
        }}
        onRemove={(r) => {
          clear()
          setRows(rows.filter((x) => x.id !== r.id))
        }}
        renderRow={(r) => (
          <>
            <TextInput label="Name" value={r.exampleName} onChange={(exampleName) => edit(r.id, { exampleName })}
              error={attempted && !r.exampleName.trim() ? 'Enter a name' : undefined} />
            <TextInput label="Ticker" value={r.ticker} onChange={(ticker) => edit(r.id, { ticker })}
              error={attempted && !r.ticker.trim() ? 'Enter a ticker' : undefined} />
            <TextInput label="Fund type" value={r.fundType} onChange={(fundType) => edit(r.id, { fundType })} />
            <Select label="Bucket" value={r.bucket} options={BUCKETS} onChange={(bucket) => edit(r.id, { bucket })} />
            <NumberInput label="Weight" value={r.weight} onChange={(weight) => edit(r.id, { weight })}
              hint="A whole number. Funds in a bucket share it in proportion to their weights."
              error={validateWeight(r.weight)} />
            <div className="field">
              <p className="field-label">Carried by</p>
              {platforms.map((p) => (
                <Checkbox
                  key={p.id}
                  label={p.name}
                  checked={r.platforms.includes(p.id)}
                  onChange={(on) =>
                    edit(r.id, { platforms: on ? [...r.platforms, p.id] : r.platforms.filter((x) => x !== p.id) })
                  }
                />
              ))}
            </div>
          </>
        )}
      />
      {empty.map((b) => (
        <p className="warning-text" key={b}>
          {`${b === 'growth' ? 'Growth' : 'Aggressive'}: ${NO_WEIGHT_WARNING}`}
        </p>
      ))}
      <SaveRow onSave={() => void save()} status={status} />
    </>
  )
}

export default function FundsSection() {
  const db = useDb()
  const data = useLiveQuery(async () => ({
    holdings: await db.holdings.toArray(),
    platforms: await db.platforms.toArray(),
  }), [db])
  return (
    <SettingsSection title="Example funds">
      {data && <FundsEditor holdings={data.holdings} platforms={data.platforms} />}
    </SettingsSection>
  )
}
