import React from 'react';
import StreamPlayer from '@/components/StreamPlayer';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { BookOpen, MessageCircle, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";

const Student = () => {
  // In a real app, this URL comes from the backend API based on the active class
  // This is a test HLS stream that works for demo purposes
  const streamUrl = "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8";

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
             <Badge variant="outline" className="border-green-500 text-green-600 bg-green-50">
               Live Now
             </Badge>
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
            <StreamPlayer src={streamUrl} />
            <div className="flex justify-between items-start px-1">
              <div>
                <h2 className="text-xl font-bold mt-2">Calculus II: Integration Techniques</h2>
                <p className="text-sm text-gray-500">Started 15 mins ago</p>
              </div>
            </div>
          </div>

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
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                   <div className="flex gap-2">
                      <Avatar className="w-6 h-6"><AvatarFallback>JD</AvatarFallback></Avatar>
                      <div>
                        <p className="text-xs font-bold text-gray-700">Jane Doe <span className="text-gray-400 font-normal ml-1">10:02</span></p>
                        <p className="text-sm text-gray-800">Can you explain the last step again?</p>
                      </div>
                   </div>
                   <div className="flex gap-2">
                      <Avatar className="w-6 h-6"><AvatarFallback>MS</AvatarFallback></Avatar>
                      <div>
                        <p className="text-xs font-bold text-gray-700">Mark Smith <span className="text-gray-400 font-normal ml-1">10:04</span></p>
                        <p className="text-sm text-gray-800">The audio is very clear, thanks for the LL-HLS setup!</p>
                      </div>
                   </div>
                   {/* Chat simulator placeholder */}
                   <div className="text-center text-xs text-gray-400 py-4">
                     Welcome to the chat room
                   </div>
                </div>
                
                <div className="p-4 border-t bg-white">
                  <div className="flex gap-2">
                    <input 
                      className="flex-1 border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      placeholder="Type a message..."
                    />
                    <Button size="icon"><MessageCircle className="w-4 h-4" /></Button>
                  </div>
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