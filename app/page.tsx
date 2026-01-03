import { App } from "@/src/components/App";
import { ErrorBoundary } from "@/src/components/ErrorBoundary";

export default function Page() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}


