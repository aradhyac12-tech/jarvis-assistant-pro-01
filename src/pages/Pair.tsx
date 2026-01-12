import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Bot, Loader2, CheckCircle, Smartphone, Monitor, ArrowRight } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useDeviceSession } from "@/hooks/useDeviceSession";

export default function Pair() {
  const [pairingCode, setPairingCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { session, isLoading: sessionLoading, pairDevice } = useDeviceSession();

  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  // Redirect if already paired
  useEffect(() => {
    if (!sessionLoading && session) {
      navigate("/dashboard", { replace: true });
    }
  }, [session, sessionLoading, navigate]);

  const handlePair = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pairingCode.trim()) {
      toast({ title: "Missing Code", description: "Please enter the pairing code from your PC", variant: "destructive" });
      return;
    }

    setIsLoading(true);
    const result = await pairDevice(pairingCode);
    
    if (result.success) {
      setSuccess(true);
      toast({ title: "Device Paired!", description: "Your PC is now connected to JARVIS" });
      setTimeout(() => navigate("/dashboard", { replace: true }), 1000);
    } else {
      toast({ title: "Pairing Failed", description: result.error, variant: "destructive" });
      setIsLoading(false);
    }
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
      {/* Background effects */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-accent/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: "1s" }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-neon-blue/5 rounded-full blur-3xl" />
      </div>

      <Card className="w-full max-w-md relative glass-dark border-border/50 animate-fade-in shadow-2xl">
        <CardHeader className="text-center space-y-4">
          <div className={`mx-auto w-20 h-20 rounded-2xl gradient-primary flex items-center justify-center transition-all duration-300 ${success ? 'scale-110' : 'pulse-neon'}`}>
            {success ? (
              <CheckCircle className="w-12 h-12 text-primary-foreground animate-scale-in" />
            ) : (
              <Bot className="w-12 h-12 text-primary-foreground" />
            )}
          </div>
          <div>
            <CardTitle className="text-4xl font-bold neon-text tracking-wider">JARVIS</CardTitle>
            <CardDescription className="text-muted-foreground mt-2">
              {success ? "Device paired successfully!" : "Connect to your PC"}
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="pb-8 space-y-6">
          {/* Instructions */}
          <div className="space-y-4 p-4 rounded-xl bg-secondary/30 border border-border/50">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-neon-blue/20 flex items-center justify-center shrink-0">
                <span className="text-neon-blue font-bold text-sm">1</span>
              </div>
              <div>
                <p className="font-medium text-sm">Run the agent on your PC</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  <code className="bg-secondary px-1.5 py-0.5 rounded">python jarvis_agent.py</code>
                </p>
              </div>
            </div>
            
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-neon-purple/20 flex items-center justify-center shrink-0">
                <span className="text-neon-purple font-bold text-sm">2</span>
              </div>
              <div>
                <p className="font-medium text-sm">Find the pairing code</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Look for the 6-character code shown in the terminal
                </p>
              </div>
            </div>
            
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-neon-green/20 flex items-center justify-center shrink-0">
                <span className="text-neon-green font-bold text-sm">3</span>
              </div>
              <div>
                <p className="font-medium text-sm">Enter the code below</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  You'll be connected instantly
                </p>
              </div>
            </div>
          </div>

          {/* Pairing Form */}
          <form onSubmit={handlePair} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="pairing-code" className="flex items-center gap-2">
                <Smartphone className="w-4 h-4" />
                <ArrowRight className="w-3 h-3 text-muted-foreground" />
                <Monitor className="w-4 h-4" />
                <span className="ml-1">Pairing Code</span>
              </Label>
              <Input
                id="pairing-code"
                type="text"
                placeholder="ABC123"
                value={pairingCode}
                onChange={(e) => setPairingCode(e.target.value.toUpperCase())}
                className="text-center text-2xl font-mono tracking-[0.5em] uppercase"
                maxLength={6}
                disabled={isLoading || success}
                autoComplete="off"
                autoFocus
              />
            </div>

            <Button type="submit" className="w-full gradient-primary" disabled={isLoading || success || pairingCode.length < 4}>
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Connecting...
                </>
              ) : success ? (
                <>
                  <CheckCircle className="w-4 h-4 mr-2" />
                  Connected!
                </>
              ) : (
                "Pair Device"
              )}
            </Button>
          </form>

          <div className="text-center space-y-2">
            <p className="text-xs text-muted-foreground">
              No account needed — your device is your key
            </p>
            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground/70">
              <span className="w-1.5 h-1.5 rounded-full bg-neon-green animate-pulse" />
              Secure local pairing
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
