import { CsvParseError, parseCsv } from '../../../import/csv'

export const MAX_FILE_BYTES = 5 * 1024 * 1024

export type StagedFile = { name: string; rows: string[][]; error?: undefined } | { name: string; error: string }

async function readText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(file)
  })
}

/** Reads one dropped file. Never throws: a file that cannot be used comes back with a message that names it. */
export async function readStatement(file: File): Promise<StagedFile> {
  const name = file.name
  if (!/\.csv$/i.test(name) && file.type !== 'text/csv') return { name, error: `${name} isn't a CSV file.` }
  if (file.size > MAX_FILE_BYTES) return { name, error: `${name} is bigger than 5 MB, which is too big for a bank statement.` }
  try {
    const text = (await readText(file)).replace(/^﻿/, '')
    if (text.includes('\u0000')) return { name, error: `${name} isn't a CSV file.` }
    const rows = parseCsv(text)
    if (rows.length === 0) return { name, error: `${name} is empty.` }
    return { name, rows }
  } catch (e) {
    if (e instanceof CsvParseError) return { name, error: `${name} couldn't be read as a CSV file. ${e.message}.` }
    return { name, error: `${name} couldn't be read.` }
  }
}
