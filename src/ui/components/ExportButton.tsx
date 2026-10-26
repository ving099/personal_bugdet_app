import { useRef, useState } from 'react'
import type { ISODate } from '../../domain/types'
import { downloadBytes } from '../download'
import { buildExportData } from '../exportData'
import { loadInvestData } from '../screens/invest/investDb'
import { useDb } from '../useDb'
import { Button } from './forms'

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/** Downloads the month-end spreadsheet for budget month `month` ('YYYY-MM') as budget-YYYY-MM.xlsx. */
export default function ExportButton({ month, today }: { month: string; today: ISODate }) {
  const db = useDb()
  const running = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function run() {
    if (running.current) return
    running.current = true
    setBusy(true)
    setError('')
    try {
      const data = await loadInvestData(db)
      if (!data) throw new Error('Settings are missing.')
      // ExcelJS is large, so it loads only when someone exports. The service worker precaches the chunk for offline use.
      const { buildWorkbook } = await import('../../export/workbook')
      const bytes = await buildWorkbook(buildExportData(data, month, today))
      downloadBytes(bytes, `budget-${month}.xlsx`, XLSX_MIME)
    } catch {
      setError("Couldn't make the spreadsheet. Nothing was changed. Try again.")
    } finally {
      running.current = false
      setBusy(false)
    }
  }

  return (
    <div className="export-row">
      <Button variant="secondary" onClick={() => void run()} aria-busy={busy}>
        {busy ? 'Preparing spreadsheet…' : 'Download month-end spreadsheet'}
      </Button>
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  )
}
