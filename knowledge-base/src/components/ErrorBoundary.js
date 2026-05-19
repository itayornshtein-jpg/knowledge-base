import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
    this.handleReload = this.handleReload.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('Caught render error:', error, info?.componentStack);
    // Drop-in hook for Sentry/Datadog/etc.
    if (typeof window !== 'undefined' && typeof window.reportError === 'function') {
      try {
        window.reportError(error);
      } catch (_) {
        /* swallow */
      }
    }
  }

  handleReload() {
    this.setState({ error: null });
    if (typeof window !== 'undefined') window.location.reload();
  }

  render() {
    if (this.state.error) {
      return (
        <div className="error-boundary-shell">
          <div className="error-boundary-card card">
            <p className="eyebrow">Something went wrong</p>
            <h2>The app hit an unexpected error</h2>
            <p className="helper-text">
              Reloading usually clears it. If it keeps happening, copy the message below and share
              it with engineering.
            </p>
            <pre className="error-boundary-message">
              {String(this.state.error?.message || this.state.error)}
            </pre>
            <button type="button" className="btn-primary" onClick={this.handleReload}>
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
