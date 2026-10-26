import Papa from 'papaparse'

/** Tokenise CSV text into rows of cells. Strips a BOM and drops blank lines. */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, '')
  const { data } = Papa.parse<string[]>(clean, { skipEmptyLines: 'greedy' })
  return data
}
