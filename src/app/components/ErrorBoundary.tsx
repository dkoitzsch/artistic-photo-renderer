// Fehlergrenze: Stürzt ein Bereich der Oberfläche ab, bleibt der Rest bedienbar (Meldung + „Erneut versuchen“).

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useAppStore } from '../../state/store';

type Props = { name: string; children: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    useAppStore.getState().notify('error', `${this.props.name}: ${error.message}`);
    console.error(error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="error-boundary" role="alert" data-testid="error-boundary">
        <p>
          {this.props.name} ist auf einen Fehler gestoßen: {error.message}
        </p>
        <button
          className="button small"
          onClick={() => {
            this.setState({ error: null });
          }}
        >
          Erneut versuchen
        </button>
      </div>
    );
  }
}
