import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import type { Platform, Settings, Wrapper } from '../../domain/types'
import { Checkbox, Select, TextInput } from '../components/forms'
import { useDb } from '../useDb'
import { isoDateOk } from './wizardModel'
import { SaveRow, SettingsSection } from './SettingsSection'
import { useSaveStatus } from './useSaveStatus'

const WRAPPER_NAMES: Record<Wrapper, string> = {
  pension: 'Pension (SIPP)', isa: 'Stocks and shares ISA', lisa: 'Lifetime ISA', gia: 'General investment account',
}
const ORDER: Wrapper[] = ['pension', 'isa', 'lisa', 'gia']
const CHOOSE = ''

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

function staleness(lastChecked: string, today: string): string {
  if (!isoDateOk(lastChecked) || !isoDateOk(today)) return ''
  const d = daysBetween(lastChecked, today)
  if (d <= 0) return d === 0 ? 'Checked today' : 'Checked in the future'
  return d === 1 ? 'Checked 1 day ago' : `Checked ${d} days ago`
}

interface Props {
  platforms: Platform[]
  settings: Settings
  today: string
}

function PlatformsEditor({ platforms, settings, today }: Props) {
  const db = useDb()
  const { status, run, setStatus, clear } = useSaveStatus()
  const [rows, setRows] = useState<Platform[]>(() => platforms.map((p) => ({ ...p, wrappersSupported: [...p.wrappersSupported] })))
  const [defaults, setDefaults] = useState<Partial<Record<Wrapper, string>>>(() => ({ ...settings.defaultPlatformByWrapper }))
  const [attempted, setAttempted] = useState(false)
  const lisaOn = settings.lisaEnabled ?? false

  function edit(id: string, patch: Partial<Platform>) {
    clear()
    setRows(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  async function save() {
    clear()
    if (rows.some((r) => !isoDateOk(r.lastChecked) || !r.name.trim())) {
      setAttempted(true)
      setStatus('Fix the highlighted fields first.')
      return
    }
    const clean: Partial<Record<Wrapper, string>> = {}
    for (const w of ORDER) {
      const id = defaults[w]
      const p = rows.find((r) => r.id === id)
      if (id && p?.wrappersSupported.includes(w)) clean[w] = id
    }
    await run(async () => {
      await db.transaction('rw', [db.platforms, db.settings], async () => {
        await db.platforms.bulkPut(rows.map((r) => ({ ...r, name: r.name.trim() })))
        await db.settings.update('main', { defaultPlatformByWrapper: clean })
      })
      setDefaults(clean)
    })
  }

  return (
    <>
      <p className="settings-note">
        Which platforms offer which accounts changes often. Check each platform&apos;s own site and update the date when you do.
      </p>
      <div className="rows">
        {rows.map((p) => (
          <fieldset className="row-card" key={p.id}>
            <legend className="row-legend">{p.name || 'Platform'}</legend>
            <div className="row-fields">
              <TextInput label="Platform name" value={p.name} onChange={(name) => edit(p.id, { name })}
                error={attempted && !p.name.trim() ? 'Enter a name' : undefined} />
              <TextInput label="Last checked" type="date" value={p.lastChecked} onChange={(lastChecked) => edit(p.id, { lastChecked })}
                hint={staleness(p.lastChecked, today) || undefined}
                error={!isoDateOk(p.lastChecked) && (attempted || p.lastChecked !== '') ? 'Choose a date' : undefined} />
            </div>
            <div className="field">
              <p className="field-label">Offers</p>
              {ORDER.filter((w) => w !== 'lisa' || lisaOn || p.wrappersSupported.includes('lisa')).map((w) => (
                <Checkbox
                  key={w}
                  label={WRAPPER_NAMES[w]}
                  checked={p.wrappersSupported.includes(w)}
                  onChange={(on) =>
                    edit(p.id, {
                      wrappersSupported: on ? [...p.wrappersSupported, w] : p.wrappersSupported.filter((x) => x !== w),
                    })
                  }
                />
              ))}
            </div>
            {p.notes && <p className="field-hint">{p.notes}</p>}
          </fieldset>
        ))}
      </div>
      <h3 className="settings-subheading">Default platforms</h3>
      <div className="row-fields">
        {ORDER.filter((w) => w !== 'lisa' || lisaOn).map((w) => (
          <Select
            key={w}
            label={`Default for ${WRAPPER_NAMES[w]}`}
            value={defaults[w] ?? CHOOSE}
            options={[
              { value: CHOOSE, label: 'Choose each month' },
              ...rows.filter((r) => r.wrappersSupported.includes(w)).map((r) => ({ value: r.id, label: r.name })),
            ]}
            onChange={(id) => {
              clear()
              setDefaults({ ...defaults, [w]: id })
            }}
          />
        ))}
      </div>
      <SaveRow onSave={() => void save()} status={status} />
    </>
  )
}

export default function PlatformsSection({ settings, today }: { settings: Settings; today: string }) {
  const db = useDb()
  const platforms = useLiveQuery(async () => (await db.platforms.toArray()).sort((a, b) => a.name.localeCompare(b.name)), [db])
  return (
    <SettingsSection title="Platforms">
      {platforms && <PlatformsEditor platforms={platforms} settings={settings} today={today} />}
    </SettingsSection>
  )
}
