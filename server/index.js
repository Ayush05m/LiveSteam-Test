const express = require('express');
const NodeMediaServer = require('node-media-server');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());

// --- Configuration ---
const CONFIG = {
  rtmp: {
    port: 1935,
    chunk_size: 60000,
    gop_cache: true,
    ping: 30,
    ping_timeout: 60
  },
  http: {
    port: 8000,
    allow_origin: '*',
    mediaroot: './media', // NMS internal media root
    api: true // Enable API for status polling
  },
  transcode: {
    ffmpeg: process.env.FFMPEG_PATH || 'ffmpeg',
    gpuEnabled: process.env.ENABLE_GPU === 'true', // Enable GPU transcoding via env var
    tasks: [
      {
        app: 'live',
        hls: true,
        hlsFlags: '[hls_time=2:hls_list_size=6:hls_flags=delete_segments]', // LL-HLS optimized
        dash: true,
        dashFlags: '[f=dash:window_size=3:extra_window_size=5]'
      }
    ]
  },
  outputDir: './media/streams', // Custom output for our manual FFMPEG
  bitrates: {
    h264: {
      '720p': { bitrate: '2000k', audio: '128k', size: '1280x720' },
      '480p': { bitrate: '1500k', audio: '96k', size: '854x480' },
      '360p': { bitrate: '1000k', audio: '64k', size: '640x360' },
      '240p': { bitrate: '500k', audio: '48k', size: '426x240' }
    },
    h265: {
      '720p': { bitrate: '1000k', audio: '96k', size: '1280x720' }, // ~50% bitrate savings
      '480p': { bitrate: '750k', audio: '64k', size: '854x480' },
      '360p': { bitrate: '500k', audio: '48k', size: '640x360' },
      '240p': { bitrate: '250k', audio: '32k', size: '426x240' }
    }
  }
};

// Ensure output directory exists
if (!fs.existsSync(CONFIG.outputDir)) {
  fs.mkdirSync(CONFIG.outputDir, { recursive: true });
}

// Serve HLS segments with CORS and Cache-Control headers for LL-HLS
app.use('/streams', express.static(CONFIG.outputDir, {
  setHeaders: (res, path, stat) => {
    res.set('Access-Control-Allow-Origin', '*');
    if (path.endsWith('.m3u8')) {
      res.set('Cache-Control', 'no-cache, no-store, must-revalidate'); // Playlist must be fresh for LL-HLS
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
    } else if (path.endsWith('.ts') || path.endsWith('.m4s') || path.endsWith('.mp4')) {
      res.set('Cache-Control', 'public, max-age=31536000, immutable'); // Segments are immutable
    }
  }
}));

// --- In-Memory Data Stores ---
const rooms = new Map(); // Map<streamKey, RoomData>
const activeStreams = new Map(); // Track active streams
const activeEncodings = new Map(); // Track ffmpeg processes

// Room data structure
function createRoom(streamKey) {
  return {
    streamKey,
    participants: new Map(), // Map<socketId, ParticipantData>
    messages: [], // Chat history (in-memory)
    polls: [], // Active and past polls
    handRaises: [], // Queue of hand raises
    streamSettings: {
      h265Enabled: false // Default to H.264 only
    }
  };
}

// --- Socket.IO Event Handlers ---
io.on('connection', (socket) => {
  console.log(`[Socket.IO] Client connected: ${socket.id}`);

  // Join a room (class/stream)
  socket.on('join-room', ({ streamKey, username, role }) => {
    console.log(`[Socket.IO] ${username} (${role}) joining room: ${streamKey}`);

    // Create room if it doesn't exist
    if (!rooms.has(streamKey)) {
      rooms.set(streamKey, createRoom(streamKey));
    }

    const room = rooms.get(streamKey);

    // Add participant
    room.participants.set(socket.id, {
      socketId: socket.id,
      username: username || 'Anonymous',
      role: role || 'student', // 'teacher' or 'student'
      joinedAt: Date.now(),
      handRaised: false
    });

    // Join socket.io room
    socket.join(streamKey);

    // Send current room state to the new participant
    socket.emit('room-state', {
      messages: room.messages.slice(-50), // Last 50 messages
      polls: room.polls.filter(p => p.status === 'active'), // Active polls only
      participants: Array.from(room.participants.values()),
      streamSettings: room.streamSettings
    });

    // Notify others in the room
    socket.to(streamKey).emit('participant-joined', {
      participant: room.participants.get(socket.id),
      totalCount: room.participants.size
    });

    // Store streamKey in socket for cleanup
    socket.data.streamKey = streamKey;
    socket.data.username = username;
    socket.data.role = role;
  });

  // Chat message
  socket.on('chat-message', ({ message }) => {
    const { streamKey, username, role } = socket.data;
    if (!streamKey || !rooms.has(streamKey)) return;

    const room = rooms.get(streamKey);
    const chatMessage = {
      id: uuidv4(),
      username,
      role,
      message,
      timestamp: Date.now()
    };

    room.messages.push(chatMessage);

    // Broadcast to all in room including sender
    io.to(streamKey).emit('chat-message', chatMessage);
  });

  // Create poll (teacher only)
  socket.on('create-poll', ({ question, options, duration }) => {
    const { streamKey, role } = socket.data;
    if (!streamKey || role !== 'teacher' || !rooms.has(streamKey)) return;

    const room = rooms.get(streamKey);
    const poll = {
      id: uuidv4(),
      question,
      options: options.map(opt => ({
        id: uuidv4(),
        text: opt,
        votes: 0
      })),
      voters: new Set(), // Track who voted
      status: 'active',
      createdAt: Date.now(),
      duration: duration || null
    };

    room.polls.push(poll);

    // Broadcast new poll to all participants
    io.to(streamKey).emit('new-poll', poll);

    // Auto-close poll after duration if specified
    if (duration) {
      setTimeout(() => {
        poll.status = 'closed';
        io.to(streamKey).emit('poll-closed', { pollId: poll.id });
      }, duration * 1000);
    }
  });

  // Vote on poll
  socket.on('vote-poll', ({ pollId, optionId }) => {
    const { streamKey } = socket.data;
    if (!streamKey || !rooms.has(streamKey)) return;

    const room = rooms.get(streamKey);
    const poll = room.polls.find(p => p.id === pollId);

    if (!poll || poll.status !== 'active') return;
    if (poll.voters.has(socket.id)) return; // Already voted

    const option = poll.options.find(o => o.id === optionId);
    if (!option) return;

    option.votes++;
    poll.voters.add(socket.id);

    // Broadcast updated poll results
    io.to(streamKey).emit('poll-updated', {
      pollId: poll.id,
      options: poll.options,
      totalVotes: poll.voters.size
    });
  });

  // Close poll (teacher only)
  socket.on('close-poll', ({ pollId }) => {
    const { streamKey, role } = socket.data;
    if (!streamKey || role !== 'teacher' || !rooms.has(streamKey)) return;

    const room = rooms.get(streamKey);
    const poll = room.polls.find(p => p.id === pollId);

    if (poll && poll.status === 'active') {
      poll.status = 'closed';
      io.to(streamKey).emit('poll-closed', { pollId: poll.id });
    }
  });

  // Hand raise
  socket.on('raise-hand', () => {
    const { streamKey, username } = socket.data;
    if (!streamKey || !rooms.has(streamKey)) return;

    const room = rooms.get(streamKey);
    const participant = room.participants.get(socket.id);

    if (participant && !participant.handRaised) {
      participant.handRaised = true;
      room.handRaises.push({
        socketId: socket.id,
        username,
        timestamp: Date.now()
      });

      // Notify teacher
      io.to(streamKey).emit('hand-raised', {
        socketId: socket.id,
        username,
        queue: room.handRaises
      });
    }
  });

  // Lower hand
  socket.on('lower-hand', () => {
    const { streamKey } = socket.data;
    if (!streamKey || !rooms.has(streamKey)) return;

    const room = rooms.get(streamKey);
    const participant = room.participants.get(socket.id);

    if (participant && participant.handRaised) {
      participant.handRaised = false;
      room.handRaises = room.handRaises.filter(h => h.socketId !== socket.id);

      io.to(streamKey).emit('hand-lowered', {
        socketId: socket.id,
        queue: room.handRaises
      });
    }
  });

  // Update stream settings (teacher only) - H.265 toggle
  socket.on('update-stream-settings', ({ h265Enabled }) => {
    const { streamKey, role } = socket.data;
    if (!streamKey || role !== 'teacher' || !rooms.has(streamKey)) return;

    const room = rooms.get(streamKey);
    room.streamSettings.h265Enabled = h265Enabled;

    // Broadcast to all participants
    io.to(streamKey).emit('stream-settings-updated', room.streamSettings);
  });

  // Typing indicator
  socket.on('typing', ({ isTyping }) => {
    const { streamKey, username } = socket.data;
    if (!streamKey) return;

    socket.to(streamKey).emit('user-typing', { username, isTyping });
  });

  // Disconnect
  socket.on('disconnect', () => {
    const { streamKey, username } = socket.data;
    if (!streamKey || !rooms.has(streamKey)) return;

    const room = rooms.get(streamKey);
    room.participants.delete(socket.id);
    room.handRaises = room.handRaises.filter(h => h.socketId !== socket.id);

    socket.to(streamKey).emit('participant-left', {
      username,
      totalCount: room.participants.size
    });

    console.log(`[Socket.IO] ${username} disconnected from room: ${streamKey}`);

    // Clean up empty rooms
    if (room.participants.size === 0) {
      rooms.delete(streamKey);
      console.log(`[Socket.IO] Room ${streamKey} deleted (no participants)`);
    }
  });
});

// --- Node Media Server Setup ---
const nms = new NodeMediaServer(CONFIG);

nms.on('prePublish', (id, StreamPath, args) => {
  const logMsg = `[${new Date().toISOString()}] [NodeEvent on prePublish] id=${id} StreamPath=${StreamPath}\n`;
  try { fs.appendFileSync('debug.log', logMsg); } catch (e) { }
  console.log(logMsg.trim());
});

nms.on('postPublish', (id, StreamPath, args) => {
  const logMsg = `[${new Date().toISOString()}] [NodeEvent on postPublish] id type=${typeof id} keys=${(id && typeof id === 'object') ? Object.keys(id).join(',') : 'N/A'} StreamPath=${StreamPath} args=${JSON.stringify(args)}\n`;
  try { fs.appendFileSync('debug.log', logMsg); } catch (e) { }

  try {
    console.log(logMsg.trim());

    // NMS passes the session object as the first parameter
    let key = StreamPath;
    let publisherIp = 'unknown';

    // Extract stream path and IP from session object
    if (!key && id && typeof id === 'object') {
      // Get stream path
      key = id.streamPath || id.publishStreamPath || id.path;

      // Get IP address
      publisherIp = id.ip || 'unknown';

      if (!key && id.connectCmdObj) {
        // Fallback to connectCmdObj
        key = id.connectCmdObj.streamPath || id.connectCmdObj.path || id.connectCmdObj.app + '/' + id.connectCmdObj.streamName;
      }
    } else if (args && args.ip) {
      // If args exists, use it
      publisherIp = args.ip;
    }

    if (!key) {
      const errorMsg = `[${new Date().toISOString()}] StreamPath is undefined, cannot start transcoding. Session keys: ${id ? Object.keys(id).join(', ') : 'N/A'}\n`;
      try { fs.appendFileSync('debug.log', errorMsg); } catch (e) { }
      console.error('StreamPath is undefined, cannot start transcoding');
      return;
    }

    const streamKey = key.split('/').pop();
    console.log(`[Media Server] Stream started: ${streamKey} from ${publisherIp}`);

    // Track stream as active
    activeStreams.set(streamKey, {
      startTime: Date.now(),
      publisherIp: publisherIp
    });

    // Get H.265 setting from room if exists
    const room = rooms.get(streamKey);
    const h265Enabled = room ? room.streamSettings.h265Enabled : false;

    startTranscoding(streamKey, h265Enabled);
  } catch (error) {
    const errorMsg = `[${new Date().toISOString()}] [NodeEvent on postPublish] Error: ${error.message}\n${error.stack}\n`;
    try { fs.appendFileSync('debug.log', errorMsg); } catch (e) { }
    console.error('[NodeEvent on postPublish] Error:', error);
  }
});

nms.on('donePublish', (id, StreamPath, args) => {
  console.log('[NodeEvent on donePublish]', `id=${id} StreamPath=${StreamPath} args=${JSON.stringify(args)}`);

  // Extract stream path from session object (same as postPublish)
  let key = StreamPath;
  if (!key && typeof id === 'object') {
    key = id.streamPath || id.publishStreamPath || id.StreamPath;
  }

  if (key) {
    const streamKey = key.split('/').pop();
    console.log(`[Media Server] Stream stopped: ${streamKey}`);

    activeStreams.delete(streamKey);

    // Stop encoding processes
    if (activeEncodings.has(streamKey)) {
      const encodings = activeEncodings.get(streamKey);
      encodings.forEach(cmd => {
        try {
          cmd.kill('SIGKILL');
          console.log(`[Encoding] Killed encoding process for ${streamKey}`);
        } catch (e) {
          console.error('Error killing encoding process:', e);
        }
      });
      activeEncodings.delete(streamKey);
    }

    // Auto-cleanup: Delete all stream files after 10 seconds
    console.log(`[Cleanup] Stream ended: ${streamKey}. Will delete files in 10 seconds...`);
    setTimeout(() => {
      try {
        // Delete m3u8 files
        const m3u8Files = fs.readdirSync(CONFIG.outputDir).filter(file =>
          file.startsWith(streamKey) && file.endsWith('.m3u8')
        );

        m3u8Files.forEach(file => {
          const filePath = `${CONFIG.outputDir}/${file}`;
          try {
            fs.unlinkSync(filePath);
            console.log(`[Cleanup] Deleted: ${file}`);
          } catch (err) {
            console.error(`[Cleanup] Error deleting ${file}:`, err.message);
          }
        });

        // Delete .ts and .m4s segment files (supporting both legacy and LL-HLS)
        const segmentFiles = fs.readdirSync(CONFIG.outputDir).filter(file =>
          file.startsWith(streamKey) && (file.endsWith('.ts') || file.endsWith('.m4s') || (file.endsWith('.mp4') && file.includes('init_')))
        );

        segmentFiles.forEach(file => {
          const filePath = `${CONFIG.outputDir}/${file}`;
          try {
            fs.unlinkSync(filePath);
          } catch (err) {
            // Ignore errors for already-deleted segments
          }
        });

        console.log(`[Cleanup] ✅ Completed for ${streamKey}: deleted ${m3u8Files.length} playlists, ${segmentFiles.length} segments`);
      } catch (err) {
        console.error(`[Cleanup] ❌ Error for ${streamKey}:`, err.message);
      }
    }, 10000); // 10 seconds delay
  } else {
    console.error('[donePublish] Could not extract stream key');
  }
});

nms.run();

// --- Custom FFMPEG Transcoding ---
function startTranscoding(streamKey, h265Enabled = false) {
  const inputUrl = `rtmp://localhost:${CONFIG.rtmp.port}/live/${streamKey}`;
  const useGpu = CONFIG.transcode.gpuEnabled;
  console.log(`Starting custom transcoding for ${streamKey} from ${inputUrl} (H.265: ${h265Enabled ? 'enabled' : 'disabled'}, GPU: ${useGpu ? 'enabled' : 'disabled'})`);

  const encodingProcesses = [];

  // H.264 Process (always enabled)
  const cmdH264 = ffmpeg(inputUrl)
    .inputOptions(['-re']);

  Object.entries(CONFIG.bitrates.h264).forEach(([res, settings]) => {
    cmdH264.output(`${CONFIG.outputDir}/${streamKey}_h264_${res}.m3u8`);

    if (useGpu) {
      cmdH264
        .videoCodec('h264_nvenc')
        .outputOptions(['-preset p4', '-tune ll']); // Low latency preset for NVENC
    } else {
      cmdH264
        .videoCodec('libx264')
        .outputOptions(['-preset veryfast']);
    }

    cmdH264
      .audioCodec('aac')
      .audioChannels(2)            // Stereo audio
      .audioFrequency(44100)       // 44.1kHz sample rate
      .size(settings.size)
      .videoBitrate(settings.bitrate)
      .audioBitrate(settings.audio)
      .outputOptions([
        '-g 30',                       // Reduce GOP to 1 second (30fps) for faster seeking
        '-sc_threshold 0',
        '-hls_time 1',                 // 1-second segments for LL-HLS
        '-hls_list_size 4',            // Keep 4 segments in playlist
        '-hls_flags delete_segments+independent_segments+program_date_time',
        '-hls_segment_type fmp4',      // Use fragmented MP4 for LL-HLS
        `-hls_fmp4_init_filename init_${streamKey}_h264_${res}.mp4`,
        `-hls_segment_filename ${CONFIG.outputDir}/${streamKey}_h264_${res}_%03d.m4s`,
        '-movflags +frag_keyframe+empty_moov+default_base_moof'  // Important for fMP4 streaming with audio
      ]);
  });

  cmdH264.on('start', (cmd) => {
    console.log('H.264 Transcoding started:', cmd);
    createMasterPlaylist(streamKey, 'h264');
  });

  cmdH264.on('error', (err) => console.error('H.264 Error:', err.message));
  cmdH264.run();
  encodingProcesses.push(cmdH264);

  // H.265 Process (conditional)
  if (h265Enabled) {
    const cmdH265 = ffmpeg(inputUrl)
      .inputOptions(['-re']);

    Object.entries(CONFIG.bitrates.h265).forEach(([res, settings]) => {
      cmdH265.output(`${CONFIG.outputDir}/${streamKey}_h265_${res}.m3u8`);

      if (useGpu) {
        cmdH265
          .videoCodec('hevc_nvenc')
          .outputOptions(['-preset p4', '-tune ll', '-tag:v hvc1']);
      } else {
        cmdH265
          .videoCodec('libx265')
          .outputOptions(['-preset fast', '-tag:v hvc1']);
      }

      cmdH265
        .audioCodec('aac')
        .audioChannels(2)            // Stereo audio
        .audioFrequency(44100)       // 44.1kHz sample rate
        .size(settings.size)
        .videoBitrate(settings.bitrate)
        .audioBitrate(settings.audio)
        .outputOptions([
          '-g 30',                       // Reduce GOP to 1 second for LL-HLS
          '-sc_threshold 0',
          '-hls_time 1',                 // 1-second segments for LL-HLS
          '-hls_list_size 4',            // Keep 4 segments in playlist
          '-hls_flags delete_segments+independent_segments+program_date_time',
          '-hls_segment_type fmp4',      // Use fragmented MP4 for LL-HLS
          `-hls_fmp4_init_filename init_${streamKey}_h265_${res}.mp4`,
          `-hls_segment_filename ${CONFIG.outputDir}/${streamKey}_h265_${res}_%03d.m4s`,
          '-movflags +frag_keyframe+empty_moov+default_base_moof',  // Important for fMP4 streaming with audio
        ]);
    });

    cmdH265.on('start', (cmd) => {
      console.log('H.265 Transcoding started:', cmd);
      createMasterPlaylist(streamKey, 'h265');
    });

    cmdH265.on('error', (err) => console.error('H.265 Error:', err.message));
    cmdH265.run();
    encodingProcesses.push(cmdH265);
  }

  // Store encoding processes for cleanup
  activeEncodings.set(streamKey, encodingProcesses);
}

function createMasterPlaylist(streamKey, codec) {
  const variants = CONFIG.bitrates[codec];
  let content = '#EXTM3U\n#EXT-X-VERSION:3\n';

  Object.entries(variants).forEach(([res, settings]) => {
    const bandwidth = (parseInt(settings.bitrate) + parseInt(settings.audio)) * 1000;
    const resolution = settings.size;
    content += `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${resolution}\n`;
    content += `${streamKey}_${codec}_${res}.m3u8\n`;
  });

  fs.writeFileSync(`${CONFIG.outputDir}/${streamKey}_${codec}.m3u8`, content);
  console.log(`Created Master Playlist for ${codec}: ${streamKey}_${codec}.m3u8`);
}

// --- REST API Endpoints ---

// Get stream URLs
app.get('/api/streams/:key', (req, res) => {
  const { key } = req.params;
  res.json({
    h264: `/streams/${key}_h264.m3u8`,
    h265: `/streams/${key}_h265.m3u8`
  });
});

// Get all active streams (Status Polling)
app.get('/api/streams', (req, res) => {
  const live = {};
  activeStreams.forEach((value, key) => {
    // Count subscribers from room participants
    const room = rooms.get(key);
    const subscribers = room ? room.participants.size - 1 : 0; // Exclude teacher

    live[key] = {
      publisher: { ip: value.publisherIp },
      subscribers: Math.max(0, subscribers)
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

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`API Server with Socket.IO running on port ${PORT}`);
  console.log(`Socket.IO ready for connections`);
});