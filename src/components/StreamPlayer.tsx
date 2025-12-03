import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Volume2, VolumeX, Maximize, Play, Pause, Settings } from "lucide-react";
import { Slider } from "@/components/ui/slider";

interface StreamPlayerProps {
  src: string;
  poster?: string;
}

const StreamPlayer: React.FC<StreamPlayerProps> = ({ src, poster }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hls, setHls] = useState<Hls | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [levels, setLevels] = useState<{ id: number; height: number; bitrate: number }[]>([]);
  const [currentLevel, setCurrentLevel] = useState<string>("auto");

  useEffect(() => {
    if (Hls.isSupported() && videoRef.current) {
      const newHls = new Hls({
        lowLatencyMode: true, // Enable LL-HLS
        backBufferLength: 90,
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
        // Auto-play if desired
        // videoRef.current?.play();
      });

      setHls(newHls);

      return () => {
        newHls.destroy();
      };
    } else if (videoRef.current?.canPlayType('application/vnd.apple.mpegurl')) {
      // Native HLS support (Safari)
      videoRef.current.src = src;
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

  return (
    <div className="relative group bg-black rounded-lg overflow-hidden shadow-xl aspect-video">
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
            
            <div className="text-white text-xs font-mono">
              LIVE
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
            
            <Button variant="ghost" size="icon" className="text-white hover:bg-white/20">
              <Maximize size={20} />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StreamPlayer;