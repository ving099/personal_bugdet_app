/** Hands bytes to the browser as a file download: Blob, object URL and a hidden anchor; the URL is always revoked. */
export function downloadBytes(bytes: Uint8Array, fileName: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }))
  // Revoked a moment later so a slow browser can still start reading the blob.
  const revoke = () => { setTimeout(() => URL.revokeObjectURL(url), 1000) }
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    a.hidden = true
    document.body.appendChild(a)
    try {
      a.click()
    } finally {
      a.remove()
    }
  } finally {
    revoke()
  }
}
