import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bot, Loader2, CheckCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useDeviceSession } from "@/hooks/useDeviceSession";

export default function Pair() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { session, isLoading: sessionLoading, autoPair, error } = useDeviceSession();
  const [isConnecting, setIsConnecting] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  useEffect(() => {
    if (!sessionLoading && session) {
      navigate("/dashboard", { replace: true });
    }
  }, [session, sessionLoading, navigate]);

  const handleConnect = async () => {
    setIsConnecting(true);
    const res = await autoPair();
    if (res.success) {
      setSuccess(true);
      toast({ title: "Connected", description: "PC connected successfully." });
      setTimeout(() => navigate("/dashboard", { replace: true }), 600);
    } else {
      toast({
        title: "Not Connected",
        description: res.error || "Start the PC agent first.",
        variant: "destructive",
      });
    }
    setIsConnecting(false);
  };

  if (sessionLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md border-border/50">
        <CardHeader className="text-center space-y-3">
          <div className="mx-auto w-20 h-20 rounded-2xl bg-primary/10 flex items-center justify-center">
            {success ? (
              <CheckCircle className="w-12 h-12 text-primary" />
            ) : isConnecting ? (
              <Loader2 className="w-12 h-12 text-primary animate-spin" />
            ) : (
              <Bot className="w-12 h-12 text-primary" />
            )}
          </div>
          <div>
            <CardTitle className="text-3xl font-bold">JARVIS</CardTitle>
            <CardDescription>
              {success
                ? "Connected!"
                : "Start the PC agent, then press Connect (auto-connect mode)."}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button className="w-full" onClick={handleConnect} disabled={isConnecting || success}>
            {isConnecting ? "Connecting…" : success ? "Connected" : "Connect"}
          </Button>
          {error && !success && (
            <p className="text-sm text-destructive text-center">{error}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
