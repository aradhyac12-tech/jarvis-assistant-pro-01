import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Bot, Loader2, CheckCircle, Key } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useDeviceSession } from "@/hooks/useDeviceSession";

export default function Pair() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { session, isLoading: sessionLoading, pairDevice, error } = useDeviceSession();
  const [isConnecting, setIsConnecting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [accessCode, setAccessCode] = useState("");

  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  useEffect(() => {
    if (!sessionLoading && session) {
      navigate("/dashboard", { replace: true });
    }
  }, [session, sessionLoading, navigate]);

  const handleConnect = async () => {
    if (!accessCode.trim()) {
      toast({
        title: "Enter Access Code",
        description: "Please enter the access code from your PC agent.",
        variant: "destructive",
      });
      return;
    }

    setIsConnecting(true);
    const res = await pairDevice(accessCode.trim());
    if (res.success) {
      setSuccess(true);
      toast({ title: "Connected", description: "PC connected successfully." });
      setTimeout(() => navigate("/dashboard", { replace: true }), 600);
    } else {
      toast({
        title: "Connection Failed",
        description: res.error || "Invalid access code. Check and try again.",
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
                : "Enter the access code displayed by your PC agent to connect."}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="relative">
              <Key className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Enter access code (e.g., ABCD1234)"
                value={accessCode}
                onChange={(e) => setAccessCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === "Enter" && handleConnect()}
                className="pl-10 text-center text-lg tracking-wider font-mono uppercase"
                maxLength={12}
                disabled={isConnecting || success}
              />
            </div>
            <p className="text-xs text-muted-foreground text-center">
              Run the PC agent and enter the displayed code
            </p>
          </div>
          <Button 
            className="w-full" 
            onClick={handleConnect} 
            disabled={isConnecting || success || !accessCode.trim()}
          >
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
