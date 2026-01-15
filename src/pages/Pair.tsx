import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Bot, Loader2, CheckCircle, Smartphone, Monitor, ArrowRight, QrCode, ScanLine } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useDeviceSession } from "@/hooks/useDeviceSession";
import { QRScanner } from "@/components/QRScanner";

export default function Pair() {
  const [searchParams] = useSearchParams();
  const [pairingCode, setPairingCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [autoPairing, setAutoPairing] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
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

  // Auto-pair if code is in URL (from QR scan)
  useEffect(() => {
    const codeFromUrl = searchParams.get("code");
    if (codeFromUrl && !session && !sessionLoading && !autoPairing) {
      setAutoPairing(true);
      setPairingCode(codeFromUrl.toUpperCase());
      handleAutoPair(codeFromUrl);
    }
  }, [searchParams, session, sessionLoading, autoPairing]);

  const handleAutoPair = async (code: string) => {
    setIsLoading(true);
    const result = await pairDevice(code);
    
    if (result.success) {
      setSuccess(true);
      toast({ title: "Device Paired!", description: "Your PC is now connected to JARVIS" });
      setTimeout(() => navigate("/dashboard", { replace: true }), 1000);
    } else {
      toast({ title: "Pairing Failed", description: result.error, variant: "destructive" });
      setIsLoading(false);
      setAutoPairing(false);
    }
  };

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

  const handleScanResult = (code: string) => {
    setShowScanner(false);
    setPairingCode(code);
    // Auto-submit after scan
    handleAutoPair(code);
    setAutoPairing(true);
  };

  if (sessionLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <>
      {showScanner && (
        <QRScanner 
          onScan={handleScanResult}
          onClose={() => setShowScanner(false)}
        />
      )}
      
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
              ) : autoPairing ? (
                <Loader2 className="w-12 h-12 text-primary-foreground animate-spin" />
              ) : (
                <Bot className="w-12 h-12 text-primary-foreground" />
              )}
            </div>
            <div>
              <CardTitle className="text-4xl font-bold neon-text tracking-wider">JARVIS</CardTitle>
              <CardDescription className="text-muted-foreground mt-2">
                {success ? "Device paired successfully!" : autoPairing ? "Connecting to your PC..." : "Connect to your PC"}
              </CardDescription>
            </div>
          </CardHeader>

          <CardContent className="pb-8 space-y-6">
            {/* Scan QR Button - Primary Action */}
            <Button 
              onClick={() => setShowScanner(true)}
              className="w-full h-14 text-lg gradient-primary gap-3"
              disabled={isLoading || success}
            >
              <ScanLine className="w-6 h-6" />
              Scan QR Code
            </Button>

            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs text-muted-foreground">or enter code manually</span>
              <div className="flex-1 h-px bg-border" />
            </div>

            {/* Instructions */}
            <div className="space-y-3 p-4 rounded-xl bg-secondary/30 border border-border/50">
              <div className="flex items-start gap-3">
                <div className="w-7 h-7 rounded-lg bg-neon-blue/20 flex items-center justify-center shrink-0">
                  <span className="text-neon-blue font-bold text-xs">1</span>
                </div>
                <div>
                  <p className="font-medium text-sm">Run on your PC</p>
                  <code className="text-xs bg-secondary px-1.5 py-0.5 rounded text-muted-foreground">python jarvis_agent.py</code>
                </div>
              </div>
              
              <div className="flex items-start gap-3">
                <div className="w-7 h-7 rounded-lg bg-neon-purple/20 flex items-center justify-center shrink-0">
                  <QrCode className="w-3.5 h-3.5 text-neon-purple" />
                </div>
                <div>
                  <p className="font-medium text-sm">Scan the QR or copy the code</p>
                  <p className="text-xs text-muted-foreground">Shown in the terminal window</p>
                </div>
              </div>
            </div>

            {/* Pairing Form */}
            <form onSubmit={handlePair} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="pairing-code" className="flex items-center gap-2 text-sm">
                  <Smartphone className="w-3.5 h-3.5" />
                  <ArrowRight className="w-2.5 h-2.5 text-muted-foreground" />
                  <Monitor className="w-3.5 h-3.5" />
                  <span className="ml-1">Pairing Code</span>
                </Label>
                <Input
                  id="pairing-code"
                  type="text"
                  placeholder="ABC123"
                  value={pairingCode}
                  onChange={(e) => setPairingCode(e.target.value.toUpperCase())}
                  className="text-center text-2xl font-mono tracking-[0.5em] uppercase h-14"
                  maxLength={6}
                  disabled={isLoading || success}
                  autoComplete="off"
                />
              </div>

              <Button 
                type="submit" 
                variant="outline" 
                className="w-full" 
                disabled={isLoading || success || pairingCode.length < 4}
              >
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
                  "Connect"
                )}
              </Button>
            </form>

            <div className="text-center space-y-2">
              <p className="text-xs text-muted-foreground">
                One-time pairing — auto-reconnects on any network
              </p>
              <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground/70">
                <span className="w-1.5 h-1.5 rounded-full bg-neon-green animate-pulse" />
                Secure end-to-end connection
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
