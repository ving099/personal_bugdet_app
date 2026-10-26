import { useState } from 'react'
import { useDeferredFocus } from '../../useFocusFirst'

interface Ops<T> {
  save: (item: T) => Promise<unknown>
  remove: (item: T) => Promise<unknown>
}

/** Add / edit / delete state shared by the debts, pots and yearly bills lists. */
export function useCrud<T extends { id: string; name: string }>(ops: Ops<T>, ids: { heading: string; add: string }) {
  /** An item id, 'new', or null when no form is open. */
  const [editing, setEditing] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<T | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [deleteError, setDeleteError] = useState('')
  const focusLater = useDeferredFocus()
  const failure = "Couldn't save that. Nothing was changed."

  async function save(item: T) {
    const isNew = editing === 'new'
    setBusy(true)
    setError('')
    try {
      await ops.save(item)
      setNotice(`Saved ${item.name}.`)
      setEditing(null)
      focusLater(isNew ? ids.add : `edit-${item.id}`)
    } catch {
      setError(failure)
    } finally {
      setBusy(false)
    }
  }

  async function confirmDelete() {
    if (!deleting) return
    setBusy(true)
    setDeleteError('')
    try {
      await ops.remove(deleting)
      setNotice(`Deleted ${deleting.name}.`)
      setDeleting(null)
      // An unsaved form open on another row stays as it is.
      setEditing((open) => (open === deleting.id ? null : open))
      focusLater(ids.heading)
    } catch {
      setDeleteError("Couldn't delete that. Nothing was changed.")
    } finally {
      setBusy(false)
    }
  }

  function open(id: string) {
    setEditing(id)
    setError('')
  }

  function close(returnTo: string) {
    setEditing(null)
    setError('')
    focusLater(returnTo)
  }

  return { editing, open, close, save, busy, notice, error, deleting, setDeleting, confirmDelete, deleteError, setDeleteError }
}
