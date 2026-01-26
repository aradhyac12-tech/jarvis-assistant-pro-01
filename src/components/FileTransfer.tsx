import { useState, useRef, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  FolderOpen,
  Upload,
  Download,
  File,
  Image,
  Video,
  Music,
  FileText,
  X,
  Check,
  Loader2,
  Wifi,
  ArrowUpDown,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { useDeviceContext } from "@/hooks/useDeviceContext";
import { getFunctionsWsBase } from "@/lib/relay";
import { useDeviceSession } from "@/hooks/useDeviceSession";

interface FileTransferItem {
  id: string;
  name: string;
  size: number;
  type: "upload" | "download";
  progress: number;
  status: "pending" | "transferring" | "complete" | "error";
  error?: string;
}

interface FileTransferProps {
  className?: string;
}

export function FileTransfer({ className }: FileTransferProps) {
  const { toast } = useToast();
  const { sendCommand } = useDeviceCommands();
  const { selectedDevice } = useDeviceContext();
  const { session } = useDeviceSession();

  const [transfers, setTransfers] = useState<FileTransferItem[]>([]);
  const [pcSavePath, setPcSavePath] = useState("~/Downloads");
  const [connectionMode, setConnectionMode] = useState<"p2p" | "relay" | "detecting">("detecting");
  const [transferSpeed, setTransferSpeed] = useState<number>(0);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);

  const isConnected = selectedDevice?.is_online || false;
  const sessionToken = session?.session_token;
  const deviceId = selectedDevice?.id || session?.device_id;

  // Detect connection mode (P2P vs Relay)
  useEffect(() => {
    if (!isConnected || !sessionToken || !deviceId) {
      setConnectionMode("detecting");
      return;
    }

    // Try P2P first, fall back to relay
    const detectMode = async () => {
      setConnectionMode("detecting");
      
      // For now, default to relay - P2P would require STUN/TURN setup
      // In production, we'd try to establish WebRTC and measure latency
      setTimeout(() => {
        setConnectionMode("relay");
      }, 1000);
    };

    detectMode();
  }, [isConnected, sessionToken, deviceId]);

  // File icon based on type
  const getFileIcon = (name: string) => {
    const ext = name.split('.').pop()?.toLowerCase();
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext || '')) return Image;
    if (['mp4', 'mkv', 'avi', 'mov', 'webm'].includes(ext || '')) return Video;
    if (['mp3', 'wav', 'flac', 'm4a', 'ogg'].includes(ext || '')) return Music;
    if (['txt', 'doc', 'docx', 'pdf'].includes(ext || '')) return FileText;
    return File;
  };

  // Format file size
  const formatSize = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  // Handle file selection for upload
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    Array.from(files).forEach(file => {
      const transferId = crypto.randomUUID();
      
      setTransfers(prev => [...prev, {
        id: transferId,
        name: file.name,
        size: file.size,
        type: "upload",
        progress: 0,
        status: "pending",
      }]);

      // Start upload
      uploadFile(file, transferId);
    });

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  // Upload file to PC
  const uploadFile = useCallback(async (file: File, transferId: string) => {
    if (!isConnected || !sessionToken || !deviceId) {
      setTransfers(prev => prev.map(t => 
        t.id === transferId ? { ...t, status: "error", error: "Not connected" } : t
      ));
      return;
    }

    setTransfers(prev => prev.map(t => 
      t.id === transferId ? { ...t, status: "transferring" } : t
    ));

    try {
      // Read file as base64 chunks
      const CHUNK_SIZE = 256 * 1024; // 256KB chunks
      const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
      let uploadedBytes = 0;

      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const chunk = file.slice(start, end);
        
        const base64Chunk = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            resolve(result.split(',')[1]); // Remove data URL prefix
          };
          reader.onerror = reject;
          reader.readAsDataURL(chunk);
        });

        // Send chunk to PC
        const result = await sendCommand("receive_file_chunk", {
          file_name: file.name,
          chunk_index: i,
          total_chunks: totalChunks,
          chunk_data: base64Chunk,
          save_path: pcSavePath,
        }, { awaitResult: true, timeoutMs: 30000 });

        if (!result?.success) {
          throw new Error(result?.error as string || "Chunk upload failed");
        }

        uploadedBytes += chunk.size;
        const progress = Math.round((uploadedBytes / file.size) * 100);
        
        setTransfers(prev => prev.map(t => 
          t.id === transferId ? { ...t, progress } : t
        ));
      }

      setTransfers(prev => prev.map(t => 
        t.id === transferId ? { ...t, status: "complete", progress: 100 } : t
      ));

      toast({ title: "Upload complete", description: file.name });
    } catch (err) {
      const error = err instanceof Error ? err.message : "Upload failed";
      setTransfers(prev => prev.map(t => 
        t.id === transferId ? { ...t, status: "error", error } : t
      ));
      toast({ title: "Upload failed", description: error, variant: "destructive" });
    }
  }, [isConnected, sessionToken, deviceId, sendCommand, pcSavePath, toast]);

  // Request file from PC
  const requestFileFromPc = useCallback(async (pcFilePath: string) => {
    if (!isConnected) return;

    const transferId = crypto.randomUUID();
    const fileName = pcFilePath.split(/[/\\]/).pop() || "file";

    setTransfers(prev => [...prev, {
      id: transferId,
      name: fileName,
      size: 0,
      type: "download",
      progress: 0,
      status: "transferring",
    }]);

    try {
      const result = await sendCommand("send_file", {
        file_path: pcFilePath,
      }, { awaitResult: true, timeoutMs: 60000 });

      if (result?.success && "result" in result && result.result) {
        const data = result.result as { file_data?: string; file_name?: string; size?: number };
        
        if (data.file_data) {
          // Convert base64 to blob and download
          const byteCharacters = atob(data.file_data);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          const blob = new Blob([byteArray]);
          
          // Trigger download
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = data.file_name || fileName;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);

          setTransfers(prev => prev.map(t => 
            t.id === transferId ? { ...t, status: "complete", progress: 100, size: data.size || 0 } : t
          ));

          toast({ title: "Download complete", description: fileName });
        }
      } else {
        throw new Error(result?.error as string || "Download failed");
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : "Download failed";
      setTransfers(prev => prev.map(t => 
        t.id === transferId ? { ...t, status: "error", error } : t
      ));
      toast({ title: "Download failed", description: error, variant: "destructive" });
    }
  }, [isConnected, sendCommand, toast]);

  // Remove transfer from list
  const removeTransfer = useCallback((id: string) => {
    setTransfers(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <Card className={cn("border-border/40", className)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <ArrowUpDown className="h-4 w-4 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">File Transfer</CardTitle>
              <CardDescription className="text-xs">Fast P2P file sharing</CardDescription>
            </div>
          </div>
          <Badge 
            variant={connectionMode === "p2p" ? "default" : "secondary"} 
            className={cn(
              "text-xs",
              connectionMode === "detecting" && "animate-pulse"
            )}
          >
            <Wifi className="h-3 w-3 mr-1" />
            {connectionMode === "detecting" ? "Detecting..." : connectionMode === "p2p" ? "P2P" : "Relay"}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Upload section */}
        <div className="space-y-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileSelect}
          />
          <Button
            variant="outline"
            className="w-full h-20 border-dashed"
            onClick={() => fileInputRef.current?.click()}
            disabled={!isConnected}
          >
            <div className="flex flex-col items-center gap-1.5 text-muted-foreground">
              <Upload className="h-5 w-5" />
              <span className="text-xs">Upload files to PC</span>
            </div>
          </Button>
        </div>

        {/* Save path */}
        <div className="flex gap-2">
          <Input
            value={pcSavePath}
            onChange={(e) => setPcSavePath(e.target.value)}
            placeholder="PC save folder"
            className="flex-1 text-xs h-8"
            disabled={!isConnected}
          />
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-2"
            onClick={() => setPcSavePath("~/Downloads")}
          >
            <FolderOpen className="h-3 w-3" />
          </Button>
        </div>

        {/* Active transfers */}
        {transfers.length > 0 && (
          <ScrollArea className="h-40">
            <div className="space-y-2">
              {transfers.map((transfer) => {
                const FileIcon = getFileIcon(transfer.name);
                return (
                  <div
                    key={transfer.id}
                    className="flex items-center gap-3 p-2 rounded-lg bg-muted/50"
                  >
                    <div className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center shrink-0">
                      <FileIcon className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{transfer.name}</p>
                      <div className="flex items-center gap-2">
                        <Progress value={transfer.progress} className="h-1 flex-1" />
                        <span className="text-[10px] text-muted-foreground tabular-nums">
                          {transfer.progress}%
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {transfer.status === "transferring" && (
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      )}
                      {transfer.status === "complete" && (
                        <Check className="h-4 w-4 text-primary" />
                      )}
                      {transfer.status === "error" && (
                        <X className="h-4 w-4 text-destructive" />
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => removeTransfer(transfer.id)}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}

        {/* Empty state */}
        {transfers.length === 0 && (
          <div className="text-center py-4 text-muted-foreground">
            <p className="text-xs">No active transfers</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
