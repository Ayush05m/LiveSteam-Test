import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Copy, Video, Radio } from "lucide-react";
import { getApiUrl } from "@/config/env";

const TeacherDashboard = () => {
    const [streamKey, setStreamKey] = useState('');
    const [rtmpUrl, setRtmpUrl] = useState('rtmp://localhost:1935/live');
    const [isLive, setIsLive] = useState(false);

    const generateKey = () => {
        const key = 'class_' + Math.random().toString(36).substr(2, 9);
        setStreamKey(key);
    };

    useEffect(() => {
        if (!streamKey) generateKey();

        const checkStatus = async () => {
            try {
                // Poll Node Media Server API
                const response = await fetch(getApiUrl('/api/streams'));
                const data = await response.json();
                // NMS API returns object with keys like "live" -> "streamKey" -> ...
                // Structure: { live: { [streamKey]: { publisher: {...} } } }
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

        const interval = setInterval(checkStatus, 3000); // Poll every 3 seconds
        return () => clearInterval(interval);
    }, [streamKey]);

    return (
        <div className="p-8 max-w-4xl mx-auto space-y-6">
            <h1 className="text-3xl font-bold mb-8">Teacher Streaming Dashboard</h1>

            <div className="grid gap-6 md:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Video className="w-5 h-5" />
                            Stream Configuration
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label>RTMP Server URL</Label>
                            <div className="flex gap-2">
                                <Input value={rtmpUrl} readOnly />
                                <Button variant="outline" size="icon" onClick={() => navigator.clipboard.writeText(rtmpUrl)}>
                                    <Copy className="w-4 h-4" />
                                </Button>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label>Stream Key</Label>
                            <div className="flex gap-2">
                                <Input value={streamKey} readOnly />
                                <Button variant="outline" size="icon" onClick={() => navigator.clipboard.writeText(streamKey)}>
                                    <Copy className="w-4 h-4" />
                                </Button>
                            </div>
                            <Button onClick={generateKey} variant="secondary" className="w-full mt-2">
                                Generate New Key
                            </Button>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Stream Status</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-4">
                            <div className="flex items-center justify-between p-4 bg-secondary/20 rounded-lg">
                                <span>Status</span>
                                <span className={`px-3 py-1 rounded-full text-sm font-medium ${isLive ? 'bg-green-500/20 text-green-600' : 'bg-yellow-500/20 text-yellow-600'}`}>
                                    {isLive ? 'Live' : 'Offline'}
                                </span>
                            </div>

                            <Alert>
                                <AlertTitle>Instructions</AlertTitle>
                                <AlertDescription className="mt-2 text-sm text-muted-foreground">
                                    1. Open OBS Studio<br />
                                    2. Go to Settings &gt; Stream<br />
                                    3. Service: Custom<br />
                                    4. Server: {rtmpUrl}<br />
                                    5. Stream Key: {streamKey}<br />
                                    6. Start Streaming
                                </AlertDescription>
                            </Alert>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
};

export default TeacherDashboard;
