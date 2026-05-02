import { useState, useRef, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  FolderOpen, Upload, Download, File, Image, Video, Music, FileText,
  X, Check, Loader2, Wifi, ArrowUpDown, RefreshCw,
  Zap, Stethoscope, CheckCircle, XCircle, Globe, WifiOff, AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";

/** Save a Blob to device storage — uses Capacitor Filesystem on native, anchor-click on web */
async function saveBlobToDevice(blob: Blob, fileName: string): Promise<void> {
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (Capacitor.isNativePlatform()) {
      const { Filesystem, Directory } = await import("@capacitor/filesystem");
      const arrayBuffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = "";
      for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
      const base64 = btoa(binary);
      await Filesystem.writeFile({
        path: `Download/${fileName}`,
        data: base64,
        directory: Directory.ExternalStorage,
        recursive: true,
      });
      return;
    }
  } catch {
    // Not native or Filesystem not available — fall through to web download
  }
  // Web: anchor click
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = fileName;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
import { useDeviceContext } from "@/hooks/useDeviceContext";
import { useDeviceSession } from "@/hooks/useDeviceSession";
import { supabase } from "@/integrations/supabase/client";

interface FileTransferItem {
  id: string;
  name: string;
  size: number;
  direction: "phone_to_pc" | "pc_to_phone";
  progress: number;
  status: "pending" | "transferring" | "complete" | "error";
  error?: string;
  speed?: number;
  speedMbps?: number;
  startTime?: number;
  method?: "p2p-binary" | "p2p" | "relay" | "cloud";
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

// P2P binary transfer chunk size: 2MB for max throughput
const P2P_CHUNK_SIZE = 2 * 1024 * 1024;

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
  const [connectionMethod, setConnectionMethod] = useState<"detecting" | "p2p" | "cloud">("detecting");

  const fileInputRef = useRef<HTMLInputElement>(null);

  const isConnected = selectedDevice?.is_online || false;
  const isSameNetwork = localStorage.getItem("jarvis_p2p_connected") === "true";
  const p2pIp = localStorage.getItem("jarvis_p2p_known_ip");
  const p2pPort = localStorage.getItem("jarvis_p2p_port") || "9876";

  // Detect connection method
  useEffect(() => {
    if (!isConnected) { setConnectionMethod("detecting"); return; }
    setConnectionMethod("detecting");
    const timer = setTimeout(() => {
      setConnectionMethod(isSameNetwork && p2pIp ? "p2p" : "cloud");
    }, 500);
    return () => clearTimeout(timer);
  }, [isConnected, isSameNetwork, p2pIp]);

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
    const mbps = (bytesPerSec * 8) / 1_000_000;
    if (mbps >= 1) return `${mbps.toFixed(1)} Mbps`;
    return formatSize(bytesPerSec) + "/s";
  };

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
  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(true); }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(false); }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setIsDragOver(false);
    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;
    if (!isConnected) {
      toast({ title: "Not connected", description: "Connect to PC first.", variant: "destructive" });
      return;
    }
    Array.from(files).forEach((file) => {
      const transferId = crypto.randomUUID();
      setTransfers(prev => [...prev, { id: transferId, name: file.name, size: file.size, direction: "phone_to_pc", progress: 0, status: "pending" }]);
      uploadFile(file, transferId);
    });
  }, [isConnected]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    Array.from(files).forEach((file) => {
      const transferId = crypto.randomUUID();
      setTransfers(prev => [...prev, { id: transferId, name: file.name, size: file.size, direction: "phone_to_pc", progress: 0, status: "pending" }]);
      uploadFile(file, transferId);
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  // ========== HIGH-SPEED P2P BINARY UPLOAD ==========
  const uploadFileP2PBinary = useCallback(async (file: File, transferId: string) => {
    const startTime = Date.now();
    setTransfers(prev => prev.map(t => t.id === transferId
      ? { ...t, status: "transferring" as const, startTime, method: "p2p-binary" as const }
      : t));

    return new Promise<void>((resolve, reject) => {
      const saveFolder = encodeURIComponent(pcSavePath || "");
      const fileName = encodeURIComponent(file.name);
      const wsUrl = `ws://${p2pIp}:${p2pPort}/file-upload?fileName=${fileName}&fileSize=${file.size}&saveFolder=${saveFolder}`;
      
      const ws = new WebSocket(wsUrl);
      ws.binaryType = "arraybuffer";
      let sentBytes = 0;
      let sending = false;

      const sendChunks = async () => {
        if (sending) return;
        sending = true;
        const reader = file.stream().getReader();
        const buffer: Uint8Array[] = [];
        let bufferSize = 0;

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              // Flush remaining buffer
              if (bufferSize > 0) {
                const merged = mergeBuffers(buffer, bufferSize);
                ws.send(merged.buffer as ArrayBuffer);
                sentBytes += bufferSize;
                updateProgress(sentBytes, file.size, startTime, transferId);
              }
              break;
            }
            
            buffer.push(value);
            bufferSize += value.byteLength;
            
            // Send when we have >= 2MB
            if (bufferSize >= P2P_CHUNK_SIZE) {
              const merged = mergeBuffers(buffer, bufferSize);
              ws.send(merged.buffer as ArrayBuffer);
              sentBytes += bufferSize;
              updateProgress(sentBytes, file.size, startTime, transferId);
              buffer.length = 0;
              bufferSize = 0;
              
              // Small yield to let acks flow through
              await new Promise(r => setTimeout(r, 1));
            }
          }
          
          // Signal done
          ws.send(JSON.stringify({ type: "done" }));
        } catch (err) {
          reject(err);
        }
      };

      ws.onopen = () => {
        // Wait for ready signal
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data as string);
          if (data.type === "ready") {
            sendChunks();
          } else if (data.ack !== undefined) {
            // Speed update from server
            if (data.speed_mbps) {
              setTransfers(prev => prev.map(t => t.id === transferId
                ? { ...t, speedMbps: data.speed_mbps }
                : t));
            }
          } else if (data.complete) {
            setTransfers(prev => prev.map(t => t.id === transferId
              ? { ...t, status: "complete" as const, progress: 100, speedMbps: data.speed_mbps }
              : t));
            toast({ title: "Upload complete", description: `${file.name} at ${data.speed_mbps} Mbps` });
            ws.close();
            resolve();
          } else if (data.error) {
            throw new Error(data.error);
          }
        } catch (err) {
          if (err instanceof Error && err.message) {
            reject(err);
          }
        }
      };

      ws.onerror = () => {
        reject(new Error("P2P WebSocket connection failed"));
      };

      ws.onclose = () => {
        // If not completed, it's an error
      };
    });
  }, [p2pIp, p2pPort, pcSavePath, toast]);

  // ========== HIGH-SPEED P2P BINARY DOWNLOAD ==========
  const downloadFileP2PBinary = useCallback(async (pcFile: PCFile, transferId: string) => {
    const startTime = Date.now();
    setTransfers(prev => prev.map(t => t.id === transferId
      ? { ...t, status: "transferring" as const, startTime, method: "p2p-binary" as const }
      : t));

    return new Promise<void>((resolve, reject) => {
      const filePath = encodeURIComponent(pcFile.path);
      const wsUrl = `ws://${p2pIp}:${p2pPort}/file-download?path=${filePath}`;
      
      const ws = new WebSocket(wsUrl);
      ws.binaryType = "arraybuffer";
      const chunks: ArrayBuffer[] = [];
      let receivedBytes = 0;
      let totalSize = pcFile.size;
      let fileName = pcFile.name;

      ws.onmessage = async (event) => {
        if (event.data instanceof ArrayBuffer) {
          chunks.push(event.data);
          receivedBytes += event.data.byteLength;
          updateProgress(receivedBytes, totalSize, startTime, transferId);
        } else {
          try {
            const data = JSON.parse(event.data as string);
            if (data.type === "header") {
              totalSize = data.fileSize;
              fileName = data.fileName;
              // Send ready
              ws.send(JSON.stringify({ type: "ready" }));
            } else if (data.complete) {
              // Assemble and save to device
              const blob = new Blob(chunks);
              await saveBlobToDevice(blob, fileName);

              setTransfers(prev => prev.map(t => t.id === transferId
                ? { ...t, status: "complete" as const, progress: 100, speedMbps: data.speed_mbps, size: data.size }
                : t));
              toast({ title: "Download complete", description: `${fileName} at ${data.speed_mbps} Mbps` });
              ws.close();
              resolve();
            } else if (data.error) {
              throw new Error(data.error);
            }
          } catch (err) {
            if (err instanceof Error && err.message) reject(err);
          }
        }
      };

      ws.onerror = () => reject(new Error("P2P WebSocket connection failed"));
    });
  }, [p2pIp, p2pPort, toast]);

  // Helper: merge typed array buffers
  function mergeBuffers(buffers: Uint8Array[], totalLength: number): Uint8Array {
    const merged = new Uint8Array(totalLength);
    let offset = 0;
    for (const buf of buffers) {
      merged.set(buf, offset);
      offset += buf.byteLength;
    }
    return merged;
  }

  // Helper: update transfer progress
  function updateProgress(bytesTransferred: number, totalSize: number, startTime: number, transferId: string) {
    const elapsed = (Date.now() - startTime) / 1000;
    const speed = elapsed > 0 ? bytesTransferred / elapsed : 0;
    const progress = totalSize > 0 ? Math.round((bytesTransferred / totalSize) * 100) : 0;
    setTransfers(prev => prev.map(t => t.id === transferId
      ? { ...t, progress: Math.min(progress, 99), speed }
      : t));
  }

  // ========== UPLOAD DISPATCHER ==========
  const uploadFile = useCallback(async (file: File, transferId: string) => {
    if (!isConnected) {
      setTransfers(prev => prev.map(t => t.id === transferId ? { ...t, status: "error" as const, error: "Not connected" } : t));
      return;
    }

    try {
      // P2P binary is fastest — try it first if on same network
      if (isSameNetwork && p2pIp) {
        try {
          await uploadFileP2PBinary(file, transferId);
          return;
        } catch (e) {
          console.warn("[FileTransfer] P2P binary failed, falling back:", e);
        }
      }

      // Fallback: cloud storage relay for any network
      await uploadFileCloud(file, transferId);
    } catch (err) {
      const error = err instanceof Error ? err.message : "Upload failed";
      setTransfers(prev => prev.map(t => t.id === transferId ? { ...t, status: "error" as const, error } : t));
      toast({ title: "Upload failed", description: error, variant: "destructive" });
    }
  }, [isConnected, isSameNetwork, p2pIp, uploadFileP2PBinary]);

  // ========== CLOUD UPLOAD (any network) ==========
  const uploadFileCloud = useCallback(async (file: File, transferId: string) => {
    const startTime = Date.now();
    setTransfers(prev => prev.map(t => t.id === transferId
      ? { ...t, status: "transferring" as const, startTime, method: "cloud" as const }
      : t));

    const filePath = `transfers/${crypto.randomUUID()}/${file.name}`;

    const { error } = await supabase.storage
      .from("agent-files")
      .upload(filePath, file, { upsert: true });
    if (error) throw new Error(error.message);

    setTransfers(prev => prev.map(t => t.id === transferId ? { ...t, progress: 60 } : t));

    const { data: urlData } = await supabase.storage
      .from("agent-files")
      .createSignedUrl(filePath, 3600);
    if (!urlData?.signedUrl) throw new Error("Failed to get download URL");

    setTransfers(prev => prev.map(t => t.id === transferId ? { ...t, progress: 70 } : t));

    const result = await sendCommand("download_from_url", {
      url: urlData.signedUrl,
      file_name: file.name,
      save_folder: pcSavePath || "",
    }, { awaitResult: true, timeoutMs: 300000 });

    if (!result?.success) throw new Error((result?.error as string) || "Agent download failed");

    supabase.storage.from("agent-files").remove([filePath]).catch(() => {});

    const elapsed = (Date.now() - startTime) / 1000;
    const speed = file.size / elapsed;
    setTransfers(prev => prev.map(t => t.id === transferId
      ? { ...t, status: "complete" as const, progress: 100, speed }
      : t));
    toast({ title: "Upload complete", description: `${file.name} (${formatSize(file.size)})` });
  }, [sendCommand, pcSavePath, toast]);

  // ========== DOWNLOAD DISPATCHER ==========
  const downloadFileFromPC = useCallback(async (pcFile: PCFile) => {
    if (!isConnected || pcFile.is_directory) {
      if (pcFile.is_directory) browsePCFiles(pcFile.path);
      return;
    }

    const transferId = crypto.randomUUID();
    setTransfers(prev => [...prev, {
      id: transferId, name: pcFile.name, size: pcFile.size, direction: "pc_to_phone",
      progress: 0, status: "pending",
    }]);

    try {
      // P2P binary first
      if (isSameNetwork && p2pIp) {
        try {
          await downloadFileP2PBinary(pcFile, transferId);
          return;
        } catch (e) {
          console.warn("[FileTransfer] P2P binary download failed, falling back:", e);
        }
      }

      // Fallback: cloud relay
      await downloadFileCloud(pcFile, transferId);
    } catch (err) {
      const error = err instanceof Error ? err.message : "Download failed";
      setTransfers(prev => prev.map(t => t.id === transferId ? { ...t, status: "error" as const, error } : t));
      toast({ title: "Download failed", description: error, variant: "destructive" });
    }
  }, [isConnected, isSameNetwork, p2pIp, downloadFileP2PBinary, browsePCFiles, toast]);

  // ========== CLOUD DOWNLOAD ==========
  const downloadFileCloud = useCallback(async (pcFile: PCFile, transferId: string) => {
    const startTime = Date.now();
    setTransfers(prev => prev.map(t => t.id === transferId
      ? { ...t, status: "transferring" as const, startTime, method: "cloud" as const }
      : t));

    const filePath = `transfers/${crypto.randomUUID()}/${pcFile.name}`;

    const result = await sendCommand("upload_to_url", {
      file_path: pcFile.path,
      upload_path: filePath,
    }, { awaitResult: true, timeoutMs: 300000 });

    if (!result?.success) throw new Error((result?.error as string) || "Agent upload failed");
    setTransfers(prev => prev.map(t => t.id === transferId ? { ...t, progress: 50 } : t));

    const { data: downloadData, error } = await supabase.storage
      .from("agent-files")
      .download(filePath);
    if (error || !downloadData) throw new Error(error?.message || "Download failed");

    await saveBlobToDevice(downloadData, pcFile.name);

    supabase.storage.from("agent-files").remove([filePath]).catch(() => {});

    const elapsed = (Date.now() - startTime) / 1000;
    const speed = pcFile.size / elapsed;
    setTransfers(prev => prev.map(t => t.id === transferId
      ? { ...t, status: "complete" as const, progress: 100, speed }
      : t));
    toast({ title: "Download complete", description: `${pcFile.name} (${formatSize(pcFile.size)})` });
  }, [sendCommand, toast]);

  const navigateUp = useCallback(() => {
    const parts = pcBrowsePath.split(/[/\\]/);
    parts.pop();
    browsePCFiles(parts.join("/") || "/");
  }, [pcBrowsePath, browsePCFiles]);

  const removeTransfer = useCallback((id: string) => {
    setTransfers(prev => prev.filter(t => t.id !== id));
  }, []);

  // === DIAGNOSTICS ===
  const runDiagnostics = useCallback(async () => {
    setDiagRunning(true);
    const results: DiagResult[] = [];

    results.push({ name: "Device Connection", status: isConnected ? "pass" : "fail", message: isConnected ? "PC is online" : "PC is offline" });
    setDiagResults([...results]);
    if (!isConnected) { setDiagRunning(false); return; }

    results.push({ name: "Network Mode", status: "pass", message: isSameNetwork ? `Same network (P2P via ${p2pIp})` : "Different network (cloud relay)" });
    setDiagResults([...results]);

    // P2P binary speed test
    if (isSameNetwork && p2pIp) {
      results.push({ name: "P2P Binary Transfer", status: "running", message: "Testing speed..." });
      setDiagResults([...results]);
      try {
        const testSize = 4 * 1024 * 1024; // 4MB test
        const testData = new Uint8Array(testSize);
        for (let i = 0; i < testSize; i += 65536) {
          const chunk = Math.min(65536, testSize - i);
          crypto.getRandomValues(testData.subarray(i, i + chunk));
        }
        const testFile = new Blob([testData]);
        const start = Date.now();

        await new Promise<void>((resolve, reject) => {
          const wsUrl = `ws://${p2pIp}:${p2pPort}/file-upload?fileName=_speed_test.bin&fileSize=${testSize}&saveFolder=`;
          const ws = new WebSocket(wsUrl);
          ws.binaryType = "arraybuffer";
          let done = false;
          ws.onmessage = (event) => {
            const data = JSON.parse(event.data as string);
            if (data.type === "ready") {
              ws.send(testData.buffer as ArrayBuffer);
              ws.send(JSON.stringify({ type: "done" }));
            } else if (data.complete) {
              done = true;
              ws.close();
              resolve();
            } else if (data.error) {
              reject(new Error(data.error));
            }
          };
          ws.onerror = () => reject(new Error("WS failed"));
          setTimeout(() => { if (!done) { ws.close(); reject(new Error("Timeout")); } }, 10000);
        });

        const elapsed = (Date.now() - start) / 1000;
        const mbps = (testSize * 8 / 1_000_000) / elapsed;
        results[results.length - 1] = {
          name: "P2P Binary Transfer",
          status: mbps >= 10 ? "pass" : "warn",
          message: `${mbps.toFixed(1)} Mbps (${(testSize / elapsed / (1024 * 1024)).toFixed(1)} MB/s)`,
        };
      } catch (e) {
        results[results.length - 1] = { name: "P2P Binary Transfer", status: "fail", message: `Failed: ${e}` };
      }
      setDiagResults([...results]);
    }

    // Agent ping
    results.push({ name: "Agent Ping", status: "running", message: "Pinging..." });
    setDiagResults([...results]);
    try {
      const pingStart = Date.now();
      const pingResult = await sendCommand("get_system_stats", {}, { awaitResult: true, timeoutMs: 5000 });
      const pingMs = Date.now() - pingStart;
      results[results.length - 1] = { name: "Agent Ping", status: pingResult.success ? "pass" : "fail", message: pingResult.success ? `${pingMs}ms` : "No response" };
    } catch {
      results[results.length - 1] = { name: "Agent Ping", status: "fail", message: "Timed out" };
    }
    setDiagResults([...results]);

    // Cloud storage
    results.push({ name: "Cloud Storage", status: "running", message: "Testing..." });
    setDiagResults([...results]);
    try {
      const testFile = new Blob(["test"]);
      const { error } = await supabase.storage.from("agent-files").upload("_diag_test", testFile, { upsert: true });
      if (error) throw error;
      await supabase.storage.from("agent-files").remove(["_diag_test"]);
      results[results.length - 1] = { name: "Cloud Storage", status: "pass", message: "Upload/download works" };
    } catch {
      results[results.length - 1] = { name: "Cloud Storage", status: "warn", message: "Cloud storage unavailable" };
    }
    setDiagResults([...results]);
    setDiagRunning(false);
  }, [isConnected, sendCommand, isSameNetwork, p2pIp, p2pPort]);

  const diagStatusIcon = (s: DiagResult["status"]) => {
    switch (s) {
      case "pass": return <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />;
      case "fail": return <XCircle className="h-3.5 w-3.5 text-destructive" />;
      case "warn": return <AlertTriangle className="h-3.5 w-3.5 text-yellow-500" />;
      case "running": return <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />;
    }
  };

  const ConnectionIcon = connectionMethod === "p2p" ? Wifi : connectionMethod === "cloud" ? Globe : WifiOff;

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
              <CardDescription className="text-xs">
                {connectionMethod === "p2p" ? "P2P Binary • 10-20 Mbps" : "Any network • No size limit"}
              </CardDescription>
            </div>
          </div>
          <Badge
            variant={isConnected ? "secondary" : "destructive"}
            className={cn("text-xs", connectionMethod === "detecting" && "animate-pulse")}
          >
            <ConnectionIcon className="h-3 w-3 mr-1" />
            {connectionMethod === "detecting" ? "Detecting..." : connectionMethod === "p2p" ? "⚡ LAN" : isConnected ? "Cloud" : "Offline"}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "upload" | "download" | "diag")}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="upload" className="text-xs gap-1"><Upload className="h-3 w-3" />Upload</TabsTrigger>
            <TabsTrigger value="download" className="text-xs gap-1"><Download className="h-3 w-3" />Download</TabsTrigger>
            <TabsTrigger value="diag" className="text-xs gap-1"><Stethoscope className="h-3 w-3" />Diagnose</TabsTrigger>
          </TabsList>

          <TabsContent value="upload" className="space-y-3 mt-3">
            <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileSelect} />
            <div
              onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "w-full h-24 border-2 border-dashed rounded-lg flex flex-col items-center justify-center gap-2 cursor-pointer transition-all",
                isDragOver ? "border-primary bg-primary/10 scale-[1.02]" : "border-border/50 hover:border-primary/50 hover:bg-muted/30",
                !isConnected && "opacity-50 pointer-events-none"
              )}
            >
              <Upload className={cn("h-6 w-6", isDragOver ? "text-primary" : "text-muted-foreground")} />
              <span className="text-xs text-muted-foreground">
                {isDragOver ? "Drop files here!" : connectionMethod === "p2p" ? "Drop files • P2P Binary ⚡" : "Drag & drop or tap to select"}
              </span>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground">PC save folder (empty = Downloads/Jarvis)</label>
              <div className="flex gap-2">
                <Input value={pcSavePath} onChange={(e) => setPcSavePath(e.target.value)} placeholder="~/Downloads/Jarvis" className="flex-1 text-xs h-8 font-mono" disabled={!isConnected} />
                <Button variant="outline" size="sm" className="h-8 px-2" onClick={() => setPcSavePath("")}>
                  <FolderOpen className="h-3 w-3" />
                </Button>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="download" className="space-y-3 mt-3">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="h-8 px-2" onClick={navigateUp} disabled={!isConnected}>..</Button>
              <Input value={pcBrowsePath} onChange={(e) => setPcBrowsePath(e.target.value)} onKeyDown={(e) => e.key === "Enter" && browsePCFiles(pcBrowsePath)} placeholder="PC path" className="flex-1 text-xs h-8 font-mono" disabled={!isConnected} />
              <Button variant="outline" size="sm" className="h-8 px-2" onClick={() => browsePCFiles(pcBrowsePath)} disabled={!isConnected || isLoadingFiles}>
                {isLoadingFiles ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              </Button>
            </div>
            <ScrollArea className="h-36 border rounded-lg">
              <div className="p-1.5 space-y-0.5">
                {pcFiles.length === 0 && !isLoadingFiles && <p className="text-xs text-muted-foreground text-center py-4">No files found</p>}
                {pcFiles.map((file, i) => {
                  const Icon = getFileIcon(file.name, file.is_directory);
                  return (
                    <button key={i} onClick={() => downloadFileFromPC(file)} className="w-full flex items-center gap-2 p-2 rounded-md hover:bg-muted/50 text-left text-xs transition-colors">
                      <Icon className={cn("h-4 w-4 shrink-0", file.is_directory ? "text-primary" : "text-muted-foreground")} />
                      <span className="flex-1 truncate">{file.name}</span>
                      {!file.is_directory && <span className="text-muted-foreground tabular-nums">{formatSize(file.size)}</span>}
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="diag" className="space-y-3 mt-3">
            <Button onClick={runDiagnostics} disabled={diagRunning} variant="outline" className="w-full h-9 text-xs gap-2">
              {diagRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Stethoscope className="h-3.5 w-3.5" />}
              {diagRunning ? "Running..." : "Run Diagnostics"}
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
            {diagResults.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">Run diagnostics to check transfer speed</p>}
          </TabsContent>
        </Tabs>

        {/* Active Transfers */}
        {transfers.length > 0 && (
          <div className="space-y-1">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Transfers</p>
            <ScrollArea className="max-h-48">
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
                          {transfer.method && (
                            <Badge variant="secondary" className="text-[8px] px-1 py-0">
                              {transfer.method === "p2p-binary" ? "⚡ P2P" : transfer.method === "cloud" ? "☁" : "⚡"}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <Progress value={transfer.progress} className="h-1 flex-1" />
                          <span className="text-[10px] text-muted-foreground tabular-nums w-8">{transfer.progress}%</span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] text-muted-foreground">{formatSize(transfer.size)}</span>
                          {transfer.status === "transferring" && transfer.speed && transfer.speed > 0 && (
                            <span className="text-[10px] text-primary flex items-center gap-0.5">
                              <Zap className="h-2.5 w-2.5" />{formatSpeed(transfer.speed)}
                            </span>
                          )}
                          {transfer.speedMbps && transfer.speedMbps > 0 && (
                            <span className="text-[10px] text-emerald-500 font-medium">
                              {transfer.speedMbps} Mbps
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {transfer.status === "transferring" && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
                        {transfer.status === "complete" && <Check className="h-3.5 w-3.5 text-emerald-500" />}
                        {transfer.status === "error" && <span title={transfer.error}><X className="h-3.5 w-3.5 text-destructive" /></span>}
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
