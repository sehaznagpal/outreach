import { Component, type ReactNode } from 'react';

/** Keeps one broken page from blanking the whole app. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="empty">
        <p>This page hit a problem: {this.state.error.message}</p>
        <button className="btn" onClick={() => location.reload()}>Reload</button>
      </div>
    );
  }
}
