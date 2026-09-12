import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ConsoleErrorBoundaryProps {
  resetKey: string;
  children: React.ReactNode;
}

interface ConsoleErrorBoundaryState {
  error: Error | null;
}

export class ConsoleErrorBoundary extends React.Component<ConsoleErrorBoundaryProps, ConsoleErrorBoundaryState> {
  state: ConsoleErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ConsoleErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ORCA console module crashed:', error, info.componentStack);
  }

  componentDidUpdate(prevProps: ConsoleErrorBoundaryProps) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div role="alert" className="flex flex-col items-center gap-4 rounded-xl border border-rose-200 bg-rose-50/80 px-6 py-12 text-center shadow-xs">
        <AlertTriangle className="h-7 w-7 text-rose-600" />
        <div className="space-y-1">
          <p className="text-sm font-semibold text-rose-900">This module failed to render the latest analysis.</p>
          <p className="font-mono text-[11px] text-slate-500">{this.state.error.message}</p>
        </div>
        <button
          onClick={() => this.setState({ error: null })}
          className="inline-flex items-center gap-2 rounded-lg border border-sky-300 bg-white px-4 py-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-sky-700 shadow-2xs transition-colors hover:bg-sky-50 hover:border-sky-400"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Try again
        </button>
      </div>
    );
  }
}
