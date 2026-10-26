import type { Settings } from '../domain/types'
import type { BudgetDB } from '../storage/db'

const APP = 'budget'
/** Snapshot format version: bump whenever table shapes change. */
const VERSION = 1

/** The snapshot JSON is unusable (corrupt, wrong app, unsupported version, malformed tables). */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SnapshotError'
  }
}

/**
 * Serialises every table in `db` to JSON. All stored values are JSON-safe (ISO date strings, numbers,
 * strings, booleans); no table holds Blob, Date or Uint8Array values.
 */
export async function exportSnapshot(db: BudgetDB, opts: { settings?: Partial<Settings> } = {}): Promise<string> {
  const tables: Record<string, unknown[]> = {}
  await db.transaction('r', db.tables, async () => {
    for (const t of db.tables) tables[t.name] = await t.toArray()
  })
  // The app lock belongs to the device, so its passcode hash never goes into a backup file.
  // `opts.settings` stamps fields (for example backupLastAt) into the settings row inside the file.
  tables.settings = (tables.settings ?? []).map((row) => {
    const { appLock: _drop, ...rest } = row as Settings
    return { ...rest, ...opts.settings }
  })
  return JSON.stringify({ app: APP, version: VERSION, exportedAt: new Date().toISOString(), tables })
}

const isRow = (r: unknown) => typeof r === 'object' && r !== null && !Array.isArray(r)

/**
 * Replaces ALL data in `db` with the snapshot, in one transaction. Validates before touching the db and
 * rolls back on any failure. Settings are replaced, except `appLock`: the device keeps its own app lock (or none),
 * whatever the file holds, and old files that carry one are ignored. Unknown tables are ignored; known tables missing from the snapshot become empty.
 */
export async function restoreSnapshot(db: BudgetDB, json: string): Promise<void> {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new SnapshotError('Backup data is corrupt (not valid JSON)')
  }
  if (!isRow(parsed)) throw new SnapshotError('Backup data is not a snapshot')
  const snap = parsed as { app?: unknown; version?: unknown; tables?: unknown }
  if (snap.app !== APP) throw new SnapshotError('Not a budget app backup')
  if (snap.version !== VERSION) throw new SnapshotError('Unsupported backup version')
  if (!isRow(snap.tables)) throw new SnapshotError('Backup has no tables')
  const payload = snap.tables as Record<string, unknown>

  const rowsByTable = new Map<string, unknown[]>()
  for (const t of db.tables) {
    const rows = payload[t.name] ?? []
    if (!Array.isArray(rows)) throw new SnapshotError(`Table ${t.name} is malformed`)
    if (!rows.every(isRow)) throw new SnapshotError(`Table ${t.name} contains invalid rows`)
    rowsByTable.set(t.name, rows)
  }

  await db.transaction('rw', db.tables, async () => {
    const deviceLock = (await db.settings.get('main'))?.appLock ?? null
    for (const t of db.tables) {
      await t.clear()
      const rows = rowsByTable.get(t.name) ?? []
      await t.bulkAdd(t.name === 'settings' ? rows.map((r) => ({ ...(r as object), appLock: deviceLock })) : rows)
    }
  })
}
