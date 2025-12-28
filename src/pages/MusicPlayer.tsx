import { useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  Search,
  Music,
  Disc3,
  Plus,
  Heart,
  Shuffle,
  Repeat,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

interface Song {
  id: string;
  title: string;
  artist: string;
  duration: string;
  thumbnail?: string;
}

export default function MusicPlayer() {
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(80);
  const [currentTime, setCurrentTime] = useState(0);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const { toast } = useToast();

  const [currentSong, setCurrentSong] = useState<Song | null>({
    id: "1",
    title: "Blinding Lights",
    artist: "The Weeknd",
    duration: "3:20",
  });

  const [searchResults, setSearchResults] = useState<Song[]>([]);
  const [queue, setQueue] = useState<Song[]>([
    { id: "2", title: "Starboy", artist: "The Weeknd", duration: "3:50" },
    { id: "3", title: "Save Your Tears", artist: "The Weeknd", duration: "3:35" },
    { id: "4", title: "Die For You", artist: "The Weeknd", duration: "3:10" },
  ]);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    // Simulate search results
    setTimeout(() => {
      setSearchResults([
        { id: "s1", title: searchQuery, artist: "Artist 1", duration: "3:45" },
        { id: "s2", title: `${searchQuery} Remix`, artist: "Artist 2", duration: "4:12" },
        { id: "s3", title: `Best of ${searchQuery}`, artist: "Various Artists", duration: "5:20" },
      ]);
      setIsSearching(false);
    }, 1000);
  };

  const handlePlay = (song: Song) => {
    setCurrentSong(song);
    setIsPlaying(true);
    toast({ title: "Now Playing", description: `${song.title} - ${song.artist}` });
  };

  const handleAddToQueue = (song: Song) => {
    setQueue((prev) => [...prev, song]);
    toast({ title: "Added to Queue", description: song.title });
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold neon-text">Music Player</h1>
          <p className="text-muted-foreground">Search and play music on your PC</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Now Playing */}
          <Card className="lg:col-span-2 glass-dark border-border/50 overflow-hidden">
            <CardContent className="p-6">
              <div className="flex flex-col md:flex-row gap-6">
                {/* Album Art */}
                <div className="w-full md:w-64 aspect-square rounded-2xl gradient-primary flex items-center justify-center flex-shrink-0 relative overflow-hidden">
                  <Disc3 className={cn("w-32 h-32 text-primary-foreground", isPlaying && "animate-spin-slow")} />
                  <div className="absolute inset-0 bg-gradient-to-t from-background/80 to-transparent" />
                </div>

                <div className="flex-1 flex flex-col justify-between">
                  <div>
                    <h2 className="text-2xl font-bold mb-1">{currentSong?.title || "No song playing"}</h2>
                    <p className="text-muted-foreground text-lg">{currentSong?.artist || "Select a song to play"}</p>
                  </div>

                  {/* Progress Bar */}
                  <div className="space-y-2 my-6">
                    <Slider value={[currentTime]} max={100} step={1} className="cursor-pointer" />
                    <div className="flex justify-between text-sm text-muted-foreground">
                      <span>1:23</span>
                      <span>{currentSong?.duration || "0:00"}</span>
                    </div>
                  </div>

                  {/* Controls */}
                  <div className="flex items-center justify-between">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setShuffle(!shuffle)}
                      className={cn(shuffle && "text-primary")}
                    >
                      <Shuffle className="h-5 w-5" />
                    </Button>

                    <div className="flex items-center gap-2">
                      <Button variant="ghost" size="icon">
                        <SkipBack className="h-5 w-5" />
                      </Button>
                      <Button
                        size="icon"
                        className="h-14 w-14 rounded-full gradient-primary pulse-neon"
                        onClick={() => setIsPlaying(!isPlaying)}
                      >
                        {isPlaying ? (
                          <Pause className="h-6 w-6 text-primary-foreground" />
                        ) : (
                          <Play className="h-6 w-6 text-primary-foreground ml-1" />
                        )}
                      </Button>
                      <Button variant="ghost" size="icon">
                        <SkipForward className="h-5 w-5" />
                      </Button>
                    </div>

                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setRepeat(!repeat)}
                      className={cn(repeat && "text-primary")}
                    >
                      <Repeat className="h-5 w-5" />
                    </Button>
                  </div>

                  {/* Volume */}
                  <div className="flex items-center gap-3 mt-4">
                    <Volume2 className="h-5 w-5 text-muted-foreground" />
                    <Slider
                      value={[volume]}
                      onValueChange={(v) => setVolume(v[0])}
                      max={100}
                      className="w-32 cursor-pointer"
                    />
                    <span className="text-sm text-muted-foreground w-8">{volume}%</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Queue */}
          <Card className="glass-dark border-border/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Music className="h-5 w-5 text-primary" />
                Up Next
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[300px]">
                <div className="p-4 space-y-2">
                  {queue.map((song, index) => (
                    <div
                      key={song.id}
                      className="flex items-center gap-3 p-3 rounded-lg hover:bg-secondary/50 cursor-pointer transition-colors group"
                      onClick={() => handlePlay(song)}
                    >
                      <span className="text-sm text-muted-foreground w-6">{index + 1}</span>
                      <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center flex-shrink-0">
                        <Music className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{song.title}</p>
                        <p className="text-sm text-muted-foreground truncate">{song.artist}</p>
                      </div>
                      <span className="text-sm text-muted-foreground">{song.duration}</span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>

        {/* Search */}
        <Card className="glass-dark border-border/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Search className="h-5 w-5 text-primary" />
              Search Songs
            </CardTitle>
            <CardDescription>Search for songs to play on your PC</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-3 mb-4">
              <Input
                placeholder="Search for a song..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                className="flex-1"
              />
              <Button onClick={handleSearch} className="gradient-primary" disabled={isSearching}>
                {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              </Button>
            </div>

            {searchResults.length > 0 && (
              <div className="space-y-2">
                {searchResults.map((song) => (
                  <div
                    key={song.id}
                    className="flex items-center gap-3 p-3 rounded-lg bg-secondary/30 hover:bg-secondary/50 transition-colors"
                  >
                    <div className="w-12 h-12 rounded-lg bg-secondary flex items-center justify-center flex-shrink-0">
                      <Music className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{song.title}</p>
                      <p className="text-sm text-muted-foreground truncate">{song.artist}</p>
                    </div>
                    <span className="text-sm text-muted-foreground">{song.duration}</span>
                    <div className="flex gap-2">
                      <Button variant="ghost" size="icon" onClick={() => handlePlay(song)}>
                        <Play className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleAddToQueue(song)}>
                        <Plus className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon">
                        <Heart className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
