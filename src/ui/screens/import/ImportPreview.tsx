import { useState } from 'react'
import Card from '../../components/Card'
import { Button, Checkbox } from '../../components/forms'
import Money from '../../components/Money'
import { formatDisplayDate, plural, PREVIEW_ROW_LIMIT, summaryLine, type Preview } from './importFlow'

interface ImportPreviewProps {
  preview: Preview
  fileCount: number
  busy: boolean
  error: string
  onConfirm: () => void
  onEditMapping: () => void
}

export default function ImportPreview({ preview, fileCount, busy, error, onConfirm, onEditMapping }: ImportPreviewProps) {
  const [hideDuplicates, setHideDuplicates] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const rows = hideDuplicates ? preview.rows.filter((r) => !r.duplicate) : preview.rows
  const visible = showAll ? rows : rows.slice(0, PREVIEW_ROW_LIMIT)
  const nothingNew = preview.newRows === 0

  return (
    <section className="import-section" aria-labelledby="preview-heading">
      <h2 className="import-heading" id="preview-heading">
        Check before importing
      </h2>
      <Card>
        <p className="preview-summary">{summaryLine(preview)}</p>
        {nothingNew && (
          <p className="import-hint">
            Nothing new to import. {preview.duplicates === 1 ? 'The row is' : `All ${preview.duplicates} rows are`} already in your records.
          </p>
        )}
        {preview.transfers > 0 && (
          <p className="import-hint">Transfers between your own accounts are left out of spending and income.</p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="import-actions">
          <Button variant="primary" onClick={onConfirm} disabled={nothingNew || busy} aria-busy={busy}>
            {nothingNew
              ? 'Import'
              : `Import ${plural(preview.newRows, 'transaction')}${fileCount > 1 ? ` from ${fileCount} files` : ''}`}
          </Button>
          <Button onClick={onEditMapping} disabled={busy}>
            Edit mapping
          </Button>
        </div>
      </Card>

      {preview.duplicates > 0 && (
        <Checkbox label="Hide duplicates" checked={hideDuplicates} onChange={setHideDuplicates} />
      )}
      <div className="table-wrap" role="region" aria-label="Rows to import" tabIndex={0}>
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Description</th>
              <th scope="col" className="num">
                Amount
              </th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.key} data-duplicate={r.duplicate || undefined}>
                <td className="nowrap">{formatDisplayDate(r.date)}</td>
                <td className="desc">{r.description}</td>
                <td className="num">
                  <Money pence={r.amountPence} tone="auto" />
                </td>
                <td>
                  <span className="chips">
                    {r.duplicate && <span className="chip">Duplicate</span>}
                    {r.transfer && <span className="chip">Transfer</span>}
                    {r.refund && <span className="chip">Refund</span>}
                    {!r.duplicate && !r.transfer && !r.refund && <span className="sr-only">New</span>}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!showAll && rows.length > PREVIEW_ROW_LIMIT && (
        <Button className="show-all" onClick={() => setShowAll(true)}>
          {`Show all ${rows.length} rows`}
        </Button>
      )}
    </section>
  )
}
