import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

interface UseSocketOptions {
  url: string;
  streamKey: string;
  username: string;
  role: 'teacher' | 'student';
  autoConnect?: boolean;
}

interface RoomState {
  messages: ChatMessage[];
  polls: Poll[];
  participants: Participant[];
  streamSettings: StreamSettings;
}

export interface ChatMessage {
  id: string;
  username: string;
  role: string;
  message: string;
  timestamp: number;
}

export interface Poll {
  id: string;
  question: string;
  options: PollOption[];
  voters: Set<string>;
  status: 'active' | 'closed';
  createdAt: number;
  duration?: number;
}

export interface PollOption {
  id: string;
  text: string;
  votes: number;
}

export interface Participant {
  socketId: string;
  username: string;
  role: string;
  joinedAt: number;
  handRaised: boolean;
}

export interface StreamSettings {
  h265Enabled: boolean;
}

interface HandRaise {
  socketId: string;
  username: string;
  timestamp: number;
}

export function useSocket({ url, streamKey, username, role, autoConnect = true }: UseSocketOptions) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [polls, setPolls] = useState<Poll[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [participantCount, setParticipantCount] = useState(0);
  const [handRaises, setHandRaises] = useState<HandRaise[]>([]);
  const [streamSettings, setStreamSettings] = useState<StreamSettings>({ h265Enabled: false });
  const [typingUsers, setTypingUsers] = useState<string[]>([]);

  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!autoConnect || !streamKey || !username) return;

    // Create socket connection
    const newSocket = io(url, {
      transports: ['polling', 'websocket'],  // Try polling first, it works!
      upgrade: true,                          // Allow upgrade to websocket later
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5
    });

    socketRef.current = newSocket;
    setSocket(newSocket);

    // Connection events
    newSocket.on('connect', () => {
      console.log('[Socket.IO] Connected:', newSocket.id);
      setIsConnected(true);
      
      // Join room
      newSocket.emit('join-room', { streamKey, username, role });
    });

    newSocket.on('disconnect', () => {
      console.log('[Socket.IO] Disconnected');
      setIsConnected(false);
    });

    // Room state initialization
    newSocket.on('room-state', (state: RoomState) => {
      console.log('[Socket.IO] Room state received:', state);
      setMessages(state.messages || []);
      setPolls(state.polls || []);
      setParticipants(state.participants || []);
      setParticipantCount(state.participants?.length || 0);
      setStreamSettings(state.streamSettings || { h265Enabled: false });
    });

    // Chat events
    newSocket.on('chat-message', (message: ChatMessage) => {
      setMessages(prev => [...prev, message]);
    });

    // Poll events
    newSocket.on('new-poll', (poll: Poll) => {
      setPolls(prev => [...prev, poll]);
    });

    newSocket.on('poll-updated', ({ pollId, options, totalVotes }: any) => {
      setPolls(prev => prev.map(poll => 
        poll.id === pollId 
          ? { ...poll, options, voters: new Set(Array.from({ length: totalVotes })) }
          : poll
      ));
    });

    newSocket.on('poll-closed', ({ pollId }: { pollId: string }) => {
      setPolls(prev => prev.map(poll =>
        poll.id === pollId ? { ...poll, status: 'closed' as const } : poll
      ));
    });

    // Participant events
    newSocket.on('participant-joined', ({ participant, totalCount }: any) => {
      setParticipants(prev => [...prev, participant]);
      setParticipantCount(totalCount);
    });

    newSocket.on('participant-left', ({ username, totalCount }: any) => {
      setParticipants(prev => prev.filter(p => p.username !== username));
      setParticipantCount(totalCount);
    });

    // Hand raise events
    newSocket.on('hand-raised', ({ socketId, username, queue }: any) => {
      setHandRaises(queue);
    });

    newSocket.on('hand-lowered', ({ socketId, queue }: any) => {
      setHandRaises(queue);
    });

    // Stream settings
    newSocket.on('stream-settings-updated', (settings: StreamSettings) => {
      setStreamSettings(settings);
    });

    // Typing indicator
    newSocket.on('user-typing', ({ username, isTyping }: any) => {
      setTypingUsers(prev => {
        if (isTyping) {
          return prev.includes(username) ? prev : [...prev, username];
        } else {
          return prev.filter(u => u !== username);
        }
      });
    });

    return () => {
      if (newSocket) {
        newSocket.disconnect();
      }
    };
  }, [url, streamKey, username, role, autoConnect]);

  const sendMessage = (message: string) => {
    if (socket && isConnected) {
      socket.emit('chat-message', { message });
    }
  };

  const createPoll = (question: string, options: string[], duration?: number) => {
    if (socket && isConnected && role === 'teacher') {
      socket.emit('create-poll', { question, options, duration });
    }
  };

  const votePoll = (pollId: string, optionId: string) => {
    if (socket && isConnected) {
      socket.emit('vote-poll', { pollId, optionId });
    }
  };

  const closePoll = (pollId: string) => {
    if (socket && isConnected && role === 'teacher') {
      socket.emit('close-poll', { pollId });
    }
  };

  const raiseHand = () => {
    if (socket && isConnected) {
      socket.emit('raise-hand');
    }
  };

  const lowerHand = () => {
    if (socket && isConnected) {
      socket.emit('lower-hand');
    }
  };

  const updateStreamSettings = (h265Enabled: boolean) => {
    if (socket && isConnected && role === 'teacher') {
      socket.emit('update-stream-settings', { h265Enabled });
    }
  };

  const setTyping = (isTyping: boolean) => {
    if (socket && isConnected) {
      socket.emit('typing', { isTyping });
    }
  };

  return {
    socket,
    isConnected,
    messages,
    polls,
    participants,
    participantCount,
    handRaises,
    streamSettings,
    typingUsers,
    sendMessage,
    createPoll,
    votePoll,
    closePoll,
    raiseHand,
    lowerHand,
    updateStreamSettings,
    setTyping
  };
}
