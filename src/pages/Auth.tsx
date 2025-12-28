import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Bot, Lock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { useToast } from "@/hooks/use-toast";

const UNLOCK_PIN = "1212";

export default function Auth() {
  const [pin, setPin] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    document.documentElement.classList.add("dark");
    // Check if already unlocked
    if (localStorage.getItem("jarvis_unlocked") === "true") {
      navigate("/dashboard");
    }
  }, [navigate]);

  const handlePinComplete = async (value: string) => {
    setPin(value);
    if (value.length === 4) {
      setIsLoading(true);
      setError(false);
      
      // Small delay for effect
      await new Promise(resolve => setTimeout(resolve, 500));
      
      if (value === UNLOCK_PIN) {
        localStorage.setItem("jarvis_unlocked", "true");
        toast({ title: "Access Granted", description: "Welcome to JARVIS" });
        navigate("/dashboard");
      } else {
        setError(true);
        setPin("");
        toast({ title: "Access Denied", description: "Invalid passcode", variant: "destructive" });
      }
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      {/* Background effects */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-accent/10 rounded-full blur-3xl" />
      </div>

      <Card className="w-full max-w-md relative glass-dark border-border/50 animate-fade-in">
        <CardHeader className="text-center space-y-4">
          <div className="mx-auto w-16 h-16 rounded-2xl gradient-primary flex items-center justify-center pulse-neon">
            <Bot className="w-10 h-10 text-primary-foreground" />
          </div>
          <div>
            <CardTitle className="text-3xl font-bold neon-text">JARVIS</CardTitle>
            <CardDescription className="text-muted-foreground">
              Enter passcode to unlock
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col items-center space-y-6">
          <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center">
            <Lock className={`w-6 h-6 ${error ? 'text-destructive animate-shake' : 'text-primary'}`} />
          </div>

          <InputOTP
            maxLength={4}
            value={pin}
            onChange={handlePinComplete}
            disabled={isLoading}
          >
            <InputOTPGroup className="gap-3">
              <InputOTPSlot 
                index={0} 
                className={`w-14 h-14 text-2xl border-2 ${error ? 'border-destructive' : 'border-border'} bg-muted/30 rounded-xl`}
              />
              <InputOTPSlot 
                index={1} 
                className={`w-14 h-14 text-2xl border-2 ${error ? 'border-destructive' : 'border-border'} bg-muted/30 rounded-xl`}
              />
              <InputOTPSlot 
                index={2} 
                className={`w-14 h-14 text-2xl border-2 ${error ? 'border-destructive' : 'border-border'} bg-muted/30 rounded-xl`}
              />
              <InputOTPSlot 
                index={3} 
                className={`w-14 h-14 text-2xl border-2 ${error ? 'border-destructive' : 'border-border'} bg-muted/30 rounded-xl`}
              />
            </InputOTPGroup>
          </InputOTP>

          {isLoading && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Verifying...</span>
            </div>
          )}

          <p className="text-xs text-muted-foreground text-center">
            Your AI-powered PC assistant
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
