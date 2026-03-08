import { useState, useCallback, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import {
  Camera,
  Download,
  Loader2,
  Maximize2,
  Monitor,
  RefreshCw,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";

interface RemoteScreenshotProps {
  isConnected: boolean;
  className?: string;
}

export function RemoteScreenshot({ isConnected, className }: RemoteScreenshotProps) {
  const { sendCommand } = useDeviceCommands();
  const { toast } = useToast();

  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [quality, setQuality] = useState(70);
  const [zoom, setZoom] = useState(1);
  const [lastCaptured, setLastCaptured] = useState<Date | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  const captureScreen = useCallback(async () => {
    if (!isConnected || isCapturing) return;
    setIsCapturing(true);
    try {
      const result = await sendCommand(
        "take_screenshot",
        { quality, scale: 0.6 },
        { awaitResult: true, timeoutMs: 15000 }
      );
      if (result?.success && "result" in result && result.result) {
        const data = result.result as { success?: boolean; image?: string };
        if (data.success && data.image) {
          setScreenshot(`data:image/jpeg;base64,${data.image}`);
          setLastCaptured(new Date());
          setZoom(1);
        } else {
          toast({ title: "Screenshot failed", variant: "destructive" });
        }
      } else {
        toast({ title: "Screenshot failed", description: (result as any)?.error || "No response", variant: "destructive" });
      }
    } catch {
      toast({ title: "Screenshot failed", variant: "destructive" });
    }
    setIsCapturing(false);
  }, [isConnected, isCapturing, quality, sendCommand, toast]);

  const downloadScreenshot = useCallback(() => {
    if (!screenshot) return;
    const link = document.createElement("a");
    link.href = screenshot;
    link.download = `screenshot_${Date.now()}.jpg`;
    link.click();
    toast({ title: "Screenshot saved" });
  }, [screenshot, toast]);

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((prev) => !prev);
  }, []);

  return (
    <>
      <Card className={cn("border-border/20 bg-card/50", className)}>
        <CardContent className="p-3 space-y-3">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Camera className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium">Screen Capture</span>
            </div>
            {lastCaptured && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground">
                {lastCaptured.toLocaleTimeString()}
              </Badge>
            )}
          </div>

          {/* Capture Button */}
          <Button
            className="w-full gap-2"
            onClick={captureScreen}
            disabled={!isConnected || isCapturing}
          >
            {isCapturing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Monitor className="w-4 h-4" />
            )}
            {isCapturing ? "Capturing..." : "Capture PC Screen"}
          </Button>

          {/* Quality slider */}
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-muted-foreground w-10">Quality</span>
            <Slider
              value={[quality]}
              onValueChange={(v) => setQuality(v[0])}
              min={20}
              max={100}
              step={10}
              className="flex-1"
            />
            <span className="text-[10px] text-muted-foreground w-6 text-right">{quality}%</span>
          </div>

          {/* Screenshot Preview */}
          {screenshot && (
            <div className="space-y-2">
              <div
                className="relative rounded-lg overflow-hidden bg-black/50 cursor-pointer"
                onClick={toggleFullscreen}
              >
                <img
                  ref={imgRef}
                  src={screenshot}
                  alt="PC Screenshot"
                  className="w-full h-auto rounded-lg"
                  style={{ transform: `scale(${zoom})`, transformOrigin: "center" }}
                />
              </div>

              {/* Controls */}
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1 flex-1"
                  onClick={() => setZoom((z) => Math.max(1, z - 0.25))}
                >
                  <ZoomOut className="w-3 h-3" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1 flex-1"
                  onClick={() => setZoom((z) => Math.min(3, z + 0.25))}
                >
                  <ZoomIn className="w-3 h-3" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1 flex-1"
                  onClick={downloadScreenshot}
                >
                  <Download className="w-3 h-3" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1 flex-1"
                  onClick={toggleFullscreen}
                >
                  <Maximize2 className="w-3 h-3" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1 flex-1"
                  onClick={captureScreen}
                  disabled={isCapturing}
                >
                  <RefreshCw className={cn("w-3 h-3", isCapturing && "animate-spin")} />
                </Button>
              </div>
            </div>
          )}

          {!screenshot && (
            <div className="py-6 text-center">
              <Monitor className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-30" />
              <p className="text-[10px] text-muted-foreground">
                Tap capture to view your PC screen
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Fullscreen overlay */}
      {isFullscreen && screenshot && (
        <div
          className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center p-4"
          onClick={toggleFullscreen}
        >
          <img
            src={screenshot}
            alt="PC Screenshot Fullscreen"
            className="max-w-full max-h-full object-contain rounded-lg"
          />
          <div className="absolute top-4 right-4 flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              className="h-8 text-xs gap-1"
              onClick={(e) => {
                e.stopPropagation();
                downloadScreenshot();
              }}
            >
              <Download className="w-3 h-3" /> Save
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="h-8 text-xs gap-1"
              onClick={(e) => {
                e.stopPropagation();
                captureScreen();
              }}
              disabled={isCapturing}
            >
              <RefreshCw className={cn("w-3 h-3", isCapturing && "animate-spin")} /> Refresh
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
