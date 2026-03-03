import { Component, type ReactNode } from 'react';

interface Props { children: ReactNode; }
interface State { error: Error | null; }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, color: '#ff4d6a', background: '#0a0a0f', fontFamily: 'monospace', fontSize: 13 }}>
          <div style={{ marginBottom: 8, fontWeight: 'bold' }}>Runtime Error:</div>
          <pre style={{ whiteSpace: 'pre-wrap', color: '#e2e8f0' }}>{this.state.error.message}</pre>
          <pre style={{ whiteSpace: 'pre-wrap', color: '#6b7280', fontSize: 11, marginTop: 8 }}>{this.state.error.stack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}
