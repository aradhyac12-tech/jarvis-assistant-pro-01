import { useState, useEffect, forwardRef } from "react";
import { useNavigate } from "react-router-dom";
import { Bot, Loader2, CheckCircle, Key } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useDeviceSession } from "@/hooks/useDeviceSession";

const Pair = forwardRef<HTMLDivElement>(function Pair(_, ref) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { session, isLoading: sessionLoading, pairDevice, error } = useDeviceSession();
  const [isConnecting, setIsConnecting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [accessCode, setAccessCode] = useState("");
  const [rememberDevice, setRememberDevice] = useState(true);

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
    const res = await pairDevice(accessCode.trim(), rememberDevice);
    if (res.success) {
      setSuccess(true);
      toast({ 
        title: "Connected", 
        description: rememberDevice 
          ? "PC connected. You won't need to pair again on this browser." 
          : "PC connected for this session." 
      });
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
          
          {/* Remember Device Toggle */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border border-border/50">
            <div className="space-y-0.5">
              <Label htmlFor="remember-device" className="text-sm font-medium cursor-pointer">
                Remember this device
              </Label>
              <p className="text-xs text-muted-foreground">
                {rememberDevice 
                  ? "Stay connected for 30 days" 
                  : "Session ends when browser closes"}
              </p>
            </div>
            <Switch
              id="remember-device"
              checked={rememberDevice}
              onCheckedChange={setRememberDevice}
              disabled={isConnecting || success}
            />
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
});

export default Pair;
