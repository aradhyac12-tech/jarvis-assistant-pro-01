import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Bot, Lock, Loader2, CheckCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { useToast } from "@/hooks/use-toast";

const UNLOCK_PIN = "1212";

export default function Auth() {
  const [pin, setPin] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(false);
  const [success, setSuccess] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    document.documentElement.classList.add("dark");
    // Check if already unlocked
    if (localStorage.getItem("jarvis_unlocked") === "true") {
      navigate("/dashboard", { replace: true });
    }
  }, [navigate]);

  const handleUnlock = useCallback(async (value: string) => {
    if (value.length !== 4) return;
    
    setIsLoading(true);
    setError(false);
    
    // Small delay for effect
    await new Promise(resolve => setTimeout(resolve, 400));
    
    if (value === UNLOCK_PIN) {
      setSuccess(true);
      localStorage.setItem("jarvis_unlocked", "true");
      toast({ title: "Access Granted", description: "Welcome to JARVIS" });
      
      // Navigate after showing success
      await new Promise(resolve => setTimeout(resolve, 500));
      navigate("/dashboard", { replace: true });
    } else {
      setError(true);
      setPin("");
      toast({ title: "Access Denied", description: "Invalid passcode", variant: "destructive" });
      setIsLoading(false);
    }
  }, [navigate, toast]);

  const handlePinChange = (value: string) => {
    setPin(value);
    setError(false);
    
    if (value.length === 4) {
      handleUnlock(value);
    }
  };

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
              {success ? "Access granted" : "Enter passcode to unlock"}
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col items-center space-y-8 pb-8">
          <div className={`w-14 h-14 rounded-full flex items-center justify-center transition-all duration-300 ${
            success ? 'bg-neon-green/20' : error ? 'bg-destructive/20' : 'bg-muted/50'
          }`}>
            <Lock className={`w-7 h-7 transition-all duration-300 ${
              success ? 'text-neon-green' : error ? 'text-destructive animate-shake' : 'text-primary'
            }`} />
          </div>

          <InputOTP
            maxLength={4}
            value={pin}
            onChange={handlePinChange}
            disabled={isLoading || success}
            autoFocus
          >
            <InputOTPGroup className="gap-4">
              {[0, 1, 2, 3].map((index) => (
                <InputOTPSlot 
                  key={index}
                  index={index} 
                  className={`w-16 h-16 text-2xl font-bold border-2 rounded-xl transition-all duration-200 ${
                    success 
                      ? 'border-neon-green bg-neon-green/10 text-neon-green' 
                      : error 
                        ? 'border-destructive bg-destructive/10' 
                        : 'border-border bg-muted/30 focus:border-primary focus:ring-2 focus:ring-primary/20'
                  }`}
                />
              ))}
            </InputOTPGroup>
          </InputOTP>

          {isLoading && !success && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>Verifying...</span>
            </div>
          )}

          <div className="text-center space-y-2">
            <p className="text-xs text-muted-foreground">
              Your AI-powered PC assistant
            </p>
            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground/70">
              <span className="w-1.5 h-1.5 rounded-full bg-neon-green animate-pulse" />
              Secure connection
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Add shake animation */}
      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-8px); }
          75% { transform: translateX(8px); }
        }
        .animate-shake {
          animation: shake 0.3s ease-in-out;
        }
      `}</style>
    </div>
  );
}
