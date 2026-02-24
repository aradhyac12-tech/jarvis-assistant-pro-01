import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Search,
  FolderOpen,
  File,
  FileText,
  Image,
  Music,
  Video,
  FileCode,
  FileArchive,
  Home,
  Loader2,
  RefreshCw,
  FolderUp,
  ArrowLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { useDeviceContext } from "@/hooks/useDeviceContext";
import { Link } from "react-router-dom";

interface FileItem {
  name: string;
  path: string;
  is_directory: boolean;
  size: number;
  modified: number;
}

const getFileIcon = (name: string, isDirectory: boolean) => {
  if (isDirectory) return FolderOpen;
  
  const ext = name.split('.').pop()?.toLowerCase();
  switch (ext) {
    case "txt":
    case "doc":
    case "docx":
    case "pdf":
      return FileText;
    case "jpg":
    case "jpeg":
    case "png":
    case "gif":
    case "webp":
    case "bmp":
    case "ico":
      return Image;
    case "mp3":
    case "wav":
    case "flac":
    case "m4a":
    case "ogg":
      return Music;
    case "mp4":
    case "mkv":
    case "avi":
    case "mov":
    case "wmv":
      return Video;
    case "js":
    case "ts":
    case "py":
    case "html":
    case "css":
    case "json":
    case "jsx":
    case "tsx":
      return FileCode;
    case "zip":
    case "rar":
    case "7z":
    case "tar":
    case "gz":
      return FileArchive;
    default:
      return File;
  }
};

const formatSize = (bytes: number): string => {
  if (bytes === 0) return "";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
};

export default function Files() {
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPath, setCurrentPath] = useState("~");
  const [fullPath, setFullPath] = useState("");
  const [files, setFiles] = useState<FileItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasFetched, setHasFetched] = useState(false);
  const { toast } = useToast();
  const { sendCommand } = useDeviceCommands();
  const { selectedDevice } = useDeviceContext();

  // Fetch files from PC using awaitResult for reliability
  const fetchFiles = useCallback(async (path: string = currentPath) => {
    if (!selectedDevice?.is_online) {
      toast({ title: "Device Offline", description: "Connect to your PC first.", variant: "destructive" });
      return;
    }

    setIsLoading(true);
    try {
      const result = await sendCommand("list_files", { path }, { awaitResult: true, timeoutMs: 15000 });
      
      if (result.success && "result" in result && result.result) {
        const data = result.result as Record<string, unknown>;
        if (data.items) {
          const items = data.items as FileItem[];
          // Sort: folders first, then alphabetically
          items.sort((a, b) => {
            if (a.is_directory && !b.is_directory) return -1;
            if (!a.is_directory && b.is_directory) return 1;
            return a.name.localeCompare(b.name);
          });
          setFiles(items);
          if (data.current_path) {
            setFullPath(data.current_path as string);
          }
          setHasFetched(true);
        }
      } else {
        toast({ title: "Failed to load files", description: (result as any).error || "Try again.", variant: "destructive" });
      }
    } catch (err) {
      console.error("Failed to fetch files:", err);
      toast({ title: "Error", description: "Could not fetch files.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [currentPath, sendCommand, selectedDevice?.is_online, toast]);

  // Only fetch once on mount or when device comes online
  useEffect(() => {
    if (selectedDevice?.is_online && !hasFetched) {
      fetchFiles();
    }
  }, [selectedDevice?.is_online, hasFetched, fetchFiles]);

  const handleNavigate = async (item: FileItem) => {
    if (item.is_directory) {
      setCurrentPath(item.path);
      await fetchFiles(item.path);
    } else {
      handleOpenFile(item);
    }
  };

  const handleOpenFile = async (file: FileItem) => {
    await sendCommand("open_file", { path: file.path });
    toast({ title: "Opening File", description: `Opening ${file.name}...` });
  };

  const handleGoUp = async () => {
    const parentPath = fullPath.split(/[/\\]/).slice(0, -1).join("/") || "/";
    setCurrentPath(parentPath);
    await fetchFiles(parentPath);
  };

  const handleGoHome = async () => {
    setCurrentPath("~");
    await fetchFiles("~");
  };

  const filteredFiles = files.filter((file) =>
    file.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border/40 bg-background/95 backdrop-blur-sm">
        <div className="flex items-center justify-between h-14 px-4 max-w-4xl mx-auto">
          <div className="flex items-center gap-3">
            <Link to="/hub">
              <Button variant="ghost" size="icon" className="h-9 w-9">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <h1 className="font-semibold text-sm">Files</h1>
              <p className="text-xs text-muted-foreground truncate max-w-[200px]" title={fullPath}>
                {fullPath || "Loading..."}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={handleGoHome}>
              <Home className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={handleGoUp}>
              <FolderUp className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => fetchFiles()} disabled={isLoading}>
              <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
            </Button>
          </div>
        </div>
      </header>

      <ScrollArea className="h-[calc(100vh-3.5rem)]">
        <main className="max-w-4xl mx-auto p-4 space-y-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search files..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>

          {/* Quick Access */}
          <div className="flex gap-2 flex-wrap">
            {[
              { name: "Desktop", path: "~/Desktop" },
              { name: "Documents", path: "~/Documents" },
              { name: "Downloads", path: "~/Downloads" },
              { name: "Pictures", path: "~/Pictures" },
              { name: "Music", path: "~/Music" },
              { name: "Videos", path: "~/Videos" },
            ].map((folder) => (
              <Button
                key={folder.name}
                variant="secondary"
                size="sm"
                className="text-xs"
                onClick={() => {
                  setCurrentPath(folder.path);
                  fetchFiles(folder.path);
                }}
              >
                <FolderOpen className="h-3 w-3 mr-1" />
                {folder.name}
              </Button>
            ))}
          </div>

          {/* Files List */}
          <Card className="border-border/40">
            <CardContent className="p-2">
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              ) : filteredFiles.length > 0 ? (
                <div className="space-y-0.5">
                  {filteredFiles.map((file, index) => {
                    const FileIcon = getFileIcon(file.name, file.is_directory);
                    return (
                      <div
                        key={`${file.name}-${index}`}
                        className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors group"
                        onClick={() => handleNavigate(file)}
                      >
                        <div className={cn(
                          "w-9 h-9 rounded-lg flex items-center justify-center shrink-0",
                          file.is_directory ? "bg-primary/10" : "bg-secondary/50"
                        )}>
                          <FileIcon className={cn("h-4 w-4", file.is_directory ? "text-primary" : "text-muted-foreground")} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{file.name}</p>
                          {!file.is_directory && file.size > 0 && (
                            <p className="text-[10px] text-muted-foreground">{formatSize(file.size)}</p>
                          )}
                        </div>
                        {!file.is_directory && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-[10px] px-2 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                            onClick={(e) => { e.stopPropagation(); handleOpenFile(file); }}
                          >
                            Open on PC
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-12">
                  <FolderOpen className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground text-sm">
                    {files.length === 0 ? "No files in this directory" : "No files match your search"}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </main>
      </ScrollArea>
    </div>
  );
}
