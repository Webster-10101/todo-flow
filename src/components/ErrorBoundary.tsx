"use client";

import { Component, type ReactNode } from "react";

type Props = {
  children: ReactNode;
};

type State = {
  hasError: boolean;
  error: Error | null;
};

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: { componentStack: string }) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="min-h-screen px-8 py-10 bg-paper">
          <div className="mx-auto w-full max-w-[980px]">
            <div className="rounded-xl border border-line bg-white/70 p-8 shadow-soft">
              <h1 className="text-2xl text-ink mb-4">Something went wrong</h1>
              <p className="text-sm text-muted mb-6">
                The app encountered an unexpected error. Try refreshing the page.
              </p>
              
              {this.state.error && (
                <details className="mb-6">
                  <summary className="cursor-pointer text-sm text-ink mb-2">
                    Error details
                  </summary>
                  <pre className="text-xs text-muted bg-soft p-4 rounded-lg overflow-auto">
                    {this.state.error.toString()}
                    {this.state.error.stack}
                  </pre>
                </details>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => window.location.reload()}
                  className="rounded-lg border border-line bg-ink px-4 py-2 text-sm text-paper hover:bg-black transition-colors"
                >
                  Refresh page
                </button>
                <button
                  onClick={() => {
                    if (confirm("This will clear all your data. Are you sure?")) {
                      localStorage.clear();
                      window.location.reload();
                    }
                  }}
                  className="rounded-lg border border-line bg-white px-4 py-2 text-sm text-ink hover:bg-soft transition-colors"
                >
                  Clear data & restart
                </button>
              </div>
            </div>
          </div>
        </main>
      );
    }

    return this.props.children;
  }
}

