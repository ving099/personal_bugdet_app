interface SplitBarProps {
  growthPct: number
  aggressivePct: number
  /** Where the growth/aggressive boundary should be; drawn as a small tick. */
  targetGrowthPct?: number
}

const clamp = (n: number) => (Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0)
const show = (n: number) => String(Number(n.toFixed(1)))

export default function SplitBar({ growthPct, aggressivePct, targetGrowthPct }: SplitBarProps) {
  const g = clamp(growthPct)
  const a = clamp(aggressivePct)
  const scale = g + a > 100 ? 100 / (g + a) : 1
  const hasTarget = targetGrowthPct !== undefined && Number.isFinite(targetGrowthPct)
  const target = hasTarget ? clamp(targetGrowthPct) : 0
  const label =
    `Growth ${show(g)}%, aggressive ${show(a)}%` + (hasTarget ? `, target growth ${show(target)}%` : '')
  return (
    <div className="splitbar">
      <div className="splitbar-track" role="img" aria-label={label}>
        <div className="splitbar-growth" style={{ width: `${g * scale}%` }} />
        <div className="splitbar-aggressive" style={{ width: `${a * scale}%` }} />
        {hasTarget && <div className="splitbar-target" style={{ left: `${target}%` }} />}
      </div>
      <div className="splitbar-legend" aria-hidden="true">
        <span>{show(g)}% growth</span>
        <span>{show(a)}% aggressive</span>
      </div>
    </div>
  )
}
