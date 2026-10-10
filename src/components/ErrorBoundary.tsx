import { Component, type ReactNode } from 'react';

/** A rendering bug in one panel must not blank the whole dashboard. */
export class ErrorBoundary extends Component<{ name: string; children: ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  componentDidCatch(err: Error) { console.error(`[${this.props.name}] render failed`, err); }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div className="panel empty" role="alert">
        <b>{this.props.name} failed to render.</b> The other panels are unaffected. <span className="muted small">{this.state.err.message}</span>{' '}
        <button onClick={() => this.setState({ err: null })}>Retry</button>
      </div>
    );
  }
}
