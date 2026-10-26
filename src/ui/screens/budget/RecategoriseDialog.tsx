import { useState } from 'react'
import type { Category, Transaction } from '../../../domain/types'
import { merchantKey } from '../../../import/matching'
import FormDialog from '../../components/FormDialog'
import { Checkbox, Select } from '../../components/forms'
import { plural } from '../import/importFlow'

interface Props {
  tx: Transaction
  categories: Category[]
  /** Other stored rows with the same merchant. */
  similarCount: number
  busy: boolean
  error?: string
  fallbackFocusId?: string
  onCancel: () => void
  onSave: (categoryId: string, applyToSimilar: boolean) => void
}

export default function RecategoriseDialog({ tx, categories, similarCount, busy, error, fallbackFocusId, onCancel, onSave }: Props) {
  const canMatch = merchantKey(tx.description) !== ''
  const [categoryId, setCategoryId] = useState(tx.categoryId ?? '')
  const [similar, setSimilar] = useState(canMatch)
  const [problem, setProblem] = useState('')
  const sorted = [...categories].sort((a, b) => a.name.localeCompare(b.name))
  const options = [
    ...(tx.categoryId === undefined ? [{ value: '', label: 'Choose a category' }] : []),
    ...sorted.map((c) => ({ value: c.id, label: c.name })),
  ]

  function submit() {
    if (categoryId === '') {
      setProblem('Choose a category.')
      return
    }
    onSave(categoryId, similar && canMatch)
  }

  return (
    <FormDialog
      title="Change category"
      submitLabel="Save"
      onCancel={onCancel}
      onSubmit={submit}
      busy={busy}
      error={problem || error}
      fallbackFocusId={fallbackFocusId}
    >
      <p className="dialog-detail">{tx.description}</p>
      <Select label="Category" value={categoryId} options={options} onChange={(v) => { setCategoryId(v); setProblem('') }} />
      <Checkbox
        label="Apply to all similar"
        checked={similar && canMatch}
        disabled={!canMatch}
        onChange={setSimilar}
        hint={
          canMatch
            ? similarCount > 0
              ? `Also changes ${plural(similarCount, 'other transaction')} from this merchant, and puts future imports in the same category.`
              : 'Future imports from this merchant will use this category.'
            : 'There is no merchant name to match on.'
        }
      />
    </FormDialog>
  )
}
