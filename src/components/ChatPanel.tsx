import React, { useEffect, useRef } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Send, Users } from 'lucide-react';
import { ChatMessage } from '@/hooks/useSocket';
import { format } from 'date-fns';

interface ChatPanelProps {
    messages: ChatMessage[];
    onSendMessage: (message: string) => void;
    participantCount: number;
    typingUsers?: string[];
    currentUsername?: string;
}

export function ChatPanel({ messages, onSendMessage, participantCount, typingUsers = [], currentUsername }: ChatPanelProps) {
    const [inputValue, setInputValue] = React.useState('');
    const scrollRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to bottom when new messages arrive
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages]);

    const handleSend = () => {
        if (inputValue.trim()) {
            onSendMessage(inputValue.trim());
            setInputValue('');
        }
    };

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const getInitials = (name: string) => {
        return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    };

    const getRoleColor = (role: string) => {
        return role === 'teacher' ? 'bg-purple-500' : 'bg-blue-500';
    };

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="p-4 border-b flex items-center justify-between">
                <h3 className="font-semibold text-sm">Live Chat</h3>
                <div className="flex items-center gap-1 text-xs text-gray-500">
                    <Users className="w-3 h-3" />
                    <span>{participantCount}</span>
                </div>
            </div>

            {/* Messages */}
            <ScrollArea className="flex-1 p-4">
                <div ref={scrollRef} className="space-y-3">
                    {messages.length === 0 ? (
                        <div className="text-center text-gray-400 text-sm mt-10">
                            No messages yet. Start the conversation!
                        </div>
                    ) : (
                        messages.map((msg) => (
                            <div key={msg.id} className="flex gap-2 items-start">
                                <Avatar className="w-7 h-7 flex-shrink-0">
                                    <AvatarFallback className={`text-xs text-white ${getRoleColor(msg.role)}`}>
                                        {getInitials(msg.username)}
                                    </AvatarFallback>
                                </Avatar>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-baseline gap-2">
                                        <span className="text-xs font-semibold text-gray-900">
                                            {msg.username}
                                        </span>
                                        {msg.role === 'teacher' && (
                                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 font-medium">
                                                Teacher
                                            </span>
                                        )}
                                        <span className="text-[10px] text-gray-400">
                                            {format(msg.timestamp, 'HH:mm')}
                                        </span>
                                    </div>
                                    <p className="text-sm text-gray-700 break-words mt-0.5">
                                        {msg.message}
                                    </p>
                                </div>
                            </div>
                        ))
                    )}

                    {/* Typing indicators */}
                    {typingUsers.length > 0 && (
                        <div className="text-xs text-gray-400 italic">
                            {typingUsers.filter(u => u !== currentUsername).join(', ')} {typingUsers.length === 1 ? 'is' : 'are'} typing...
                        </div>
                    )}
                </div>
            </ScrollArea>

            {/* Input */}
            <div className="p-4 border-t">
                <div className="flex gap-2">
                    <Input
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        onKeyDown={handleKeyPress}
                        placeholder="Type a message..."
                        className="flex-1 text-sm"
                    />
                    <Button size="icon" onClick={handleSend} disabled={!inputValue.trim()}>
                        <Send className="w-4 h-4" />
                    </Button>
                </div>
            </div>
        </div>
    );
}
