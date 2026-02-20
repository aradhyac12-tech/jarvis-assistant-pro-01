import { useState, useEffect, forwardRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Bot, Loader2, CheckCircle, WifiOff, RefreshCw } from "lucide-react";
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

  // Auto-connect on mount
  useEffect(() => {
    if (!sessionLoading && !session && !isConnecting && attempt === 0) {
      tryConnect();
    }
  }, [sessionLoading, session, isConnecting, attempt, tryConnect]);

  // Retry every 5 seconds if failed
  useEffect(() => {
    if (!failed || isConnecting || success) return;
    const timer = setTimeout(() => tryConnect(), 5000);
    return () => clearTimeout(timer);
  }, [failed, isConnecting, success, tryConnect]);

  if (sessionLoading) {
    return (
      <div ref={ref} className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div ref={ref} className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md border-border/50">
        <CardHeader className="text-center space-y-3">
          <div className="mx-auto w-20 h-20 rounded-2xl bg-primary/10 flex items-center justify-center">
            {success ? (
              <CheckCircle className="w-12 h-12 text-primary" />
            ) : failed ? (
              <WifiOff className="w-12 h-12 text-muted-foreground" />
            ) : (
              <Loader2 className="w-12 h-12 text-primary animate-spin" />
            )}
          </div>
          <div>
            <CardTitle className="text-3xl font-bold">JARVIS</CardTitle>
            <CardDescription>
              {success
                ? "Connected!"
                : failed
                ? "No PC agent found. Make sure the agent is running."
                : "Searching for your PC agent..."}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {failed && (
            <>
              <Button
                className="w-full"
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
              <div className="text-center space-y-2">
                <p className="text-xs text-muted-foreground">
                  Run the PC agent first:
                </p>
                <code className="block p-2 bg-secondary/50 rounded-md text-[10px] font-mono">
                  pythonw jarvis_agent.pyw
                </code>
                <p className="text-xs text-muted-foreground animate-pulse">
                  Auto-retrying every 5 seconds...
                </p>
              </div>
            </>
          )}

          {!failed && !success && (
            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="w-3 h-3 animate-spin" />
              <span>Looking for PC agent on your network...</span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
});

export default Pair;
