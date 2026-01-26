import React, { Component, ReactNode } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  isRetrying: boolean;
}

export class LazyLoadErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, isRetrying: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true, isRetrying: false };
  }

  componentDidCatch(error: Error) {
    // Check if it's a dynamic import error (stale chunk)
    if (
      error.message.includes("Failed to fetch dynamically imported module") ||
      error.message.includes("Loading chunk") ||
      error.message.includes("Loading CSS chunk")
    ) {
      console.log("Detected stale chunk, will reload...");
      // Auto-reload after a brief delay
      setTimeout(() => {
        window.location.reload();
      }, 100);
    }
  }

  handleRetry = () => {
    this.setState({ isRetrying: true });
    // Force a hard reload to get fresh chunks
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-background p-4 gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-muted-foreground text-center">
            Loading fresh assets...
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={this.handleRetry}
            disabled={this.state.isRetrying}
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Reload Now
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}
