import { Component, type ErrorInfo, type ReactNode } from 'react'
import Card from './Card'
import { Button } from './forms'

interface Props {
  children: ReactNode
  /** Opens Settings (backup and restore live there). */
  onGoToSettings: () => void
  /** Called when an error is caught, before the card shows. Used to forget the remembered tab. */
  onError?: () => void
  /** True at the top level, outside the app's page layout: the card brings its own page margin and landmark. */
  standalone?: boolean
}

interface State {
  error: Error | null
}

/**
 * Catches a render error below it and shows a friendly card instead of a blank page. "Try again" renders the
 * children afresh; "Go to Settings" keeps backup and restore reachable. Remount it (change its `key`) to reset it.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(_error: Error, _info: ErrorInfo): void {
    this.props.onError?.()
  }

  private reset = () => this.setState({ error: null })

  private settings = () => {
    this.props.onGoToSettings()
    this.reset()
  }

  render() {
    if (!this.state.error) return this.props.children
    const Wrap = this.props.standalone ? 'main' : 'div'
    return (
      <Wrap className={this.props.standalone ? 'crash crash-standalone' : 'crash'}>
        <Card className="crash-card" labelledBy="crash-heading">
          <h2 className="crash-title" id="crash-heading">Something went wrong</h2>
          <p className="crash-body">
            This page hit a problem and could not be shown. Your data is still saved on this device. Try again, or go to
            Settings to make a backup.
          </p>
          <div className="crash-actions">
            <Button variant="primary" onClick={this.reset}>Try again</Button>
            <Button variant="secondary" onClick={this.settings}>Go to Settings</Button>
          </div>
        </Card>
      </Wrap>
    )
  }
}
