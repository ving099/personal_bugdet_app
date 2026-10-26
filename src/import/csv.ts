import Papa from 'papaparse'

export class CsvParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CsvParseError'
  }
}

/** Tokenise CSV text into rows of cells. Strips a BOM and drops blank lines. Throws CsvParseError on malformed quotes or an undetectable delimiter; ragged rows are tolerated. */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, '')
  const { data, errors } = Papa.parse<string[]>(clean, { skipEmptyLines: 'greedy' })
  const fatal = errors.find(e => e.type === 'Quotes' || e.type === 'Delimiter')
  if (fatal) {
    const where = fatal.row === undefined ? '' : ` (row ${fatal.row + 1})`
    throw new CsvParseError(`${fatal.message}${where}`)
  }
  return data
}
