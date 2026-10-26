import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(__dirname, '../../src')
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : []
  })

describe('the spreadsheet library loads only when exporting (review M7)', () => {
  it('only src/export/workbook.ts imports exceljs', () => {
    const users = files(SRC).filter((f) => /from 'exceljs'|import\('exceljs'\)/.test(readFileSync(f, 'utf8')))
    expect(users.map((f) => f.slice(SRC.length + 1))).toEqual(['export/workbook.ts'])
  })

  it('nothing imports the workbook module statically except as a type', () => {
    const statics = files(SRC).filter((f) =>
      /^import (?!type )[^;\n]*from '[./]*export\/workbook'/m.test(readFileSync(f, 'utf8')),
    )
    expect(statics).toEqual([])
  })
})
