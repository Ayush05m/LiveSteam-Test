import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { getStreamUrl } from "@/config/env";

const StudentClassroom = () => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [hlsInstance, setHlsInstance] = useState<Hls | null>(null);
    const [streamKey, setStreamKey] = useState('test'); // In real app, get from route params
    const [codec, setCodec] = useState<'h264' | 'h265'>('h264');
    const [qualityLevels, setQualityLevels] = useState<any[]>([]);
    const [currentLevel, setCurrentLevel] = useState(-1); // -1 is Auto
    const [isPlaying, setIsPlaying] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Check H.265 support
    useEffect(() => {
        const checkH265 = () => {
            const video = document.createElement('video');
            // Basic check for HEVC support
            const canPlay = video.canPlayType('video/mp4; codecs="hvc1.1.6.L93.B0"');
            if (canPlay === 'probably' || canPlay === 'maybe') {
                console.log("H.265/HEVC is supported on this device.");
                // We could auto-switch, but let's default to H.264 for safety and let user toggle if they want "High Efficiency"
                // Or better: Auto-select based on user agent/capability
                // For this demo, we'll stick to H.264 default but allow toggle.
            }
        };
        checkH265();
    }, []);

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        // Cleanup previous instance
        if (hlsInstance) {
            hlsInstance.destroy();
        }

        const streamUrl = getStreamUrl(streamKey, codec);

        if (Hls.isSupported()) {
            const hls = new Hls({
                enableWorker: true,
                lowLatencyMode: true, // Enable LL-HLS optimizations
                backBufferLength: 90
            });

            hls.loadSource(streamUrl);
            hls.attachMedia(video);

            hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
                setQualityLevels(data.levels);
                video.play().catch(e => console.log("Autoplay prevented", e));
                setIsPlaying(true);
                setError(null);
            });

            hls.on(Hls.Events.ERROR, (event, data) => {
                if (data.fatal) {
                    switch (data.type) {
                        case Hls.ErrorTypes.NETWORK_ERROR:
                            console.error("Network error, trying to recover...");
                            hls.startLoad();
                            break;
                        case Hls.ErrorTypes.MEDIA_ERROR:
                            console.error("Media error, trying to recover...");
                            hls.recoverMediaError();
                            break;
                        default:
                            console.error("Fatal error, cannot recover");
                            hls.destroy();
                            setError("Stream not available or format not supported.");
                            break;
                    }
                }
            });

            setHlsInstance(hls);
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            // Native HLS support (Safari)
            video.src = streamUrl;
            video.addEventListener('loadedmetadata', () => {
                video.play();
                setIsPlaying(true);
            });
        }

        return () => {
            if (hlsInstance) {
                hlsInstance.destroy();
            }
        };
    }, [streamKey, codec]);

    const handleQualityChange = (value: string) => {
        const levelIndex = parseInt(value);
        setCurrentLevel(levelIndex);
        if (hlsInstance) {
            hlsInstance.currentLevel = levelIndex;
        }
    };

    return (
        <div className="p-4 max-w-6xl mx-auto">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-4">
                    <Card className="overflow-hidden bg-black border-0 shadow-xl">
                        <div className="relative aspect-video">
                            <video
                                ref={videoRef}
                                className="w-full h-full object-contain"
                                controls
                                playsInline
                                poster="/placeholder-stream.jpg"
                            />
                            {error && (
                                <div className="absolute inset-0 flex items-center justify-center bg-black/80 text-white">
                                    <p>{error}</p>
                                </div>
                            )}
                        </div>
                    </Card>

                    <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-card rounded-lg border">
                        <div className="flex items-center gap-4">
                            <h2 className="text-xl font-bold">Live Class</h2>
                            {isPlaying && <Badge variant="default" className="bg-red-500 animate-pulse">LIVE</Badge>}
                        </div>

                        <div className="flex items-center gap-4">
                            <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-muted-foreground">Codec:</span>
                                <Select value={codec} onValueChange={(v: any) => setCodec(v)}>
                                    <SelectTrigger className="w-[100px]">
                                        <SelectValue placeholder="Codec" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="h264">H.264 (Compat)</SelectItem>
                                        <SelectItem value="h265">H.265 (Effic)</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-muted-foreground">Quality:</span>
                                <Select value={currentLevel.toString()} onValueChange={handleQualityChange}>
                                    <SelectTrigger className="w-[120px]">
                                        <SelectValue placeholder="Quality" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="-1">Auto</SelectItem>
                                        {qualityLevels.map((level, index) => (
                                            <SelectItem key={index} value={index.toString()}>
                                                {level.height}p ({Math.round(level.bitrate / 1000)}k)
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="space-y-4">
                    <Card>
                        <CardContent className="p-4">
                            <h3 className="font-semibold mb-2">Stream Info</h3>
                            <div className="text-sm space-y-2 text-muted-foreground">
                                <p>Latency: ~3-6s (LL-HLS)</p>
                                <p>Current Codec: {codec.toUpperCase()}</p>
                                <p>Bandwidth Saving: {codec === 'h265' ? '~40%' : '0%'}</p>
                            </div>
                        </CardContent>
                    </Card>

                    <Alert>
                        <AlertDescription>
                            Use H.265 for lower data usage if your device supports it. Switch back to H.264 if video freezes or doesn't play.
                        </AlertDescription>
                    </Alert>
                </div>
            </div>
        </div>
    );
};

export default StudentClassroom;
