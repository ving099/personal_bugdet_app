import { describe, expect, it } from 'vitest'
import { allocateWrappers } from '../../src/invest/wrappers'
import { seedSettings } from '../../src/seed/settings'
import type { AllowanceUsed, Wrapper } from '../../src/domain/types'

const settings = {
  wrapperOrder: seedSettings.wrapperOrder,
  wrapperShares: seedSettings.wrapperShares,
  allowances: seedSettings.allowances,
}
const TODAY = '2026-10-26' // 6 months left (Oct..Mar)

const run = (
  investablePence: number,
  opts: { today?: string; used?: AllowanceUsed[]; lisaEnabled?: boolean; s?: typeof settings } = {},
) =>
  allocateWrappers({
    investablePence,
    today: opts.today ?? TODAY,
    settings: opts.s ?? settings,
    used: opts.used ?? [],
    lisaEnabled: opts.lisaEnabled ?? false,
  })
const get = (r: ReturnType<typeof run>, w: Wrapper) => r.find((x) => x.wrapper === w)?.pence
const sum = (r: ReturnType<typeof run>) => r.reduce((a, x) => a + x.pence, 0)
const used = (taxYear: string, wrapper: Wrapper, usedPence: number): AllowanceUsed => ({
  taxYear,
  wrapper,
  usedPence,
})

describe('allocateWrappers', () => {
  it('splits £1,000 into pension £250, ISA £750, GIA £0 with six months left', () => {
    const r = run(100000)
    expect(r.map((x) => x.wrapper)).toEqual(['pension', 'isa', 'gia'])
    expect(get(r, 'pension')).toBe(25000)
    expect(get(r, 'isa')).toBe(75000)
    expect(get(r, 'gia')).toBe(0)
  })

  it('caps ISA at the remaining room spread over months left, rest to GIA', () => {
    const r = run(100000, { used: [used('2026/27', 'isa', 1950000)] })
    expect(get(r, 'isa')).toBe(8333)
    expect(get(r, 'gia')).toBe(75000 - 8333)
    expect(r.find((x) => x.wrapper === 'isa')?.note).toMatch(/6 months/)
    expect(sum(r)).toBe(100000)
  })

  it('ignores used rows from other tax years', () => {
    const r = run(100000, { used: [used('2025/26', 'isa', 2000000), used('2025/26', 'pension', 6000000)] })
    expect(get(r, 'pension')).toBe(25000)
    expect(get(r, 'isa')).toBe(75000)
  })

  it('resets to the full £20,000 on 6 April', () => {
    const r = run(5000000, { today: '2026-04-06', used: [used('2025/26', 'isa', 2000000)] })
    expect(get(r, 'pension')).toBe(1250000)
    // floor(2,000,000 / 12) = 166666
    expect(get(r, 'isa')).toBe(166666)
  })

  it('notes when ISA room is used up', () => {
    const r = run(100000, { used: [used('2026/27', 'isa', 2000000)] })
    expect(get(r, 'isa')).toBe(0)
    expect(get(r, 'gia')).toBe(75000)
    expect(r.find((x) => x.wrapper === 'isa')?.note).toMatch(/used up/)
  })

  describe('LISA', () => {
    it('is omitted unless enabled', () => {
      expect(run(100000).some((x) => x.wrapper === 'lisa')).toBe(false)
    })

    it('is carved from inside the ISA slot and capped by remainingLisa / monthsLeft', () => {
      const r = run(100000, { lisaEnabled: true })
      expect(r.map((x) => x.wrapper)).toEqual(['pension', 'isa', 'lisa', 'gia'])
      // 400000/6 = 66666
      expect(get(r, 'lisa')).toBe(66666)
      expect(get(r, 'isa')).toBe(75000 - 66666)
      expect(get(r, 'gia')).toBe(0)
      expect(sum(r)).toBe(100000)
    })

    it('never exceeds £4,000 a year in total', () => {
      const r = run(100000, { lisaEnabled: true, used: [used('2026/27', 'lisa', 390000)] })
      expect(get(r, 'lisa')).toBe(Math.floor(10000 / 6))
      const none = run(100000, { lisaEnabled: true, used: [used('2026/27', 'lisa', 400000)] })
      expect(get(none, 'lisa')).toBe(0)
      // big month on the last month of the year: 1 month left
      const last = run(2000000, { today: '2027-03-20', lisaEnabled: true })
      expect(get(last, 'lisa')).toBe(400000)
    })

    it('counts against the ISA room', () => {
      const r = run(100000, {
        lisaEnabled: true,
        used: [used('2026/27', 'lisa', 400000), used('2026/27', 'isa', 1550000)],
      })
      // room = 20,000 - 4,000 - 15,500 = 500,000 pence... = £500 -> 83 /month
      expect(get(r, 'lisa')).toBe(0)
      expect(get(r, 'isa')).toBe(Math.floor(50000 / 6))
      const plain = run(100000, { used: [used('2026/27', 'lisa', 1950000)] })
      expect(get(plain, 'isa')).toBe(Math.floor(50000 / 6))
    })

    it('honours an explicit LISA share when defined', () => {
      const r = run(100000, {
        lisaEnabled: true,
        s: { ...settings, wrapperShares: { pension: 25, lisa: 10 } },
      })
      expect(get(r, 'lisa')).toBe(10000)
      expect(get(r, 'isa')).toBe(65000)
    })
  })

  it('caps pension by its remaining allowance', () => {
    const r = run(100000, { used: [used('2026/27', 'pension', 5990000)] })
    expect(get(r, 'pension')).toBe(10000)
    expect(sum(r)).toBe(100000)
    const none = run(100000, { used: [used('2026/27', 'pension', 6000000)] })
    expect(get(none, 'pension')).toBe(0)
    expect(none.find((x) => x.wrapper === 'pension')?.note).toBeTruthy()
  })

  it('always sums exactly to investable, including awkward amounts', () => {
    for (const amt of [1, 7, 99999, 100001, 123457, 333333, 9999999]) {
      for (const lisa of [false, true]) {
        const r = run(amt, { lisaEnabled: lisa })
        expect(sum(r)).toBe(amt)
        expect(r.every((x) => Number.isInteger(x.pence) && x.pence >= 0)).toBe(true)
      }
    }
    const odd = run(100001)
    expect(get(odd, 'pension')).toBe(25000)
    expect(get(odd, 'isa')).toBe(75001)
  })

  it('falls back to the latest configured year when the current one is missing', () => {
    const note = 'Allowances for 2027/28 not set; using 2026/27 limits \u2014 check Settings'
    const r = run(100000, { today: '2027-10-26', lisaEnabled: true })
    expect(get(r, 'pension')).toBe(25000)
    expect(get(r, 'lisa')).toBe(66666)
    expect(get(r, 'isa')).toBe(75000 - 66666)
    expect(get(r, 'gia')).toBe(0)
    for (const w of ['pension', 'isa'] as const) {
      expect(r.find((x) => x.wrapper === w)?.note).toBe(note)
    }
    // LISA is genuinely capped to 6 months of its allowance, so that true note follows.
    expect(r.find((x) => x.wrapper === 'lisa')?.note).toBe(
      `${note}; Capped to spread remaining LISA allowance over 6 months`,
    )
    expect(r.find((x) => x.wrapper === 'gia')?.note).toBeUndefined()
  })

  it('picks the most recent earlier year, ignoring later ones', () => {
    const s = {
      ...settings,
      allowances: {
        '2025/26': { isa: 600000, lisa: 400000, pension: 6000000 },
        '2026/27': { isa: 1200000, lisa: 400000, pension: 6000000 },
        '2029/30': { isa: 0, lisa: 0, pension: 0 },
      },
    }
    const r = run(100000, { today: '2027-10-26', s })
    expect(get(r, 'isa')).toBe(75000) // 1,200,000 / 6 = 200000 room, not binding
    expect(get(run(1000000, { today: '2027-10-26', s }), 'isa')).toBe(200000 - 0)
  })

  it('treats no earlier configured year as zero room with a distinct note', () => {
    const r = run(100000, { today: '2025-10-01' })
    expect(get(r, 'pension')).toBe(0)
    expect(get(r, 'isa')).toBe(0)
    expect(get(r, 'gia')).toBe(100000)
    const note = 'No allowances configured for 2025/26 \u2014 check Settings'
    expect(r.find((x) => x.wrapper === 'pension')?.note).toBe(note)
    expect(r.find((x) => x.wrapper === 'isa')?.note).toBe(note)
  })

  it('honours an explicit zero allowance in a configured year', () => {
    const s = {
      ...settings,
      allowances: { '2026/27': { isa: 0, lisa: 400000, pension: 6000000 } },
    }
    const r = run(100000, { s })
    expect(get(r, 'isa')).toBe(0)
    expect(get(r, 'gia')).toBe(75000)
    expect(r.find((x) => x.wrapper === 'isa')?.note).toBe('No ISA allowance for 2026/27')
  })

  it('rejects out-of-range shares', () => {
    for (const wrapperShares of [{ pension: 150 }, { pension: -1 }, { pension: NaN }, { pension: 25, lisa: 101 }]) {
      expect(() => run(100000, { s: { ...settings, wrapperShares } })).toThrow(RangeError)
    }
  })

  it('says used up only when a LISA allowance is genuinely exhausted', () => {
    const r = run(100000, { lisaEnabled: true, used: [used('2026/27', 'lisa', 400000)] })
    expect(r.find((x) => x.wrapper === 'lisa')?.note).toBe('LISA allowance used up for 2026/27')
  })

  it('reports an explicit zero LISA allowance without saying used up', () => {
    const z = (y: string) => ({ [y]: { isa: 2000000, lisa: 0, pension: 6000000 } })
    const r = run(100000, { lisaEnabled: true, s: { ...settings, allowances: z('2026/27') } })
    expect(get(r, 'lisa')).toBe(0)
    expect(r.find((x) => x.wrapper === 'lisa')?.note).toBe('No LISA allowance for 2026/27')
    const f = run(100000, {
      today: '2027-10-26',
      lisaEnabled: true,
      s: { ...settings, allowances: z('2026/27') },
    })
    expect(f.find((x) => x.wrapper === 'lisa')?.note).toBe(
      'Allowances for 2027/28 not set; using 2026/27 limits \u2014 check Settings; No LISA allowance for 2026/27',
    )
  })

  it('reports zero or missing pension allowance in a configured year', () => {
    for (const year of [
      { isa: 2000000, lisa: 400000, pension: 0 },
      { isa: 2000000, lisa: 400000 },
    ]) {
      const r = run(100000, { s: { ...settings, allowances: { '2026/27': year } } })
      expect(get(r, 'pension')).toBe(0)
      expect(r.find((x) => x.wrapper === 'pension')?.note).toBe('No pension allowance for 2026/27')
    }
  })

  it('says pension used up only when the allowance is exhausted', () => {
    const r = run(100000, { used: [used('2026/27', 'pension', 6000000)] })
    expect(r.find((x) => x.wrapper === 'pension')?.note).toBe('Pension allowance used up for 2026/27')
  })

  it('returns all-zero entries for zero or negative investable', () => {
    for (const amt of [0, -5000]) {
      const r = run(amt, { lisaEnabled: true })
      expect(r.map((x) => x.wrapper)).toEqual(['pension', 'isa', 'lisa', 'gia'])
      expect(r.every((x) => x.pence === 0)).toBe(true)
    }
  })

  it('throws RangeError on invalid input', () => {
    expect(() => run(NaN)).toThrow(RangeError)
    expect(() => run(Infinity)).toThrow(RangeError)
    expect(() => run(100.5)).toThrow(RangeError)
    expect(() => run(100000, { used: [used('2026/27', 'isa', -1)] })).toThrow(RangeError)
  })
})
