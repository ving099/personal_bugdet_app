import { useRef, useState, type DragEvent } from 'react'
import { Button } from '../../components/forms'

/** Choose files with the button (keyboard friendly) or drop them on the area. Both give the same file list. */
export default function FileDrop({ onFiles, disabled, busy }: { onFiles: (files: File[]) => void; disabled: boolean; busy: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)

  function drop(e: DragEvent) {
    e.preventDefault()
    setOver(false)
    if (!disabled && e.dataTransfer.files.length > 0) onFiles([...e.dataTransfer.files])
  }

  return (
    <div
      className="dropzone"
      role="group"
      aria-label="Statement files"
      data-over={over || undefined}
      onDragOver={(e) => {
        e.preventDefault()
        if (!disabled) setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
    >
      <Button variant="primary" disabled={disabled || busy} aria-busy={busy} onClick={() => input.current?.click()}>
        Choose CSV files
      </Button>
      <p className="dropzone-text">
        {disabled ? 'Choose an account first, then add its statements.' : 'or drop one or more CSV files here. They stay on this device.'}
      </p>
      <input
        ref={input}
        className="sr-only"
        type="file"
        multiple
        accept=".csv,text/csv"
        aria-label="Choose statement files"
        tabIndex={-1}
        disabled={disabled}
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          e.target.value = ''
          if (files.length > 0) onFiles(files)
        }}
      />
    </div>
  )
}
