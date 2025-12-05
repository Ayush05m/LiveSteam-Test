import React, { useState, useEffect } from 'react';
import StreamPlayer from '@/components/StreamPlayer';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { BookOpen, MessageCircle, FileText, Settings, Hand, WifiIcon, Wifi } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useSocket } from "@/hooks/useSocket";
import { ChatPanel } from "@/components/ChatPanel";
import { PollCard } from "@/components/PollCard";
import { ScrollArea } from "@/components/ui/scroll-area";
import { config, getStreamUrl, getApiUrl } from "@/config/env";

const Student = () => {
  // Get stream key from URL parameter or use default
  const urlParams = new URLSearchParams(window.location.search);
  const urlStreamKey = urlParams.get('key');

  const [streamKey, setStreamKey] = useState(urlStreamKey || "class_main"); // Use URL param or default
  const [codec, setCodec] = useState<'h264' | 'h265'>('h264');
  const [isLive, setIsLive] = useState(false);
  const [streamUrl, setStreamUrl] = useState("");
  const [username] = useState(`Student_${Math.random().toString(36).substr(2, 5)}`);
  const [handRaised, setHandRaised] = useState(false);
  const [votedPolls, setVotedPolls] = useState<Set<string>>(new Set());
  const [jumpToLiveCallback, setJumpToLiveCallback] = useState<(() => void) | null>(null);

  // Socket.IO integration
  const {
    isConnected,
    messages,
    polls,
    participantCount,
    streamSettings,
    sendMessage,
    votePoll,
    raiseHand,
    lowerHand,
    typingUsers,
    setTyping,
  } = useSocket({
    url: config.socketUrl,
    streamKey,
    username,
    role: 'student',
    autoConnect: !!streamKey
  });

  // Construct Stream URL based on codec
  useEffect(() => {
    setStreamUrl(getStreamUrl(streamKey, codec));
  }, [streamKey, codec]);

  // Poll for stream status
  useEffect(() => {
    const checkStatus = async () => {
      try {
        const response = await fetch(getApiUrl('/api/streams'));
        const data = await response.json();
        if (data.live && data.live[streamKey]) {
          setIsLive(true);
        } else {
          setIsLive(false);
        }
      } catch (error) {
        console.error("Error checking stream status:", error);
        setIsLive(false);
      }
    };

    const interval = setInterval(checkStatus, 3000);
    checkStatus(); // Initial check
    return () => clearInterval(interval);
  }, [streamKey]);

  const handleRaiseHand = () => {
    if (handRaised) {
      lowerHand();
      setHandRaised(false);
    } else {
      raiseHand();
      setHandRaised(true);
    }
  };

  const handleVote = (pollId: string, optionId: string) => {
    votePoll(pollId, optionId);
    setVotedPolls(prev => new Set(prev).add(pollId));
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-primary/10 p-2 rounded-lg">
              <BookOpen className="text-primary w-5 h-5" />
            </div>
            <div>
              <h1 className="font-bold text-gray-900">Advanced Mathematics</h1>
              <p className="text-xs text-gray-500">Prof. John Doe • Live Class</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {isLive ? (
              <Badge variant="outline" className="border-green-500 text-green-600 bg-green-50 animate-pulse">
                Live Now
              </Badge>
            ) : (
              <Badge variant="outline" className="border-gray-300 text-gray-500 bg-gray-50">
                Offline
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
            <Avatar className="w-8 h-8">
              <AvatarImage src="https://github.com/shadcn.png" />
              <AvatarFallback>ST</AvatarFallback>
            </Avatar>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4 lg:p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Main Video Player */}
          <div className="space-y-2">
            <div className="relative">
              {isLive ? (
                <>
                  <StreamPlayer
                    key={streamUrl}
                    src={streamUrl}
                    onJumpToLive={(callback) => setJumpToLiveCallback(() => callback)}
                  />
                  {/* Jump to Live Button - overlay on video */}
                  <div className="absolute bottom-20 right-4">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => jumpToLiveCallback?.()}
                      className="bg-red-600 hover:bg-red-700 text-white shadow-lg"
                    >
                      <Wifi className="w-4 h-4 mr-1" />
                      Jump to Live
                    </Button>
                  </div>
                </>
              ) : (
                <div className="aspect-video bg-black rounded-lg flex items-center justify-center text-white">
                  <div className="text-center">
                    <p className="text-xl font-bold mb-2">Stream is Offline</p>
                    <p className="text-sm text-gray-400">Waiting for teacher to start...</p>
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-between items-start px-1 mt-4">
              <div>
                <h2 className="text-xl font-bold">Calculus II: Integration Techniques</h2>
                <p className="text-sm text-gray-500">{isLive ? "Live Streaming" : "Scheduled Class"} • {participantCount} viewers</p>
                {/* Debug info - remove in production */}
                <p className="text-xs text-gray-400 font-mono mt-1">Stream: {streamUrl}</p>
              </div>

              <div className="flex items-center gap-2">
                {/* Hand Raise Button */}
                <Button
                  variant={handRaised ? "default" : "outline"}
                  size="sm"
                  onClick={handleRaiseHand}
                  className={handRaised ? "bg-orange-500 hover:bg-orange-600" : ""}
                  disabled={!isLive}
                >
                  <Hand className="w-4 h-4 mr-1" />
                  {handRaised ? "Lower Hand" : "Raise Hand"}
                </Button>

                {/* Codec Selector */}
                <div className="flex items-center gap-2 bg-white p-2 rounded-lg border shadow-sm">
                  <Settings className="w-4 h-4 text-gray-500" />
                  <span className="text-sm font-medium text-gray-700">Codec:</span>
                  <Select value={codec} onValueChange={(v: any) => setCodec(v)}>
                    <SelectTrigger className="w-[140px] h-8 text-xs">
                      <SelectValue placeholder="Codec" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="h264">H.264 (Standard)</SelectItem>
                      <SelectItem value="h265" disabled={!streamSettings.h265Enabled}>
                        H.265 (High Eff)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {codec === 'h265' && (
              <Alert className="bg-blue-50 text-blue-800 border-blue-200 mt-2">
                <AlertDescription className="text-xs">
                  Using H.265 (HEVC) saves ~50% bandwidth. If video fails to play, switch back to H.264.
                </AlertDescription>
              </Alert>
            )}

            {!streamSettings.h265Enabled && (
              <Alert className="bg-gray-50 text-gray-700 border-gray-200 mt-2">
                <AlertDescription className="text-xs">
                  H.265 encoding is currently disabled by the teacher.
                </AlertDescription>
              </Alert>
            )}
          </div>

          {/* Polls Section */}
          {polls.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Active Polls</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {polls.map(poll => (
                    <PollCard
                      key={poll.id}
                      poll={poll}
                      onVote={(optionId) => handleVote(poll.id, optionId)}
                      userRole="student"
                      hasVoted={votedPolls.has(poll.id)}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Class Materials</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex items-center gap-3 p-3 border rounded-lg hover:bg-gray-50 cursor-pointer transition-colors">
                  <FileText className="text-blue-500 w-5 h-5" />
                  <div className="text-sm">
                    <p className="font-medium">Lecture Notes.pdf</p>
                    <p className="text-gray-500 text-xs">2.4 MB</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 border rounded-lg hover:bg-gray-50 cursor-pointer transition-colors">
                  <FileText className="text-blue-500 w-5 h-5" />
                  <div className="text-sm">
                    <p className="font-medium">Homework Set 3.pdf</p>
                    <p className="text-gray-500 text-xs">1.1 MB</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-1 h-[calc(100vh-140px)] sticky top-24">
          <Card className="h-full flex flex-col">
            <Tabs defaultValue="chat" className="flex-1 flex flex-col">
              <div className="p-4 border-b">
                <TabsList className="w-full">
                  <TabsTrigger value="chat" className="flex-1">Live Chat</TabsTrigger>
                  <TabsTrigger value="qa" className="flex-1">Q&A</TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="chat" className="flex-1 p-0 m-0 flex flex-col relative h-full">
                <div className="flex-1 overflow-hidden">
                  <ChatPanel
                    messages={messages}
                    onSendMessage={sendMessage}
                    participantCount={participantCount}
                    typingUsers={typingUsers}
                    currentUsername={username}
                  />
                </div>
              </TabsContent>

              <TabsContent value="qa" className="p-4">
                <div className="text-center text-gray-500 mt-10">
                  No questions yet. Be the first to ask!
                </div>
              </TabsContent>
            </Tabs>
          </Card>
        </div>
      </main>
    </div>
  );
};

export default Student;