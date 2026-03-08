import { useState, useCallback, useRef, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Upload,
  Download,
  FileIcon,
  X,
  CheckCircle,
  AlertCircle,
  Loader2,
  FolderUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";

interface TransferItem {
  id: string;
  name: string;
  size: number;
  direction: "upload" | "download";
  status: "pending" | "transferring" | "completed" | "failed";
  progress: number;
  error?: string;
}

interface DragDropFileTransferProps {
  isConnected: boolean;
  className?: string;
}

export function DragDropFileTransfer({ isConnected, className }: DragDropFileTransferProps) {
  const { sendCommand } = useDeviceCommands();
  const { toast } = useToast();

  const [isDragOver, setIsDragOver] = useState(false);
  const [transfers, setTransfers] = useState<TransferItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Update transfer in list
  const updateTransfer = useCallback((id: string, updates: Partial<TransferItem>) => {
    setTransfers((prev) => prev.map((t) => (t.id === id ? { ...t, ...updates } : t)));
  }, []);

  // Send file to PC in chunks
  const uploadFile = useCallback(async (file: File) => {
    const id = crypto.randomUUID();
    const item: TransferItem = {
      id,
      name: file.name,
      size: file.size,
      direction: "upload",
      status: "pending",
      progress: 0,
    };
    setTransfers((prev) => [item, ...prev]);

    try {
      updateTransfer(id, { status: "transferring" });

      const CHUNK_SIZE = 128 * 1024; // 128KB
      const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
      const arrayBuffer = await file.arrayBuffer();

      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const chunk = arrayBuffer.slice(start, start + CHUNK_SIZE);
        const base64 = btoa(String.fromCharCode(...new Uint8Array(chunk)));

        const result = await sendCommand(
          "receive_file_chunk",
          {
            filename: file.name,
            chunk_index: i,
            total_chunks: totalChunks,
            data: base64,
            file_size: file.size,
          },
          { awaitResult: true, timeoutMs: 30000 }
        );

        if (!result?.success) {
          throw new Error((result as any)?.error || "Chunk upload failed");
        }

        updateTransfer(id, { progress: Math.round(((i + 1) / totalChunks) * 100) });
      }

      updateTransfer(id, { status: "completed", progress: 100 });
      toast({ title: "📤 File sent to PC", description: file.name });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      updateTransfer(id, { status: "failed", error: msg });
      toast({ title: "Upload failed", description: msg, variant: "destructive" });
    }
  }, [sendCommand, toast, updateTransfer]);

  // Handle drag events
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isConnected) setIsDragOver(true);
  }, [isConnected]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    if (!isConnected) {
      toast({ title: "Not connected", variant: "destructive" });
      return;
    }

    const files = Array.from(e.dataTransfer.files);
    files.forEach((file) => uploadFile(file));
  }, [isConnected, uploadFile, toast]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    Array.from(e.target.files).forEach((file) => uploadFile(file));
    e.target.value = "";
  }, [uploadFile]);

  const removeTransfer = useCallback((id: string) => {
    setTransfers((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const clearCompleted = useCallback(() => {
    setTransfers((prev) => prev.filter((t) => t.status !== "completed" && t.status !== "failed"));
  }, []);

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  };

  const activeCount = transfers.filter((t) => t.status === "transferring" || t.status === "pending").length;

  return (
    <Card className={cn("border-border/20 bg-card/50", className)}>
      <CardContent className="p-3 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FolderUp className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium">File Transfer</span>
            {activeCount > 0 && (
              <Badge variant="default" className="text-[10px] px-1.5 py-0 animate-pulse">
                {activeCount} active
              </Badge>
            )}
          </div>
          {transfers.length > 0 && (
            <Button variant="ghost" size="sm" className="h-5 text-[10px] px-1.5" onClick={clearCompleted}>
              Clear
            </Button>
          )}
        </div>

        {/* Drop Zone */}
        <div
          className={cn(
            "border-2 border-dashed rounded-lg p-6 text-center transition-all cursor-pointer",
            isDragOver
              ? "border-primary bg-primary/5 scale-[1.02]"
              : "border-border/30 hover:border-border/50",
            !isConnected && "opacity-50 cursor-not-allowed"
          )}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => isConnected && fileInputRef.current?.click()}
        >
          <Upload className={cn("w-8 h-8 mx-auto mb-2", isDragOver ? "text-primary" : "text-muted-foreground")} />
          <p className="text-xs font-medium">
            {isDragOver ? "Drop to send to PC" : "Drag files here or tap to browse"}
          </p>
          <p className="text-[10px] text-muted-foreground mt-1">
            Files will be saved to PC Desktop
          </p>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileSelect}
        />

        {/* Transfer List */}
        {transfers.length > 0 && (
          <ScrollArea className="max-h-40">
            <div className="space-y-1.5 pr-2">
              {transfers.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center gap-2 p-2 rounded-lg bg-secondary/20"
                >
                  <div className={cn(
                    "w-7 h-7 rounded-md flex items-center justify-center shrink-0",
                    t.status === "completed" ? "bg-green-500/15" :
                    t.status === "failed" ? "bg-destructive/15" :
                    "bg-primary/10"
                  )}>
                    {t.status === "completed" ? (
                      <CheckCircle className="w-3.5 h-3.5 text-green-400" />
                    ) : t.status === "failed" ? (
                      <AlertCircle className="w-3.5 h-3.5 text-destructive" />
                    ) : t.status === "transferring" ? (
                      <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />
                    ) : (
                      <FileIcon className="w-3.5 h-3.5 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-medium truncate">{t.name}</p>
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] text-muted-foreground">{formatSize(t.size)}</span>
                      {t.status === "transferring" && (
                        <span className="text-[9px] text-primary">{t.progress}%</span>
                      )}
                    </div>
                    {t.status === "transferring" && (
                      <Progress value={t.progress} className="h-1 mt-1" />
                    )}
                    {t.error && (
                      <p className="text-[9px] text-destructive truncate">{t.error}</p>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 shrink-0"
                    onClick={() => removeTransfer(t.id)}
                  >
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
