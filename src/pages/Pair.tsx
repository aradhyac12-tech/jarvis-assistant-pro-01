import { useState, useEffect, forwardRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Bot, Loader2, CheckCircle, WifiOff, RefreshCw, Wifi } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useDeviceSession } from "@/hooks/useDeviceSession";

const Pair = forwardRef<HTMLDivElement>(function Pair(_, ref) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { session, isLoading: sessionLoading, autoPair } = useDeviceSession();
  const [isConnecting, setIsConnecting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  useEffect(() => {
    if (!sessionLoading && session) {
      navigate("/hub", { replace: true });
    }
  }, [session, sessionLoading, navigate]);

  const tryConnect = useCallback(async () => {
    setIsConnecting(true);
    setFailed(false);
    setAttempt((a) => a + 1);

    const res = await autoPair();
    if (res.success) {
      setSuccess(true);
      toast({ title: "Connected", description: "PC connected automatically." });
      setTimeout(() => navigate("/hub", { replace: true }), 400);
    } else {
      setFailed(true);
    }
    setIsConnecting(false);
  }, [autoPair, navigate, toast]);

  // Auto-connect on mount — single attempt only
  useEffect(() => {
    if (!sessionLoading && !session && !isConnecting && attempt === 0) {
      tryConnect();
    }
  }, [sessionLoading, session, isConnecting, attempt, tryConnect]);

  if (sessionLoading) {
    return (
      <div ref={ref} className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div ref={ref} className="min-h-screen flex items-center justify-center bg-background p-4 relative overflow-hidden">
      {/* Ambient background glow */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full bg-primary/5 blur-[120px]" />
        <div className="absolute bottom-0 left-0 w-[300px] h-[300px] rounded-full bg-primary/3 blur-[80px]" />
      </div>

      <Card className="w-full max-w-md border-border/30 bg-card/80 backdrop-blur-xl shadow-2xl shadow-primary/5 relative z-10">
        <CardHeader className="text-center space-y-4 pb-2">
          <div className="mx-auto w-20 h-20 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 flex items-center justify-center transition-all duration-500">
            {success ? (
              <CheckCircle className="w-10 h-10 text-primary animate-fade-in" />
            ) : failed ? (
              <WifiOff className="w-10 h-10 text-muted-foreground" />
            ) : (
              <div className="relative">
                <Bot className="w-10 h-10 text-primary" />
                <div className="absolute -bottom-1 -right-1 w-3 h-3 rounded-full bg-primary animate-pulse" />
              </div>
            )}
          </div>
          <div className="space-y-1">
            <CardTitle className="text-3xl font-bold tracking-tight">JARVIS</CardTitle>
            <CardDescription className="text-sm">
              {success
                ? "Connected successfully!"
                : failed
                ? "No PC agent found. Make sure the agent is running."
                : "Searching for your PC agent..."}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-2">
          {/* Scanning animation */}
          {!failed && !success && (
            <div className="flex flex-col items-center gap-3 py-4">
              <div className="relative w-16 h-16">
                <div className="absolute inset-0 rounded-full border-2 border-primary/20 animate-ping" />
                <div className="absolute inset-2 rounded-full border-2 border-primary/30 animate-ping" style={{ animationDelay: "0.3s" }} />
                <div className="absolute inset-4 rounded-full border-2 border-primary/40 animate-ping" style={{ animationDelay: "0.6s" }} />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Wifi className="w-5 h-5 text-primary" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground animate-pulse">Scanning network...</p>
            </div>
          )}

          {failed && (
            <div className="space-y-4">
              <Button
                className="w-full h-11 font-medium"
                onClick={tryConnect}
                disabled={isConnecting}
              >
                {isConnecting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    Searching...
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Retry Connection
                  </>
                )}
              </Button>
              <div className="rounded-xl bg-secondary/30 border border-border/20 p-4 space-y-2">
                <p className="text-xs text-muted-foreground font-medium">Run the PC agent first:</p>
                <code className="block p-2.5 bg-background/50 rounded-lg text-[11px] font-mono text-foreground/80 border border-border/10">
                  pythonw jarvis_agent.pyw
                </code>
              </div>
            </div>
          )}

          {success && (
            <div className="flex items-center justify-center gap-2 py-4">
              <div className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: "0ms" }} />
              <div className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: "100ms" }} />
              <div className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: "200ms" }} />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
});

export default Pair;
