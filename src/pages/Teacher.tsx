import React, { useState, useRef, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Wifi, Users, StopCircle, PlayCircle, Settings, Activity, Copy, RefreshCw, Hand, Wifi as WifiIcon } from "lucide-react";
import { showSuccess, showError } from "@/utils/toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useSocket } from "@/hooks/useSocket";
import { ChatPanel } from "@/components/ChatPanel";
import { PollCard } from "@/components/PollCard";
import { CreatePollDialog } from "@/components/CreatePollDialog";
import { ScrollArea } from "@/components/ui/scroll-area";

const Teacher = () => {
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamKey, setStreamKey] = useState("class_main"); // Fixed default key for easy testing
  const [username] = useState("Teacher");
  const [h265Enabled, setH265Enabled] = useState(false);
  const rtmpUrl = "rtmp://localhost:1935/live";

  // No auto-generation on mount - using fixed key
  // useEffect(() => {
  //   if (!streamKey) generateKey();
  // }, []);

  // Socket.IO integration
  const {
    isConnected,
    messages,
    polls,
    participantCount,
    handRaises,
    streamSettings,
    sendMessage,
    createPoll,
    closePoll,
    updateStreamSettings,
  } = useSocket({
    url: 'http://localhost:3001',
    streamKey,
    username,
    role: 'teacher',
    autoConnect: !!streamKey
  });

  // Poll for stream status
  useEffect(() => {
    if (!streamKey) return;

    const checkStatus = async () => {
      try {
        const response = await fetch('http://localhost:3001/api/streams');
        const data = await response.json();
        if (data.live && data.live[streamKey]) {
          if (!isStreaming) {
            setIsStreaming(true);
            showSuccess("Stream is LIVE!");
          }
        } else {
          if (isStreaming) {
            setIsStreaming(false);
            showSuccess("Stream ended.");
          }
        }
      } catch (error) {
        console.error("Error checking stream status:", error);
      }
    };

    const interval = setInterval(checkStatus, 3000);
    return () => clearInterval(interval);
  }, [streamKey, isStreaming]);

  // Sync H.265 setting with room
  useEffect(() => {
    if (streamSettings.h265Enabled !== h265Enabled) {
      setH265Enabled(streamSettings.h265Enabled);
    }
  }, [streamSettings.h265Enabled]);

  const generateKey = () => {
    const key = 'class_' + Math.random().toString(36).substr(2, 9);
    setStreamKey(key);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    showSuccess("Copied to clipboard");
  };

  const handleH265Toggle = (enabled: boolean) => {
    if (isStreaming) {
      showError("Cannot change encoding while streaming");
      return;
    }
    setH265Enabled(enabled);
    updateStreamSettings(enabled);
  };

  const handleCreatePoll = (question: string, options: string[], duration?: number) => {
    createPoll(question, options, duration);
    showSuccess("Poll created!");
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
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
            {isConnected ? (
              <Badge variant="outline" className="border-green-500 text-green-600 bg-green-50">
                <WifiIcon className="w-3 h-3 mr-1" /> Connected
              </Badge>
            ) : (
              <Badge variant="outline" className="border-gray-300 text-gray-500">
                <WifiIcon className="w-3 h-3 mr-1" /> Disconnected
              </Badge>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <Card className="overflow-hidden border-2 border-gray-200">
              <CardHeader>
                <CardTitle>Connection Details</CardTitle>
                <CardDescription>Enter these details into OBS Studio to start streaming</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>RTMP Server</Label>
                  <div className="flex gap-2">
                    <Input value={rtmpUrl} readOnly className="font-mono bg-gray-50" />
                    <Button variant="outline" size="icon" onClick={() => copyToClipboard(rtmpUrl)}>
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Stream Key</Label>
                  <div className="flex gap-2">
                    <Input value={streamKey} readOnly className="font-mono bg-gray-50" />
                    <Button variant="outline" size="icon" onClick={() => copyToClipboard(streamKey)}>
                      <Copy className="w-4 h-4" />
                    </Button>
                    <Button variant="outline" size="icon" onClick={generateKey} title="Generate New Key" disabled={isStreaming}>
                      <RefreshCw className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                {/* Share Student Link */}
                <div className="space-y-2">
                  <Label>Student Link</Label>
                  <div className="flex gap-2">
                    <Input
                      value={`${window.location.origin}/student?key=${streamKey}`}
                      readOnly
                      className="font-mono bg-gray-50 text-xs"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => copyToClipboard(`${window.location.origin}/student?key=${streamKey}`)}
                      title="Copy student link"
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-gray-500">Share this link with students to join your class</p>
                </div>

                {/* H.265 Toggle */}
                <div className="flex items-center justify-between p-3 border rounded-lg bg-blue-50 border-blue-200">
                  <div className="space-y-0.5">
                    <Label htmlFor="h265-toggle" className="text-sm font-medium">
                      Enable H.265 (HEVC) Encoding
                    </Label>
                    <p className="text-xs text-gray-600">
                      Saves ~50% bandwidth but uses more CPU. {isStreaming && '(Cannot change while streaming)'}
                    </p>
                  </div>
                  <Switch
                    id="h265-toggle"
                    checked={h265Enabled}
                    onCheckedChange={handleH265Toggle}
                    disabled={isStreaming}
                  />
                </div>

                <Alert className="bg-blue-50 border-blue-200">
                  <AlertTitle className="text-blue-800">Ready to Stream?</AlertTitle>
                  <AlertDescription className="text-blue-700">
                    1. Open OBS Studio<br />
                    2. Go to <strong>Settings &gt; Stream</strong><br />
                    3. Service: <strong>Custom</strong><br />
                    4. Server: <strong>{rtmpUrl}</strong><br />
                    5. Stream Key: <strong>{streamKey}</strong><br />
                    6. Click <strong>Start Streaming</strong>
                  </AlertDescription>
                </Alert>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardContent className="pt-6">
                  <div className="flex flex-col items-center">
                    <Users className="w-8 h-8 text-blue-500 mb-2" />
                    <span className="text-2xl font-bold">{participantCount}</span>
                    <span className="text-xs text-gray-500 uppercase">Active Viewers</span>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="flex flex-col items-center">
                    <Activity className="w-8 h-8 text-green-500 mb-2" />
                    <span className="text-2xl font-bold">{h265Enabled ? 'H.265' : 'H.264'}</span>
                    <span className="text-xs text-gray-500 uppercase">Codec</span>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="flex flex-col items-center">
                    <Hand className="w-8 h-8 text-orange-500 mb-2" />
                    <span className="text-2xl font-bold">{handRaises.length}</span>
                    <span className="text-xs text-gray-500 uppercase">Raised Hands</span>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Hand Raises Queue */}
            {handRaises.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Hand className="w-5 h-5 text-orange-500" />
                    Hand Raise Queue
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {handRaises.map((raise, index) => (
                      <div key={raise.socketId} className="flex items-center justify-between p-2 bg-orange-50 border border-orange-200 rounded">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-orange-700">#{index + 1}</span>
                          <span className="text-sm">{raise.username}</span>
                        </div>
                        <span className="text-xs text-gray-500">
                          {new Date(raise.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          <div className="space-y-6">
            {/* Polls Section */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Polls</CardTitle>
                  <CreatePollDialog onCreatePoll={handleCreatePoll} />
                </div>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[200px]">
                  <div className="space-y-3">
                    {polls.length === 0 ? (
                      <div className="text-center text-gray-400 text-sm py-8">
                        No active polls. Create one to engage students!
                      </div>
                    ) : (
                      polls.map(poll => (
                        <PollCard
                          key={poll.id}
                          poll={poll}
                          onClose={() => closePoll(poll.id)}
                          userRole="teacher"
                        />
                      ))
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>

            {/* Chat Section */}
            <Card className="h-[400px] flex flex-col">
              <ChatPanel
                messages={messages}
                onSendMessage={sendMessage}
                participantCount={participantCount}
                currentUsername={username}
              />
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Teacher;