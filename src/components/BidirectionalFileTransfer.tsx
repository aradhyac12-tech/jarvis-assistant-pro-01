import { useState, useRef, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  RefreshCw,
  Smartphone,
  Monitor,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { useDeviceContext } from "@/hooks/useDeviceContext";
import { useDeviceSession } from "@/hooks/useDeviceSession";
import { useLocalP2P } from "@/hooks/useLocalP2P";

interface FileTransferItem {
  id: string;
  name: string;
  size: number;
  direction: "phone_to_pc" | "pc_to_phone";
  progress: number;
  status: "pending" | "transferring" | "complete" | "error";
  error?: string;
}

interface PCFile {
  name: string;
  path: string;
  is_directory: boolean;
  size: number;
}

export function BidirectionalFileTransfer({ className }: { className?: string }) {
  const { toast } = useToast();
  const { sendCommand } = useDeviceCommands();
  const { selectedDevice } = useDeviceContext();
  const { session } = useDeviceSession();

  const [transfers, setTransfers] = useState<FileTransferItem[]>([]);
  const [pcSavePath, setPcSavePath] = useState("~/Downloads/Jarvis");
  const [pcBrowsePath, setPcBrowsePath] = useState("~");
  const [pcFiles, setPcFiles] = useState<PCFile[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [activeTab, setActiveTab] = useState<"upload" | "download">("upload");
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isConnected = selectedDevice?.is_online || false;

  // File icon based on type
  const getFileIcon = (name: string, isDir: boolean = false) => {
    if (isDir) return FolderOpen;
    const ext = name.split('.').pop()?.toLowerCase();
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext || '')) return Image;
    if (['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv'].includes(ext || '')) return Video;
    if (['mp3', 'wav', 'flac', 'm4a', 'ogg', 'aac'].includes(ext || '')) return Music;
    if (['txt', 'doc', 'docx', 'pdf', 'md', 'rtf'].includes(ext || '')) return FileText;
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

  // Browse PC files
  const browsePCFiles = useCallback(async (path: string = "~") => {
    if (!isConnected) return;
    
    setIsLoadingFiles(true);
    try {
      const result = await sendCommand("list_files", { path }, { awaitResult: true, timeoutMs: 10000 });
      
      if (result.success && result.result) {
        const data = result.result as { items?: PCFile[]; current_path?: string };
        setPcFiles(data.items || []);
        if (data.current_path) {
          setPcBrowsePath(data.current_path);
        }
      }
    } catch (err) {
      console.error("Failed to browse PC files:", err);
      toast({ title: "Browse failed", description: "Could not list PC files", variant: "destructive" });
    } finally {
      setIsLoadingFiles(false);
    }
  }, [isConnected, sendCommand, toast]);

  // Load initial files
  useEffect(() => {
    if (isConnected && activeTab === "download") {
      browsePCFiles(pcBrowsePath);
    }
  }, [isConnected, activeTab]);

  // Handle file selection for upload (Phone → PC)
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    Array.from(files).forEach(file => {
      const transferId = crypto.randomUUID();
      
      setTransfers(prev => [...prev, {
        id: transferId,
        name: file.name,
        size: file.size,
        direction: "phone_to_pc",
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

  // Upload file to PC (Phone → PC)
  const uploadFile = useCallback(async (file: File, transferId: string) => {
    if (!isConnected) {
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
      const CHUNK_SIZE = 64 * 1024; // 64KB chunks
      const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
      let uploadedBytes = 0;
      const fileId = crypto.randomUUID();

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
          file_id: fileId,
          file_name: file.name,
          chunk_index: i,
          total_chunks: totalChunks,
          data: base64Chunk,
          save_folder: pcSavePath.replace("~", ""),
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
  }, [isConnected, sendCommand, pcSavePath, toast]);

  // Download file from PC (PC → Phone)
  const downloadFileFromPC = useCallback(async (pcFile: PCFile) => {
    if (!isConnected || pcFile.is_directory) {
      if (pcFile.is_directory) {
        browsePCFiles(pcFile.path);
      }
      return;
    }

    const transferId = crypto.randomUUID();

    setTransfers(prev => [...prev, {
      id: transferId,
      name: pcFile.name,
      size: pcFile.size,
      direction: "pc_to_phone",
      progress: 0,
      status: "transferring",
    }]);

    try {
      const CHUNK_SIZE = 64 * 1024;
      const totalChunks = Math.ceil(pcFile.size / CHUNK_SIZE) || 1;
      const chunks: string[] = [];

      for (let i = 0; i < totalChunks; i++) {
        const result = await sendCommand("send_file_chunk", {
          path: pcFile.path,
          chunk_index: i,
          chunk_size: CHUNK_SIZE,
        }, { awaitResult: true, timeoutMs: 30000 });

        if (!result?.success || !result.result) {
          throw new Error(result?.error as string || "Chunk download failed");
        }

        const data = result.result as { data?: string };
        if (data.data) {
          chunks.push(data.data);
        }

        const progress = Math.round(((i + 1) / totalChunks) * 100);
        setTransfers(prev => prev.map(t => 
          t.id === transferId ? { ...t, progress } : t
        ));
      }

      // Combine chunks and download
      const base64Data = chunks.join('');
      const byteCharacters = atob(base64Data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray]);
      
      // Trigger browser download
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = pcFile.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setTransfers(prev => prev.map(t => 
        t.id === transferId ? { ...t, status: "complete", progress: 100 } : t
      ));

      toast({ title: "Download complete", description: pcFile.name });
    } catch (err) {
      const error = err instanceof Error ? err.message : "Download failed";
      setTransfers(prev => prev.map(t => 
        t.id === transferId ? { ...t, status: "error", error } : t
      ));
      toast({ title: "Download failed", description: error, variant: "destructive" });
    }
  }, [isConnected, sendCommand, browsePCFiles, toast]);

  // Navigate up in PC file browser
  const navigateUp = useCallback(() => {
    const parts = pcBrowsePath.split(/[/\\]/);
    parts.pop();
    const parentPath = parts.join('/') || '/';
    browsePCFiles(parentPath);
  }, [pcBrowsePath, browsePCFiles]);

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
              <CardDescription className="text-xs">Bidirectional PC ↔ Phone sharing</CardDescription>
            </div>
          </div>
          <Badge variant="secondary" className="text-xs">
            <Wifi className="h-3 w-3 mr-1" />
            {isConnected ? "Connected" : "Offline"}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "upload" | "download")}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="upload" className="text-xs gap-1.5">
              <Smartphone className="h-3 w-3" />
              Phone → PC
            </TabsTrigger>
            <TabsTrigger value="download" className="text-xs gap-1.5">
              <Monitor className="h-3 w-3" />
              PC → Phone
            </TabsTrigger>
          </TabsList>

          {/* Upload Tab (Phone → PC) */}
          <TabsContent value="upload" className="space-y-3 mt-3">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFileSelect}
            />
            <Button
              variant="outline"
              className="w-full h-16 border-dashed"
              onClick={() => fileInputRef.current?.click()}
              disabled={!isConnected}
            >
              <div className="flex flex-col items-center gap-1 text-muted-foreground">
                <Upload className="h-5 w-5" />
                <span className="text-xs">Select files to upload</span>
              </div>
            </Button>

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
                onClick={() => setPcSavePath("~/Downloads/Jarvis")}
              >
                <FolderOpen className="h-3 w-3" />
              </Button>
            </div>
          </TabsContent>

          {/* Download Tab (PC → Phone) */}
          <TabsContent value="download" className="space-y-3 mt-3">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2"
                onClick={navigateUp}
                disabled={!isConnected}
              >
                ..
              </Button>
              <Input
                value={pcBrowsePath}
                onChange={(e) => setPcBrowsePath(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && browsePCFiles(pcBrowsePath)}
                placeholder="PC path"
                className="flex-1 text-xs h-8 font-mono"
                disabled={!isConnected}
              />
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2"
                onClick={() => browsePCFiles(pcBrowsePath)}
                disabled={!isConnected || isLoadingFiles}
              >
                {isLoadingFiles ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="h-3 w-3" />
                )}
              </Button>
            </div>

            <ScrollArea className="h-32 border rounded-lg">
              <div className="p-1.5 space-y-0.5">
                {pcFiles.length === 0 && !isLoadingFiles && (
                  <p className="text-xs text-muted-foreground text-center py-4">
                    No files found
                  </p>
                )}
                {pcFiles.map((file, i) => {
                  const FileIcon = getFileIcon(file.name, file.is_directory);
                  return (
                    <button
                      key={i}
                      onClick={() => downloadFileFromPC(file)}
                      className="w-full flex items-center gap-2 p-2 rounded-md hover:bg-muted/50 text-left text-xs transition-colors"
                    >
                      <FileIcon className={cn(
                        "h-4 w-4 shrink-0",
                        file.is_directory ? "text-primary" : "text-muted-foreground"
                      )} />
                      <span className="flex-1 truncate">{file.name}</span>
                      {!file.is_directory && (
                        <span className="text-muted-foreground tabular-nums">
                          {formatSize(file.size)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>

        {/* Active Transfers */}
        {transfers.length > 0 && (
          <ScrollArea className="h-32">
            <div className="space-y-2">
              {transfers.map((transfer) => {
                const FileIcon = getFileIcon(transfer.name);
                return (
                  <div
                    key={transfer.id}
                    className="flex items-center gap-2 p-2 rounded-lg bg-muted/50"
                  >
                    <div className="w-7 h-7 rounded-md bg-secondary flex items-center justify-center shrink-0">
                      <FileIcon className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-xs font-medium truncate">{transfer.name}</p>
                        <Badge variant="outline" className="text-[9px] px-1 py-0">
                          {transfer.direction === "phone_to_pc" ? "↑" : "↓"}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2">
                        <Progress value={transfer.progress} className="h-1 flex-1" />
                        <span className="text-[10px] text-muted-foreground tabular-nums w-8">
                          {transfer.progress}%
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {transfer.status === "transferring" && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                      )}
                      {transfer.status === "complete" && (
                        <Check className="h-3.5 w-3.5 text-emerald-500" />
                      )}
                      {transfer.status === "error" && (
                        <X className="h-3.5 w-3.5 text-destructive" />
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5"
                        onClick={() => removeTransfer(transfer.id)}
                      >
                        <X className="h-2.5 w-2.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
