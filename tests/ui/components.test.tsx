import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import Card from '../../src/ui/components/Card'
import EmptyState from '../../src/ui/components/EmptyState'
import Money from '../../src/ui/components/Money'
import SplitBar from '../../src/ui/components/SplitBar'

describe('Money', () => {
  it('formats negative pence with a leading minus', () => {
    render(<Money pence={-500} />)
    expect(screen.getByText('-£5.00')).toBeInTheDocument()
  })
  it('formats thousands', () => {
    render(<Money pence={123456} />)
    expect(screen.getByText('£1,234.56')).toBeInTheDocument()
  })
  it('does not colour by default', () => {
    const { container } = render(<Money pence={-500} />)
    expect(container.firstElementChild).not.toHaveAttribute('data-sign')
  })
  it('marks money out with text as well as colour under tone=auto', () => {
    const { container } = render(<Money pence={-500} tone="auto" />)
    expect(container.firstElementChild).toHaveAttribute('data-sign', 'out')
    expect(container).toHaveTextContent('Money out')
    expect(container).toHaveTextContent('-£5.00')
  })
  it('marks money in under tone=auto with a plus sign', () => {
    const { container } = render(<Money pence={500} tone="auto" />)
    expect(container.firstElementChild).toHaveAttribute('data-sign', 'in')
    expect(container).toHaveTextContent('Money in')
    expect(container).toHaveTextContent('+£5.00')
  })
  it('leaves zero neutral under tone=auto', () => {
    const { container } = render(<Money pence={0} tone="auto" />)
    expect(container.firstElementChild).toHaveAttribute('data-sign', 'zero')
    expect(container).toHaveTextContent('£0.00')
    expect(container).not.toHaveTextContent('Money')
  })
  it('supports the hero size', () => {
    const { container } = render(<Money pence={100} size="hero" />)
    expect(container.firstElementChild).toHaveClass('money-hero')
  })
})

describe('SplitBar', () => {
  it('describes the split', () => {
    render(<SplitBar growthPct={70} aggressivePct={30} />)
    expect(screen.getByRole('img', { name: 'Growth 70%, aggressive 30%' })).toBeInTheDocument()
    expect(screen.getByText('70% growth')).toBeInTheDocument()
    expect(screen.getByText('30% aggressive')).toBeInTheDocument()
  })
  it('handles 0/0', () => {
    render(<SplitBar growthPct={0} aggressivePct={0} />)
    expect(screen.getByRole('img', { name: 'Growth 0%, aggressive 0%' })).toBeInTheDocument()
  })
  it('clamps out-of-range and non-finite values', () => {
    render(<SplitBar growthPct={150} aggressivePct={Number.NaN} />)
    expect(screen.getByRole('img', { name: 'Growth 100%, aggressive 0%' })).toBeInTheDocument()
  })
  it('scales down when the two parts exceed 100', () => {
    const { container } = render(<SplitBar growthPct={80} aggressivePct={80} />)
    const growth = container.querySelector<HTMLElement>('.splitbar-growth')!
    expect(growth.style.width).toBe('50%')
  })
  it('shows the target tick and mentions it', () => {
    const { container } = render(<SplitBar growthPct={65} aggressivePct={35} targetGrowthPct={70} />)
    expect(screen.getByRole('img')).toHaveAccessibleName('Growth 65%, aggressive 35%, target growth 70%')
    expect(container.querySelector<HTMLElement>('.splitbar-target')!.style.left).toBe('70%')
  })
})

describe('Card and EmptyState', () => {
  it('renders children in a raised panel', () => {
    const { container } = render(<Card>Hello</Card>)
    expect(container.firstElementChild).toHaveClass('card')
    expect(screen.getByText('Hello')).toBeInTheDocument()
  })
  it('renders title, body and action', () => {
    render(<EmptyState title="Nothing yet" body="Add something." action={<button>Add</button>} />)
    expect(screen.getByText('Nothing yet')).toBeInTheDocument()
    expect(screen.getByText('Add something.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument()
  })
})
