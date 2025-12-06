// Load environment variables from .env file
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
// node-media-server may not have ESM default export, try default or *
import NodeMediaServer from 'node-media-server';
import path from 'path';
import fs from 'fs';
import cors from 'cors';
import http from 'http';
import { Server } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';

import CONFIG from './config.js';
import { startTranscoding, stopTranscoding, getRecordingPath } from './transcoder.js';
import { encodeToVOD } from './vod_encoder.js';

// Ensure directories exist
if (!fs.existsSync(CONFIG.outputDir)) fs.mkdirSync(CONFIG.outputDir, { recursive: true });
if (!fs.existsSync(CONFIG.recordingDir)) fs.mkdirSync(CONFIG.recordingDir, { recursive: true });

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors());
app.use(express.json());

// Serve HLS segments with proper headers
app.use('/streams', express.static(CONFIG.outputDir, {
  setHeaders: (res, filePath) => {
    res.set('Access-Control-Allow-Origin', '*');
    if (filePath.endsWith('.m3u8')) {
      res.set('Content-Type', 'application/vnd.apple.mpegurl');
      res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else if (filePath.endsWith('.ts')) {
      res.set('Content-Type', 'video/mp2t');
      res.set('Cache-Control', 'public, max-age=31536000');
    }
  }
}));

// --- In-Memory Data Stores ---
const rooms = new Map();
const activeStreams = new Map();

function createRoom(streamKey) {
  return {
    streamKey,
    participants: new Map(),
    messages: [],
    polls: [],
    handRaises: [],
    streamSettings: { h265Enabled: false }
  };
}

// --- Socket.IO Event Handlers ---
io.on('connection', (socket) => {
  console.log(`[Socket.IO] Connected: ${socket.id}`);

  socket.on('join-room', ({ streamKey, username, role }) => {
    if (!rooms.has(streamKey)) rooms.set(streamKey, createRoom(streamKey));
    const room = rooms.get(streamKey);

    room.participants.set(socket.id, {
      socketId: socket.id,
      username: username || 'Anonymous',
      role: role || 'student',
      joinedAt: Date.now(),
      handRaised: false
    });

    socket.join(streamKey);
    socket.data = { streamKey, username, role };

    socket.emit('room-state', {
      messages: room.messages.slice(-50),
      polls: room.polls.filter(p => p.status === 'active'),
      participants: Array.from(room.participants.values()),
      streamSettings: room.streamSettings
    });

    socket.to(streamKey).emit('participant-joined', {
      participant: room.participants.get(socket.id),
      totalCount: room.participants.size
    });
  });

  socket.on('chat-message', ({ message }) => {
    const { streamKey, username, role } = socket.data || {};
    if (!streamKey || !rooms.has(streamKey)) return;

    const room = rooms.get(streamKey);
    const chatMessage = { id: uuidv4(), username, role, message, timestamp: Date.now() };
    room.messages.push(chatMessage);
    io.to(streamKey).emit('chat-message', chatMessage);
  });

  socket.on('create-poll', ({ question, options, duration }) => {
    const { streamKey, role } = socket.data || {};
    if (!streamKey || role !== 'teacher' || !rooms.has(streamKey)) return;

    const room = rooms.get(streamKey);
    const poll = {
      id: uuidv4(),
      question,
      options: options.map(opt => ({ id: uuidv4(), text: opt, votes: 0 })),
      voters: new Set(),
      status: 'active',
      createdAt: Date.now(),
      duration
    };
    room.polls.push(poll);
    io.to(streamKey).emit('new-poll', poll);

    if (duration) {
      setTimeout(() => {
        poll.status = 'closed';
        io.to(streamKey).emit('poll-closed', { pollId: poll.id });
      }, duration * 1000);
    }
  });

  socket.on('vote-poll', ({ pollId, optionId }) => {
    const { streamKey } = socket.data || {};
    if (!streamKey || !rooms.has(streamKey)) return;

    const room = rooms.get(streamKey);
    const poll = room.polls.find(p => p.id === pollId);
    if (!poll || poll.status !== 'active' || poll.voters.has(socket.id)) return;

    const option = poll.options.find(o => o.id === optionId);
    if (!option) return;

    option.votes++;
    poll.voters.add(socket.id);
    io.to(streamKey).emit('poll-updated', { pollId, options: poll.options, totalVotes: poll.voters.size });
  });

  socket.on('raise-hand', () => {
    const { streamKey, username } = socket.data || {};
    if (!streamKey || !rooms.has(streamKey)) return;

    const room = rooms.get(streamKey);
    const participant = room.participants.get(socket.id);
    if (participant && !participant.handRaised) {
      participant.handRaised = true;
      room.handRaises.push({ socketId: socket.id, username, timestamp: Date.now() });
      io.to(streamKey).emit('hand-raised', { socketId: socket.id, username, queue: room.handRaises });
    }
  });

  socket.on('lower-hand', () => {
    const { streamKey } = socket.data || {};
    if (!streamKey || !rooms.has(streamKey)) return;

    const room = rooms.get(streamKey);
    const participant = room.participants.get(socket.id);
    if (participant && participant.handRaised) {
      participant.handRaised = false;
      room.handRaises = room.handRaises.filter(h => h.socketId !== socket.id);
      io.to(streamKey).emit('hand-lowered', { socketId: socket.id, queue: room.handRaises });
    }
  });

  socket.on('update-stream-settings', ({ h265Enabled }) => {
    const { streamKey, role } = socket.data || {};
    if (!streamKey || role !== 'teacher' || !rooms.has(streamKey)) return;

    const room = rooms.get(streamKey);
    room.streamSettings.h265Enabled = h265Enabled;
    io.to(streamKey).emit('stream-settings-updated', room.streamSettings);
  });

  socket.on('disconnect', () => {
    const { streamKey, username } = socket.data || {};
    if (!streamKey || !rooms.has(streamKey)) return;

    const room = rooms.get(streamKey);
    room.participants.delete(socket.id);
    room.handRaises = room.handRaises.filter(h => h.socketId !== socket.id);
    socket.to(streamKey).emit('participant-left', { username, totalCount: room.participants.size });

    if (room.participants.size === 0) {
      rooms.delete(streamKey);
    }
  });
});

// --- Node Media Server Setup ---
const nms = new NodeMediaServer(CONFIG);

nms.on('prePublish', (id, StreamPath, args) => {
  console.log(`[NMS] prePublish: ${StreamPath}`);
});

nms.on('postPublish', (id, StreamPath, args) => {
  try {
    // Extract stream key from session object
    let streamPath = StreamPath;
    let publisherIp = 'unknown';

    if (!streamPath && id && typeof id === 'object') {
      streamPath = id.streamPath || id.publishStreamPath;
      publisherIp = id.ip || 'unknown';
    }

    if (!streamPath) {
      console.error('[NMS] postPublish: Could not determine stream path');
      return;
    }

    const streamKey = streamPath.split('/').pop();
    console.log(`[NMS] Stream started: ${streamKey} from ${publisherIp}`);

    // Get H.265 setting from room
    const room = rooms.get(streamKey);
    const h265Enabled = room ? room.streamSettings.h265Enabled : false;

    // Start transcoding
    const recordingPath = startTranscoding(streamKey, h265Enabled);

    // Track stream
    activeStreams.set(streamKey, {
      startTime: Date.now(),
      publisherIp,
      recordingPath
    });

  } catch (error) {
    console.error('[NMS] postPublish error:', error);
  }
});

nms.on('donePublish', (id, StreamPath, args) => {
  try {
    let streamPath = StreamPath;
    if (!streamPath && id && typeof id === 'object') {
      streamPath = id.streamPath || id.publishStreamPath;
    }

    if (!streamPath) {
      console.error('[NMS] donePublish: Could not determine stream path');
      return;
    }

    const streamKey = streamPath.split('/').pop();
    console.log(`[NMS] Stream stopped: ${streamKey}`);

    // Stop transcoding
    const recordingPath = stopTranscoding(streamKey);

    // Log recording location
    if (recordingPath) {
      console.log(`[NMS] Recording saved: ${recordingPath}`);
    }

    activeStreams.delete(streamKey);

  } catch (error) {
    console.error('[NMS] donePublish error:', error);
  }
});

nms.run();

// --- REST API Endpoints ---

// Get stream URLs
app.get('/api/streams/:key', (req, res) => {
  const { key } = req.params;
  res.json({
    h264: `/streams/${key}_h264.m3u8`,
    h265: `/streams/${key}_h265.m3u8`,
    renditions: {
      h264: CONFIG.renditions.h264.map(r => ({
        quality: r.name,
        url: `/streams/${key}_h264_${r.name}.m3u8`
      })),
      h265: CONFIG.renditions.h265.map(r => ({
        quality: r.name,
        url: `/streams/${key}_h265_${r.name}.m3u8`
      }))
    }
  });
});

// List active streams
app.get('/api/streams', (req, res) => {
  const live = {};
  activeStreams.forEach((value, key) => {
    const room = rooms.get(key);
    live[key] = {
      publisher: { ip: value.publisherIp },
      subscribers: room ? room.participants.size - 1 : 0,
      startTime: value.startTime,
      recordingPath: value.recordingPath
    };
  });
  res.json({ live });
});

// Get room info
app.get('/api/rooms/:streamKey', (req, res) => {
  const { streamKey } = req.params;
  const room = rooms.get(streamKey);

  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }

  res.json({
    streamKey: room.streamKey,
    participantCount: room.participants.size,
    messageCount: room.messages.length,
    activePolls: room.polls.filter(p => p.status === 'active').length,
    handRaises: room.handRaises.length,
    streamSettings: room.streamSettings
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// Start API server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`\n========================================`);
  console.log(`  Streaming Server Started`);
  console.log(`========================================`);
  console.log(`  API Server:  http://localhost:${PORT}`);
  console.log(`  RTMP Ingest: rtmp://localhost:${CONFIG.rtmp.port}/live/<key>`);
  console.log(`  HLS Output:  http://localhost:${PORT}/streams/<key>_h264.m3u8`);
  console.log(`  GPU Mode:    ${CONFIG.transcode.gpuEnabled ? 'ENABLED' : 'DISABLED'}`);
  console.log(`========================================\n`);
});