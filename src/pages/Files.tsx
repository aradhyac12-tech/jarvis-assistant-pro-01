import { useState, useEffect, useCallback } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { useDeviceContext } from "@/hooks/useDeviceContext";

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
    <DashboardLayout>
      <ScrollArea className="h-[calc(100vh-2rem)]">
        <div className="space-y-4 animate-fade-in pr-4 pt-12 md:pt-0">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold neon-text">Files</h1>
              <p className="text-muted-foreground text-sm">Browse files on your PC</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleGoHome}>
                <Home className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={handleGoUp}>
                <FolderUp className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={() => fetchFiles()} disabled={isLoading}>
                <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
              </Button>
            </div>
          </div>

          {/* Breadcrumb & Search */}
          <Card className="glass-dark border-border/50">
            <CardContent className="p-3">
              <div className="flex flex-col md:flex-row gap-3 items-start md:items-center justify-between">
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground truncate" title={fullPath}>
                    {fullPath || "Loading..."}
                  </p>
                </div>

                <div className="relative w-full md:w-64 shrink-0">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search files..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

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

          {/* Files Grid */}
          <Card className="glass-dark border-border/50">
            <CardContent className="p-4">
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              ) : filteredFiles.length > 0 ? (
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                  {filteredFiles.map((file, index) => {
                    const FileIcon = getFileIcon(file.name, file.is_directory);
                    return (
                      <div
                        key={`${file.name}-${index}`}
                        className="p-3 rounded-lg bg-secondary/30 hover:bg-secondary/50 cursor-pointer transition-all hover-scale text-center group"
                        onClick={() => handleNavigate(file)}
                      >
                        <div className="w-10 h-10 rounded-xl bg-secondary/50 flex items-center justify-center mx-auto mb-2 group-hover:bg-primary/10 transition-colors">
                          <FileIcon
                            className={cn(
                              "h-5 w-5",
                              file.is_directory ? "text-neon-blue" : "text-muted-foreground"
                            )}
                          />
                        </div>
                        <p className="font-medium text-xs truncate" title={file.name}>
                          {file.name}
                        </p>
                        {!file.is_directory && file.size > 0 && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {formatSize(file.size)}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-12">
                  <FolderOpen className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">
                    {files.length === 0 ? "No files in this directory" : "No files match your search"}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </ScrollArea>
    </DashboardLayout>
  );
}
