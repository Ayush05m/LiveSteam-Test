import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Volume2, VolumeX, Maximize, Play, Pause, Settings } from "lucide-react";
import { Slider } from "@/components/ui/slider";

interface StreamPlayerProps {
  src: string;
  poster?: string;
  onJumpToLive?: (callback: () => void) => void;
}

const StreamPlayer: React.FC<StreamPlayerProps> = ({ src, poster, onJumpToLive }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hls, setHls] = useState<Hls | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [levels, setLevels] = useState<{ id: number; height: number; bitrate: number }[]>([]);
  const [currentLevel, setCurrentLevel] = useState<string>("auto");
  const [currentSegment, setCurrentSegment] = useState<number>(0);
  const [latency, setLatency] = useState<number>(0);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Jump to live edge function - improved
  const jumpToLive = () => {
    if (hls && videoRef.current) {
      // Get the most accurate live position
      const targetLatency = hls.targetLatency || 1;
      const liveSyncPos = hls.liveSyncPosition;

      if (liveSyncPos !== null && liveSyncPos !== undefined) {
        // Jump to live edge minus target latency
        const newTime = Math.max(0, liveSyncPos - targetLatency);
        videoRef.current.currentTime = newTime;
        console.log(`Jumped to live edge: ${newTime.toFixed(2)}s (liveSyncPos: ${liveSyncPos.toFixed(2)}s)`);
      }
    } else if (videoRef.current && videoRef.current.duration && !isNaN(videoRef.current.duration)) {
      // Fallback for native HLS
      const newTime = Math.max(0, videoRef.current.duration - 1);
      videoRef.current.currentTime = newTime;
      console.log(`Jumped to live edge (native): ${newTime.toFixed(2)}s`);
    }
  };

  // Expose jumpToLive to parent component
  useEffect(() => {
    if (onJumpToLive) {
      onJumpToLive(jumpToLive);
    }
  }, [hls, onJumpToLive]);

  useEffect(() => {
    if (Hls.isSupported() && videoRef.current) {
      const newHls = new Hls({
        // LL-HLS Low-Latency Configuration
        lowLatencyMode: true,

        // Aggressive buffering for minimal latency
        maxBufferLength: 3,           // Max 3 seconds of buffer (reduced from 4s)
        maxMaxBufferLength: 4,         // Absolute max 4 seconds (reduced from 6s)
        backBufferLength: 1,           // Keep only 1 second of back buffer (reduced from 2s)

        // Live sync - stay as close to live edge as possible
        liveSyncDuration: 1,           // Stay 1 second from live edge
        liveMaxLatencyDuration: 3,     // Maximum 3 seconds latency before catch-up
        liveDurationInfinity: true,    // Handle infinite live streams
        highBufferWatchdogPeriod: 1,   // Check buffer health every 1s

        // Start at live edge
        startPosition: -1,             // -1 means start at live edge

        // Enable low-latency features
        enableWorker: true,

        // Faster network loading
        manifestLoadingTimeOut: 2000,  // 2s timeout for playlists
        manifestLoadingMaxRetry: 2,    // Retry max 2 times
        levelLoadingTimeOut: 2000,     // 2s timeout for level playlists
        fragLoadingTimeOut: 2000,      // 2s timeout for segments

        // Minimal gaps tolerance
        maxBufferHole: 0.5,            // Tolerate 0.5s gaps

        // Debug (set to true only for troubleshooting)
        debug: false,
      });

      newHls.loadSource(src);
      newHls.attachMedia(videoRef.current);

      newHls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
        const availableLevels = data.levels.map((l, index) => ({
          id: index,
          height: l.height,
          bitrate: l.bitrate
        }));
        setLevels(availableLevels);

        // Auto-play for live streams
        if (videoRef.current) {
          videoRef.current.play().catch(err => {
            console.log('Autoplay prevented, user interaction needed:', err);
          });
        }
      });

      // Monitor latency and track segment numbers
      newHls.on(Hls.Events.FRAG_LOADED, (event, data) => {
        // Update current segment number (filter out initSegment)
        if (data.frag && typeof data.frag.sn === 'number') {
          setCurrentSegment(data.frag.sn);
        }

        if (videoRef.current && newHls.liveSyncPosition) {
          const currentLatency = newHls.liveSyncPosition - videoRef.current.currentTime;
          setLatency(currentLatency);

          // If we're more than 5 seconds behind, jump to live edge (LL-HLS optimized)
          if (currentLatency > 5) {
            console.log(`Latency too high (${currentLatency.toFixed(1)}s), jumping to live edge`);
            const targetLatency = newHls.targetLatency || 1;
            videoRef.current.currentTime = Math.max(0, newHls.liveSyncPosition - targetLatency);
          }
        }
      });

      newHls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.error('Network error, trying to recover...');
              newHls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.error('Media error, trying to recover...');
              newHls.recoverMediaError();
              break;
            default:
              console.error('Fatal error, destroying HLS instance');
              newHls.destroy();
              break;
          }
        }
      });

      setHls(newHls);

      return () => {
        newHls.destroy();
      };
    } else if (videoRef.current?.canPlayType('application/vnd.apple.mpegurl')) {
      // Native HLS support (Safari)
      videoRef.current.src = src;
      // Auto-play on Safari
      videoRef.current.play().catch(err => {
        console.log('Autoplay prevented:', err);
      });
    }
  }, [src]);

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const toggleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  };

  const handleVolumeChange = (value: number[]) => {
    const newVol = value[0];
    if (videoRef.current) {
      videoRef.current.volume = newVol;
      setVolume(newVol);
      if (newVol > 0 && isMuted) {
        videoRef.current.muted = false;
        setIsMuted(false);
      }
    }
  };

  const handleLevelChange = (value: string) => {
    setCurrentLevel(value);
    if (hls) {
      hls.currentLevel = value === "auto" ? -1 : parseInt(value);
    }
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;

    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => {
        setIsFullscreen(true);
      }).catch((err) => {
        console.error(`Error attempting to enable fullscreen: ${err.message}`);
      });
    } else {
      document.exitFullscreen().then(() => {
        setIsFullscreen(false);
      });
    }
  };

  // Listen for fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  return (
    <div ref={containerRef} className="relative group bg-black rounded-lg overflow-hidden shadow-xl aspect-video">
      <video
        ref={videoRef}
        poster={poster}
        className="w-full h-full object-contain"
        onClick={togglePlay}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
      />

      {/* Controls Overlay */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4 opacity-0 group-hover:opacity-100 transition-opacity">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" className="text-white hover:bg-white/20" onClick={togglePlay}>
              {isPlaying ? <Pause size={20} /> : <Play size={20} />}
            </Button>

            <div className="flex items-center gap-2 group/vol">
              <Button variant="ghost" size="icon" className="text-white hover:bg-white/20" onClick={toggleMute}>
                {isMuted || volume === 0 ? <VolumeX size={20} /> : <Volume2 size={20} />}
              </Button>
              <div className="w-24">
                <Slider
                  value={[isMuted ? 0 : volume]}
                  max={1}
                  step={0.01}
                  onValueChange={handleVolumeChange}
                  className="cursor-pointer"
                />
              </div>
            </div>

            <div className="flex items-center gap-3 text-white text-xs font-mono">
              <span className="bg-red-600 px-2 py-0.5 rounded font-semibold">LIVE</span>
              <span className="text-gray-300">Seg: {currentSegment}</span>
              <span className="text-gray-300">Latency: {latency.toFixed(1)}s</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Select value={currentLevel} onValueChange={handleLevelChange}>
              <SelectTrigger className="w-[100px] h-8 bg-black/50 border-white/20 text-white text-xs">
                <SelectValue placeholder="Quality" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto</SelectItem>
                {levels.map((level) => (
                  <SelectItem key={level.id} value={level.id.toString()}>
                    {level.height}p
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              variant="ghost"
              size="icon"
              className="text-white hover:bg-white/20"
              onClick={toggleFullscreen}
              title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
            >
              <Maximize size={20} />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StreamPlayer;