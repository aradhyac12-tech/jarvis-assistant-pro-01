import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { X, Camera, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface QRScannerProps {
  onScan: (code: string) => void;
  onClose: () => void;
}

export function QRScanner({ onScan, onClose }: QRScannerProps) {
  const [isStarting, setIsStarting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let mounted = true;
    
    const startScanner = async () => {
      try {
        const scanner = new Html5Qrcode("qr-reader");
        scannerRef.current = scanner;

        await scanner.start(
          { facingMode: "environment" },
          {
            fps: 10,
            qrbox: { width: 250, height: 250 },
            aspectRatio: 1,
          },
          (decodedText) => {
            // Extract code from URL or use as-is
            let code = decodedText;
            try {
              const url = new URL(decodedText);
              const codeParam = url.searchParams.get("code");
              if (codeParam) {
                code = codeParam;
              }
            } catch {
              // Not a URL, use as-is (might be just the code)
            }
            
            // Stop scanner before callback
            scanner.stop().catch(console.error);
            onScan(code.toUpperCase());
          },
          () => {
            // QR code not found in frame - this is normal
          }
        );

        if (mounted) {
          setIsStarting(false);
        }
      } catch (err) {
        console.error("Scanner error:", err);
        if (mounted) {
          setError(
            err instanceof Error
              ? err.message.includes("Permission")
                ? "Camera permission denied. Please allow camera access."
                : err.message
              : "Failed to start camera"
          );
          setIsStarting(false);
        }
      }
    };

    startScanner();

    return () => {
      mounted = false;
      if (scannerRef.current) {
        scannerRef.current.stop().catch(console.error);
      }
    };
  }, [onScan]);

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 bg-background/80 backdrop-blur">
        <div className="flex items-center gap-2">
          <Camera className="w-5 h-5 text-primary" />
          <span className="font-medium">Scan QR Code</span>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="w-5 h-5" />
        </Button>
      </div>

      {/* Scanner */}
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="relative w-full max-w-sm aspect-square" ref={containerRef}>
          {isStarting && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-secondary/50 rounded-2xl z-10">
              <Loader2 className="w-8 h-8 animate-spin text-primary mb-2" />
              <p className="text-sm text-muted-foreground">Starting camera...</p>
            </div>
          )}
          
          {error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-secondary/50 rounded-2xl z-10 p-4">
              <p className="text-sm text-destructive text-center mb-4">{error}</p>
              <Button variant="outline" onClick={onClose}>
                Go Back
              </Button>
            </div>
          )}

          <div 
            id="qr-reader" 
            className="w-full h-full rounded-2xl overflow-hidden"
          />

          {/* Scanning overlay */}
          {!isStarting && !error && (
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-64 h-64 border-2 border-primary rounded-lg relative">
                  {/* Corner accents */}
                  <div className="absolute -top-1 -left-1 w-8 h-8 border-t-4 border-l-4 border-primary rounded-tl-lg" />
                  <div className="absolute -top-1 -right-1 w-8 h-8 border-t-4 border-r-4 border-primary rounded-tr-lg" />
                  <div className="absolute -bottom-1 -left-1 w-8 h-8 border-b-4 border-l-4 border-primary rounded-bl-lg" />
                  <div className="absolute -bottom-1 -right-1 w-8 h-8 border-b-4 border-r-4 border-primary rounded-br-lg" />
                  
                  {/* Scanning line animation */}
                  <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-primary to-transparent animate-scan" />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Instructions */}
      <div className="p-4 text-center bg-background/80 backdrop-blur">
        <p className="text-sm text-muted-foreground">
          Point your camera at the QR code shown on your PC
        </p>
      </div>
    </div>
  );
}
