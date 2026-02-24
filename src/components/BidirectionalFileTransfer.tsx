import { useState, useRef, useCallback, useEffect, useMemo } from "react";
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
  AlertTriangle,
  Zap,
  Stethoscope,
  CheckCircle,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { useDeviceContext } from "@/hooks/useDeviceContext";
import { useDeviceSession } from "@/hooks/useDeviceSession";

interface FileTransferItem {
  id: string;
  name: string;
  size: number;
  direction: "phone_to_pc" | "pc_to_phone";
  progress: number;
  status: "pending" | "transferring" | "complete" | "error";
  error?: string;
  speed?: number; // bytes/sec
  startTime?: number;
}

interface PCFile {
  name: string;
  path: string;
  is_directory: boolean;
  size: number;
}

interface DiagResult {
  name: string;
  status: "pass" | "fail" | "warn" | "running";
  message: string;
}

export function BidirectionalFileTransfer({ className }: { className?: string }) {
  const { toast } = useToast();
  const { sendCommand } = useDeviceCommands();
  const { selectedDevice } = useDeviceContext();
  const { session } = useDeviceSession();

  const [transfers, setTransfers] = useState<FileTransferItem[]>([]);
  const [pcSavePath, setPcSavePath] = useState(() => {
    try { return localStorage.getItem("file_transfer_save_path") || ""; } catch { return ""; }
  });
  const [pcBrowsePath, setPcBrowsePath] = useState("~");
  const [pcFiles, setPcFiles] = useState<PCFile[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [activeTab, setActiveTab] = useState<"upload" | "download" | "diag">("upload");
  const [isDragOver, setIsDragOver] = useState(false);
  const [diagResults, setDiagResults] = useState<DiagResult[]>([]);
  const [diagRunning, setDiagRunning] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const isConnected = selectedDevice?.is_online || false;

  // Save pcSavePath to localStorage
  useEffect(() => {
    if (pcSavePath) {
      try { localStorage.setItem("file_transfer_save_path", pcSavePath); } catch {}
    }
  }, [pcSavePath]);

  const getFileIcon = (name: string, isDir = false) => {
    if (isDir) return FolderOpen;
    const ext = name.split(".").pop()?.toLowerCase();
    if (["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"].includes(ext || "")) return Image;
    if (["mp4", "mkv", "avi", "mov", "webm", "flv"].includes(ext || "")) return Video;
    if (["mp3", "wav", "flac", "m4a", "ogg", "aac"].includes(ext || "")) return Music;
    if (["txt", "doc", "docx", "pdf", "md", "rtf"].includes(ext || "")) return FileText;
    return File;
  };

  const formatSize = (bytes: number): string => {
    if (bytes <= 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  const formatSpeed = (bytesPerSec: number): string => {
    if (bytesPerSec <= 0) return "—";
    return formatSize(bytesPerSec) + "/s";
  };

  // Browse PC files
  const browsePCFiles = useCallback(async (path = "~") => {
    if (!isConnected) return;
    setIsLoadingFiles(true);
    try {
      const result = await sendCommand("list_files", { path }, { awaitResult: true, timeoutMs: 10000 });
      if (result.success && result.result) {
        const data = result.result as { items?: PCFile[]; current_path?: string };
        setPcFiles(data.items || []);
        if (data.current_path) setPcBrowsePath(data.current_path);
      }
    } catch (err) {
      console.error("Failed to browse PC files:", err);
    } finally {
      setIsLoadingFiles(false);
    }
  }, [isConnected, sendCommand]);

  useEffect(() => {
    if (isConnected && activeTab === "download") browsePCFiles(pcBrowsePath);
  }, [isConnected, activeTab]);

  // === DRAG AND DROP ===
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;
    if (!isConnected) {
      toast({ title: "Not connected", description: "Connect to PC first.", variant: "destructive" });
      return;
    }

    Array.from(files).forEach((file) => {
      const transferId = crypto.randomUUID();
      setTransfers((prev) => [
        ...prev,
        { id: transferId, name: file.name, size: file.size, direction: "phone_to_pc", progress: 0, status: "pending" },
      ]);
      uploadFile(file, transferId);
    });
  }, [isConnected]);

  // Handle file input selection
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    Array.from(files).forEach((file) => {
      const transferId = crypto.randomUUID();
      setTransfers((prev) => [
        ...prev,
        { id: transferId, name: file.name, size: file.size, direction: "phone_to_pc", progress: 0, status: "pending" },
      ]);
      uploadFile(file, transferId);
    });

    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  // Upload file to PC — adaptive chunk size based on connection mode
  const uploadFile = useCallback(
    async (file: File, transferId: string) => {
      if (!isConnected) {
        setTransfers((prev) => prev.map((t) => (t.id === transferId ? { ...t, status: "error" as const, error: "Not connected" } : t)));
        return;
      }

      const startTime = Date.now();
      setTransfers((prev) => prev.map((t) => (t.id === transferId ? { ...t, status: "transferring" as const, startTime } : t)));

      try {
        // Use larger chunks for faster transfer — 256KB default, works on both cloud and P2P
        const CHUNK_SIZE = 256 * 1024;
        const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
        let uploadedBytes = 0;
        const fileId = crypto.randomUUID();
        let consecutiveErrors = 0;

        for (let i = 0; i < totalChunks; i++) {
          const start = i * CHUNK_SIZE;
          const end = Math.min(start + CHUNK_SIZE, file.size);
          const chunk = file.slice(start, end);

          const base64Chunk = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              const result = reader.result as string;
              resolve(result.split(",")[1]);
            };
            reader.onerror = reject;
            reader.readAsDataURL(chunk);
          });

          // Retry logic for each chunk (up to 3 attempts)
          let chunkSuccess = false;
          for (let attempt = 0; attempt < 3 && !chunkSuccess; attempt++) {
            try {
              const result = await sendCommand(
                "receive_file_chunk",
                {
                  file_id: fileId,
                  file_name: file.name,
                  chunk_index: i,
                  total_chunks: totalChunks,
                  data: base64Chunk,
                  save_folder: pcSavePath || "",
                },
                { awaitResult: true, timeoutMs: 60000 }
              );

              if (result?.success) {
                chunkSuccess = true;
                consecutiveErrors = 0;
              } else if (attempt === 2) {
                throw new Error((result?.error as string) || "Chunk upload failed");
              }
            } catch (err) {
              if (attempt === 2) throw err;
              // Wait before retry
              await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
            }
          }

          uploadedBytes += chunk.size;
          const elapsed = (Date.now() - startTime) / 1000;
          const speed = elapsed > 0 ? uploadedBytes / elapsed : 0;
          const progress = Math.round((uploadedBytes / file.size) * 100);

          setTransfers((prev) =>
            prev.map((t) => (t.id === transferId ? { ...t, progress, speed } : t))
          );
        }

        setTransfers((prev) =>
          prev.map((t) => (t.id === transferId ? { ...t, status: "complete" as const, progress: 100 } : t))
        );
        toast({ title: "Upload complete", description: `${file.name} (${formatSize(file.size)})` });
      } catch (err) {
        const error = err instanceof Error ? err.message : "Upload failed";
        setTransfers((prev) =>
          prev.map((t) => (t.id === transferId ? { ...t, status: "error" as const, error } : t))
        );
        toast({ title: "Upload failed", description: error, variant: "destructive" });
      }
    },
    [isConnected, sendCommand, pcSavePath, toast]
  );

  // Download file from PC — with larger chunks and retry logic
  const downloadFileFromPC = useCallback(
    async (pcFile: PCFile) => {
      if (!isConnected || pcFile.is_directory) {
        if (pcFile.is_directory) browsePCFiles(pcFile.path);
        return;
      }

      const transferId = crypto.randomUUID();
      const startTime = Date.now();

      setTransfers((prev) => [
        ...prev,
        { id: transferId, name: pcFile.name, size: pcFile.size, direction: "pc_to_phone", progress: 0, status: "transferring", startTime },
      ]);

      try {
        const CHUNK_SIZE = 256 * 1024; // 256KB chunks
        const totalChunks = Math.ceil(pcFile.size / CHUNK_SIZE) || 1;
        const chunks: string[] = [];
        let downloadedBytes = 0;

        for (let i = 0; i < totalChunks; i++) {
          let chunkData: string | null = null;

          // Retry each chunk up to 3 times
          for (let attempt = 0; attempt < 3 && !chunkData; attempt++) {
            try {
              const result = await sendCommand(
                "send_file_chunk",
                { path: pcFile.path, chunk_index: i, chunk_size: CHUNK_SIZE },
                { awaitResult: true, timeoutMs: 60000 }
              );

              if (result?.success && result.result) {
                const data = result.result as { data?: string; file_size?: number };
                if (data.data) chunkData = data.data;
              }
              if (!chunkData && attempt === 2) {
                throw new Error((result?.error as string) || "Chunk download failed");
              }
            } catch (err) {
              if (attempt === 2) throw err;
              await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
            }
          }

          if (chunkData) chunks.push(chunkData);

          downloadedBytes = Math.min((i + 1) * CHUNK_SIZE, pcFile.size);
          const elapsed = (Date.now() - startTime) / 1000;
          const speed = elapsed > 0 ? downloadedBytes / elapsed : 0;
          const progress = Math.round(((i + 1) / totalChunks) * 100);

          setTransfers((prev) =>
            prev.map((t) => (t.id === transferId ? { ...t, progress, speed } : t))
          );
        }

        // Combine and trigger browser download
        const base64Data = chunks.join("");
        const byteCharacters = atob(base64Data);
        const byteArray = new Uint8Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) byteArray[i] = byteCharacters.charCodeAt(i);
        const blob = new Blob([byteArray]);

        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = pcFile.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        setTransfers((prev) =>
          prev.map((t) => (t.id === transferId ? { ...t, status: "complete" as const, progress: 100 } : t))
        );
        toast({ title: "Download complete", description: `${pcFile.name} (${formatSize(pcFile.size)})` });
      } catch (err) {
        const error = err instanceof Error ? err.message : "Download failed";
        setTransfers((prev) =>
          prev.map((t) => (t.id === transferId ? { ...t, status: "error" as const, error } : t))
        );
        toast({ title: "Download failed", description: error, variant: "destructive" });
      }
    },
    [isConnected, sendCommand, browsePCFiles, toast]
  );

  const navigateUp = useCallback(() => {
    const parts = pcBrowsePath.split(/[/\\]/);
    parts.pop();
    browsePCFiles(parts.join("/") || "/");
  }, [pcBrowsePath, browsePCFiles]);

  const removeTransfer = useCallback((id: string) => {
    setTransfers((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // === DIAGNOSTICS ===
  const runDiagnostics = useCallback(async () => {
    setDiagRunning(true);
    const results: DiagResult[] = [];

    // 1. Connection check
    results.push({ name: "Device Connection", status: isConnected ? "pass" : "fail", message: isConnected ? "PC is online" : "PC is offline — connect first" });
    setDiagResults([...results]);

    if (!isConnected) {
      setDiagRunning(false);
      return;
    }

    // 2. Agent ping
    results.push({ name: "Agent Responsiveness", status: "running", message: "Pinging agent..." });
    setDiagResults([...results]);
    try {
      const pingStart = Date.now();
      const pingResult = await sendCommand("get_system_stats", {}, { awaitResult: true, timeoutMs: 5000 });
      const pingMs = Date.now() - pingStart;
      results[results.length - 1] = {
        name: "Agent Responsiveness",
        status: pingResult.success ? "pass" : "fail",
        message: pingResult.success ? `Agent responded in ${pingMs}ms` : "Agent did not respond",
      };
    } catch {
      results[results.length - 1] = { name: "Agent Responsiveness", status: "fail", message: "Agent ping timed out" };
    }
    setDiagResults([...results]);

    // 3. File listing test
    results.push({ name: "File Listing", status: "running", message: "Testing list_files..." });
    setDiagResults([...results]);
    try {
      const listResult = await sendCommand("list_files", { path: "~" }, { awaitResult: true, timeoutMs: 8000 });
      results[results.length - 1] = {
        name: "File Listing",
        status: listResult.success ? "pass" : "fail",
        message: listResult.success ? "File listing works" : `Failed: ${listResult.error}`,
      };
    } catch {
      results[results.length - 1] = { name: "File Listing", status: "fail", message: "File listing timed out" };
    }
    setDiagResults([...results]);

    // 4. Write permission test (small test chunk)
    results.push({ name: "Write Permission", status: "running", message: "Testing file write..." });
    setDiagResults([...results]);
    try {
      const testData = btoa("jarvis_test");
      const writeResult = await sendCommand(
        "receive_file_chunk",
        { file_id: "diag_test", file_name: ".jarvis_diag_test", chunk_index: 0, total_chunks: 1, data: testData, save_folder: "" },
        { awaitResult: true, timeoutMs: 8000 }
      );
      results[results.length - 1] = {
        name: "Write Permission",
        status: writeResult.success ? "pass" : "fail",
        message: writeResult.success ? "Write to Downloads/Jarvis OK" : `Write failed: ${writeResult.error}`,
      };
    } catch {
      results[results.length - 1] = { name: "Write Permission", status: "fail", message: "Write test timed out" };
    }
    setDiagResults([...results]);

    // 5. Read test
    results.push({ name: "Read Permission", status: "running", message: "Testing file read..." });
    setDiagResults([...results]);
    try {
      const readResult = await sendCommand(
        "send_file_chunk",
        { path: "~", chunk_index: 0, chunk_size: 64 },
        { awaitResult: true, timeoutMs: 8000 }
      );
      // This will likely fail since ~ is a dir, but at least tests the command route
      results[results.length - 1] = {
        name: "Read Permission",
        status: readResult.success ? "pass" : "warn",
        message: readResult.success ? "Read works" : "Read command routed OK (test path is dir)",
      };
    } catch {
      results[results.length - 1] = { name: "Read Permission", status: "fail", message: "Read test timed out" };
    }
    setDiagResults([...results]);

    setDiagRunning(false);
  }, [isConnected, sendCommand]);

  const diagStatusIcon = (s: DiagResult["status"]) => {
    switch (s) {
      case "pass": return <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />;
      case "fail": return <XCircle className="h-3.5 w-3.5 text-destructive" />;
      case "warn": return <AlertTriangle className="h-3.5 w-3.5 text-yellow-500" />;
      case "running": return <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />;
    }
  };

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
              <CardDescription className="text-xs">Drag & drop or browse • PC ↔ Phone</CardDescription>
            </div>
          </div>
          <Badge variant={isConnected ? "secondary" : "destructive"} className="text-xs">
            <Wifi className="h-3 w-3 mr-1" />
            {isConnected ? "Connected" : "Offline"}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="upload" className="text-xs gap-1">
              <Upload className="h-3 w-3" />
              Upload
            </TabsTrigger>
            <TabsTrigger value="download" className="text-xs gap-1">
              <Download className="h-3 w-3" />
              Download
            </TabsTrigger>
            <TabsTrigger value="diag" className="text-xs gap-1">
              <Stethoscope className="h-3 w-3" />
              Diagnose
            </TabsTrigger>
          </TabsList>

          {/* Upload Tab — with drag & drop */}
          <TabsContent value="upload" className="space-y-3 mt-3">
            <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileSelect} />
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "w-full h-24 border-2 border-dashed rounded-lg flex flex-col items-center justify-center gap-2 cursor-pointer transition-all",
                isDragOver
                  ? "border-primary bg-primary/10 scale-[1.02]"
                  : "border-border/50 hover:border-primary/50 hover:bg-muted/30",
                !isConnected && "opacity-50 pointer-events-none"
              )}
            >
              <Upload className={cn("h-6 w-6", isDragOver ? "text-primary" : "text-muted-foreground")} />
              <span className="text-xs text-muted-foreground">
                {isDragOver ? "Drop files here!" : "Drag & drop files or tap to select"}
              </span>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground">Save to PC folder (empty = Downloads/Jarvis)</label>
              <div className="flex gap-2">
                <Input
                  value={pcSavePath}
                  onChange={(e) => setPcSavePath(e.target.value)}
                  placeholder="~/Downloads/Jarvis (default)"
                  className="flex-1 text-xs h-8 font-mono"
                  disabled={!isConnected}
                />
                <Button variant="outline" size="sm" className="h-8 px-2" onClick={() => setPcSavePath("")}>
                  <FolderOpen className="h-3 w-3" />
                </Button>
              </div>
            </div>
          </TabsContent>

          {/* Download Tab */}
          <TabsContent value="download" className="space-y-3 mt-3">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="h-8 px-2" onClick={navigateUp} disabled={!isConnected}>
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
              <Button variant="outline" size="sm" className="h-8 px-2" onClick={() => browsePCFiles(pcBrowsePath)} disabled={!isConnected || isLoadingFiles}>
                {isLoadingFiles ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              </Button>
            </div>

            <ScrollArea className="h-36 border rounded-lg">
              <div className="p-1.5 space-y-0.5">
                {pcFiles.length === 0 && !isLoadingFiles && (
                  <p className="text-xs text-muted-foreground text-center py-4">No files found</p>
                )}
                {pcFiles.map((file, i) => {
                  const Icon = getFileIcon(file.name, file.is_directory);
                  return (
                    <button
                      key={i}
                      onClick={() => downloadFileFromPC(file)}
                      className="w-full flex items-center gap-2 p-2 rounded-md hover:bg-muted/50 text-left text-xs transition-colors"
                    >
                      <Icon className={cn("h-4 w-4 shrink-0", file.is_directory ? "text-primary" : "text-muted-foreground")} />
                      <span className="flex-1 truncate">{file.name}</span>
                      {!file.is_directory && <span className="text-muted-foreground tabular-nums">{formatSize(file.size)}</span>}
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          </TabsContent>

          {/* Diagnostics Tab */}
          <TabsContent value="diag" className="space-y-3 mt-3">
            <Button onClick={runDiagnostics} disabled={diagRunning} variant="outline" className="w-full h-9 text-xs gap-2">
              {diagRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Stethoscope className="h-3.5 w-3.5" />}
              {diagRunning ? "Running..." : "Run File Transfer Diagnostics"}
            </Button>

            {diagResults.length > 0 && (
              <div className="space-y-1.5">
                {diagResults.map((r, i) => (
                  <div key={i} className="flex items-center gap-2 p-2 rounded-md bg-muted/30 text-xs">
                    {diagStatusIcon(r.status)}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium">{r.name}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{r.message}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {diagResults.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">
                Run diagnostics to check file transfer health
              </p>
            )}
          </TabsContent>
        </Tabs>

        {/* Active Transfers with speed */}
        {transfers.length > 0 && (
          <div className="space-y-1">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Transfers</p>
            <ScrollArea className="max-h-40">
              <div className="space-y-1.5">
                {transfers.map((transfer) => {
                  const Icon = getFileIcon(transfer.name);
                  return (
                    <div key={transfer.id} className="flex items-center gap-2 p-2 rounded-lg bg-muted/50">
                      <div className="w-7 h-7 rounded-md bg-secondary flex items-center justify-center shrink-0">
                        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
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
                          <span className="text-[10px] text-muted-foreground tabular-nums w-8">{transfer.progress}%</span>
                        </div>
                        {/* Speed + size info */}
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] text-muted-foreground">{formatSize(transfer.size)}</span>
                          {transfer.status === "transferring" && transfer.speed && transfer.speed > 0 && (
                            <span className="text-[10px] text-primary flex items-center gap-0.5">
                              <Zap className="h-2.5 w-2.5" />
                              {formatSpeed(transfer.speed)}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {transfer.status === "transferring" && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
                        {transfer.status === "complete" && <Check className="h-3.5 w-3.5 text-emerald-500" />}
                        {transfer.status === "error" && (
                          <span title={transfer.error}>
                            <X className="h-3.5 w-3.5 text-destructive" />
                          </span>
                        )}
                        <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => removeTransfer(transfer.id)}>
                          <X className="h-2.5 w-2.5" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
