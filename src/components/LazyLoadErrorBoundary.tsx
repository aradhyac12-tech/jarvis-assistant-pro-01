import React, { Component, ReactNode } from "react";
import { Loader2, RefreshCw, Wifi, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  isRetrying: boolean;
  retryCount: number;
  isOffline: boolean;
}

const MAX_AUTO_RETRIES = 3;
const RETRY_DELAY_MS = 1500;

export class LazyLoadErrorBoundary extends Component<Props, State> {
  private retryTimeoutId: number | null = null;
  
  constructor(props: Props) {
    super(props);
    this.state = { 
      hasError: false, 
      isRetrying: false, 
      retryCount: 0,
      isOffline: typeof navigator !== "undefined" ? !navigator.onLine : false,
    };
  }

  static getDerivedStateFromError(): Partial<State> {
    return { hasError: true, isRetrying: false };
  }

  componentDidMount() {
    window.addEventListener("online", this.handleOnline);
    window.addEventListener("offline", this.handleOffline);
  }

  componentWillUnmount() {
    window.removeEventListener("online", this.handleOnline);
    window.removeEventListener("offline", this.handleOffline);
    if (this.retryTimeoutId) {
      clearTimeout(this.retryTimeoutId);
    }
  }

  handleOnline = () => {
    this.setState({ isOffline: false });
    // Auto-reload when coming back online after error
    if (this.state.hasError) {
      this.handleRetry();
    }
  };

  handleOffline = () => {
    this.setState({ isOffline: true });
  };

  componentDidCatch(error: Error) {
    const isChunkError = 
      error.message.includes("Failed to fetch dynamically imported module") ||
      error.message.includes("Loading chunk") ||
      error.message.includes("Loading CSS chunk") ||
      error.message.includes("Importing a module script failed");
    
    console.log("[LazyLoad] Error caught:", error.message, { isChunkError });
    
    if (isChunkError && this.state.retryCount < MAX_AUTO_RETRIES) {
      // Auto-retry with exponential backoff
      const delay = RETRY_DELAY_MS * Math.pow(1.5, this.state.retryCount);
      console.log(`[LazyLoad] Auto-retry ${this.state.retryCount + 1}/${MAX_AUTO_RETRIES} in ${delay}ms`);
      
      this.setState({ isRetrying: true });
      this.retryTimeoutId = window.setTimeout(() => {
        this.setState(prev => ({ 
          retryCount: prev.retryCount + 1,
          hasError: false,
          isRetrying: false,
        }));
      }, delay);
    } else if (isChunkError && this.state.retryCount >= MAX_AUTO_RETRIES) {
      // After max retries, force hard reload
      console.log("[LazyLoad] Max retries reached, forcing hard reload");
      this.forceHardReload();
    }
  }

  forceHardReload = () => {
    // Clear any cached chunks and force reload
    if ("caches" in window) {
      caches.keys().then((names) => {
        names.forEach((name) => caches.delete(name));
      });
    }
    // Use replace to avoid back-button loop
    window.location.replace(window.location.href);
  };

  handleRetry = () => {
    this.setState({ isRetrying: true });
    // Small delay to show loading state
    this.retryTimeoutId = window.setTimeout(() => {
      this.setState({ 
        hasError: false, 
        isRetrying: false,
        retryCount: 0,
      });
    }, 300);
  };

  handleHardReload = () => {
    this.setState({ isRetrying: true });
    this.forceHardReload();
  };

  render() {
    if (this.state.hasError || this.state.isRetrying) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-background p-4 gap-4">
          {this.state.isOffline ? (
            <WifiOff className="w-8 h-8 text-muted-foreground" />
          ) : (
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          )}
          
          <p className="text-muted-foreground text-center">
            {this.state.isOffline 
              ? "You're offline. Connect to load the app."
              : this.state.isRetrying 
                ? "Loading..." 
                : "Loading fresh assets..."}
          </p>
          
          {this.state.retryCount > 0 && !this.state.isRetrying && (
            <p className="text-xs text-muted-foreground">
              Retry {this.state.retryCount}/{MAX_AUTO_RETRIES}
            </p>
          )}
          
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={this.handleRetry}
              disabled={this.state.isRetrying || this.state.isOffline}
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${this.state.isRetrying ? "animate-spin" : ""}`} />
              Retry
            </Button>
            
            <Button
              variant="default"
              size="sm"
              onClick={this.handleHardReload}
              disabled={this.state.isRetrying}
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Force Reload
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
