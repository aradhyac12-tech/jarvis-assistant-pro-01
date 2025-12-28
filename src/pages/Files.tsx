import { useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
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
  ChevronRight,
  Home,
  Upload,
  Download,
  Trash2,
  MoreVertical,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

interface FileItem {
  id: string;
  name: string;
  type: "folder" | "file";
  extension?: string;
  size?: string;
  modified?: string;
}

const getFileIcon = (extension?: string) => {
  switch (extension) {
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
      return Image;
    case "mp3":
    case "wav":
    case "flac":
      return Music;
    case "mp4":
    case "mkv":
    case "avi":
      return Video;
    case "js":
    case "ts":
    case "py":
    case "html":
    case "css":
      return FileCode;
    case "zip":
    case "rar":
    case "7z":
      return FileArchive;
    default:
      return File;
  }
};

export default function Files() {
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPath, setCurrentPath] = useState<string[]>(["Home"]);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const [files] = useState<FileItem[]>([
    { id: "1", name: "Documents", type: "folder" },
    { id: "2", name: "Downloads", type: "folder" },
    { id: "3", name: "Pictures", type: "folder" },
    { id: "4", name: "Music", type: "folder" },
    { id: "5", name: "Videos", type: "folder" },
    { id: "6", name: "Desktop", type: "folder" },
    { id: "7", name: "project.pdf", type: "file", extension: "pdf", size: "2.4 MB", modified: "Dec 28, 2024" },
    { id: "8", name: "notes.txt", type: "file", extension: "txt", size: "12 KB", modified: "Dec 27, 2024" },
    { id: "9", name: "photo.jpg", type: "file", extension: "jpg", size: "4.1 MB", modified: "Dec 26, 2024" },
    { id: "10", name: "song.mp3", type: "file", extension: "mp3", size: "8.2 MB", modified: "Dec 25, 2024" },
  ]);

  const filteredFiles = files.filter((file) =>
    file.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleNavigate = (item: FileItem) => {
    if (item.type === "folder") {
      setCurrentPath((prev) => [...prev, item.name]);
    } else {
      handleOpenFile(item);
    }
  };

  const handleOpenFile = async (file: FileItem) => {
    toast({ title: "Opening File", description: `Opening ${file.name}...` });
  };

  const handleBreadcrumbClick = (index: number) => {
    setCurrentPath((prev) => prev.slice(0, index + 1));
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold neon-text">Files</h1>
            <p className="text-muted-foreground">Browse and manage files on your PC</p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary">
              <Upload className="h-4 w-4 mr-2" /> Upload
            </Button>
            <Button variant="secondary">
              <Download className="h-4 w-4 mr-2" /> Download
            </Button>
          </div>
        </div>

        {/* Breadcrumb & Search */}
        <Card className="glass-dark border-border/50">
          <CardContent className="p-4">
            <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
              <Breadcrumb>
                <BreadcrumbList>
                  {currentPath.map((path, index) => (
                    <BreadcrumbItem key={index}>
                      {index === 0 ? (
                        <BreadcrumbLink
                          className="flex items-center gap-1 cursor-pointer hover:text-primary"
                          onClick={() => handleBreadcrumbClick(index)}
                        >
                          <Home className="h-4 w-4" />
                          {path}
                        </BreadcrumbLink>
                      ) : (
                        <>
                          <BreadcrumbSeparator />
                          <BreadcrumbLink
                            className="cursor-pointer hover:text-primary"
                            onClick={() => handleBreadcrumbClick(index)}
                          >
                            {path}
                          </BreadcrumbLink>
                        </>
                      )}
                    </BreadcrumbItem>
                  ))}
                </BreadcrumbList>
              </Breadcrumb>

              <div className="relative w-full md:w-64">
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

        {/* Files Grid */}
        <Card className="glass-dark border-border/50">
          <CardContent className="p-4">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {filteredFiles.map((file) => {
                  const FileIcon = file.type === "folder" ? FolderOpen : getFileIcon(file.extension);
                  return (
                    <div
                      key={file.id}
                      className="p-4 rounded-lg bg-secondary/30 hover:bg-secondary/50 cursor-pointer transition-all hover-scale text-center group"
                      onDoubleClick={() => handleNavigate(file)}
                    >
                      <div className="w-12 h-12 rounded-xl bg-secondary/50 flex items-center justify-center mx-auto mb-3 group-hover:bg-primary/10 transition-colors">
                        <FileIcon
                          className={cn(
                            "h-6 w-6",
                            file.type === "folder" ? "text-neon-blue" : "text-muted-foreground"
                          )}
                        />
                      </div>
                      <p className="font-medium text-sm truncate">{file.name}</p>
                      {file.size && (
                        <p className="text-xs text-muted-foreground mt-1">{file.size}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {filteredFiles.length === 0 && !isLoading && (
              <div className="text-center py-12">
                <FolderOpen className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">No files found</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
