import React, { useState, useRef, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Wifi, Users, StopCircle, PlayCircle, Settings, Activity } from "lucide-react";
import { showSuccess, showError } from "@/utils/toast";

const Teacher = () => {
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamKey, setStreamKey] = useState("class_101");
  const videoRef = useRef<HTMLVideoElement>(null);
  const [viewers, setViewers] = useState(0);

  // Simulate local camera preview
  useEffect(() => {
    let stream: MediaStream | null = null;

    const startCamera = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (err) {
        console.error("Error accessing camera:", err);
      }
    };

    startCamera();

    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  // Simulate viewer count updates
  useEffect(() => {
    if (!isStreaming) {
      setViewers(0);
      return;
    }
    
    const interval = setInterval(() => {
      setViewers(prev => {
        const change = Math.floor(Math.random() * 10) - 3;
        return Math.max(0, Math.min(1000, prev + change));
      });
    }, 2000);
    
    return () => clearInterval(interval);
  }, [isStreaming]);

  const toggleStream = () => {
    if (isStreaming) {
      setIsStreaming(false);
      showSuccess("Stream ended successfully");
    } else {
      setIsStreaming(true);
      showSuccess("Stream started! Ingesting to CDN...");
      setViewers(850); // Initial simulated viewers
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Teacher Dashboard</h1>
            <p className="text-gray-500">Manage your live class and monitor performance</p>
          </div>
          <div className="flex items-center gap-2">
             {isStreaming && (
                <Badge variant="destructive" className="animate-pulse">
                  <Wifi className="w-3 h-3 mr-1" /> LIVE
                </Badge>
             )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <Card className="overflow-hidden border-2 border-gray-200">
              <div className="aspect-video bg-black relative">
                <video 
                  ref={videoRef} 
                  autoPlay 
                  muted 
                  className="w-full h-full object-cover"
                />
                {!isStreaming && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                    <p className="text-white font-medium">Preview Mode</p>
                  </div>
                )}
              </div>
              <div className="p-4 bg-white flex justify-between items-center">
                <div className="flex items-center gap-4">
                  <div className={`w-3 h-3 rounded-full ${isStreaming ? 'bg-green-500' : 'bg-gray-300'}`} />
                  <span className="text-sm font-medium">
                    {isStreaming ? 'Excellent Connection' : 'Ready to Stream'}
                  </span>
                </div>
                <Button 
                  variant={isStreaming ? "destructive" : "default"}
                  onClick={toggleStream}
                  className="w-32"
                >
                  {isStreaming ? (
                    <><StopCircle className="w-4 h-4 mr-2" /> Stop</>
                  ) : (
                    <><PlayCircle className="w-4 h-4 mr-2" /> Go Live</>
                  )}
                </Button>
              </div>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardContent className="pt-6">
                  <div className="flex flex-col items-center">
                    <Users className="w-8 h-8 text-blue-500 mb-2" />
                    <span className="text-2xl font-bold">{viewers}</span>
                    <span className="text-xs text-gray-500 uppercase">Active Students</span>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="flex flex-col items-center">
                    <Activity className="w-8 h-8 text-green-500 mb-2" />
                    <span className="text-2xl font-bold">2.0 Mbps</span>
                    <span className="text-xs text-gray-500 uppercase">Bitrate (CBR)</span>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="flex flex-col items-center">
                    <Settings className="w-8 h-8 text-purple-500 mb-2" />
                    <span className="text-2xl font-bold">LL-HLS</span>
                    <span className="text-xs text-gray-500 uppercase">Protocol</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Stream Settings</CardTitle>
                <CardDescription>Configuration for cost optimization</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Stream Key</Label>
                  <Input value={streamKey} onChange={(e) => setStreamKey(e.target.value)} type="password" />
                </div>
                <div className="space-y-2">
                  <Label>Ingest Endpoint</Label>
                  <Input value="rtmp://ingest.dyad-edu.com/live" readOnly disabled className="bg-gray-100" />
                </div>
                
                <div className="pt-4 border-t">
                  <h4 className="font-medium mb-2 text-sm">Target Encoding (Cost-Optimized)</h4>
                  <div className="space-y-2 text-sm text-gray-600">
                    <div className="flex justify-between">
                      <span>Codec</span>
                      <span className="font-mono">H.264 / H.265</span>
                    </div>
                    <div className="flex justify-between">
                      <span>720p Bitrate</span>
                      <span className="font-mono">2.0 Mbps</span>
                    </div>
                    <div className="flex justify-between">
                      <span>480p Bitrate</span>
                      <span className="font-mono">1.5 Mbps</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Segments</span>
                      <span className="font-mono">2s (Low Latency)</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Class Chat</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[200px] bg-gray-100 rounded-md flex items-center justify-center text-gray-400 text-sm">
                  Chat disabled for preview
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Teacher;