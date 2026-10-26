/** Hands bytes to the browser as a file download: Blob, object URL and a hidden anchor; the URL is always revoked. */
export function downloadBytes(bytes: Uint8Array, fileName: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }))
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
    URL.revokeObjectURL(url)
  }
}
