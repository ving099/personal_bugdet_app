import { useCallback, useState } from 'react'

/** Message for a section's status line: 'Saved', or what went wrong. Cleared when the user edits again. */
export function useSaveStatus() {
  const [status, setStatus] = useState('')
  const run = useCallback(async (write: () => Promise<void>, ok = 'Saved') => {
    try {
      await write()
      setStatus(ok)
    } catch {
      setStatus("Couldn't save that. Nothing was changed.")
    }
  }, [])
  const clear = useCallback(() => setStatus(''), [])
  return { status, setStatus, run, clear }
}
