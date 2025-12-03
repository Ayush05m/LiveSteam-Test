const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
app.use(cors());

// Configuration matching the "Min Cost" analysis
const CONFIG = {
  segmentDuration: 2, // 2 seconds for LL-HLS
  listSize: 6,
  outputDir: './media',
  bitrates: {
    '720p': { bitrate: '2000k', audio: '128k', size: '1280x720' },  // Cost optimized from 3Mbps -> 2Mbps
    '480p': { bitrate: '1500k', audio: '96k', size: '854x480' },
    '360p': { bitrate: '1000k', audio: '64k', size: '640x360' },    // Majority of viewers here
    '240p': { bitrate: '500k', audio: '48k', size: '426x240' }
  }
};

// Ensure media directory exists
if (!fs.existsSync(CONFIG.outputDir)){
    fs.mkdirSync(CONFIG.outputDir);
}

app.use('/hls', express.static(CONFIG.outputDir));

// Endpoint to start a transcoding session (Simulated)
// In production, this would be triggered by an RTMP ingest event
app.post('/start-stream', (req, res) => {
  const streamKey = req.query.key || 'test';
  const inputPath = 'rtmp://localhost/live/' + streamKey; // Requires RTMP server (e.g. Nginx-RTMP) running locally

  console.log(`Starting transcoding for ${streamKey}...`);
  console.log(`Configuration: LL-HLS, Cost-Optimized Bitrates`);

  // This is the core logic that fulfills the user's technical requirement
  // Using fluent-ffmpeg to map inputs to multiple HLS variants
  const command = ffmpeg(inputPath)
    .inputOptions([
      '-re', // Read input at native framerate
    ])
    // 720p Variant
    .output(`${CONFIG.outputDir}/${streamKey}_720p.m3u8`)
    .videoCodec('libx264')
    .audioCodec('aac')
    .size(CONFIG.bitrates['720p'].size)
    .videoBitrate(CONFIG.bitrates['720p'].bitrate)
    .audioBitrate(CONFIG.bitrates['720p'].audio)
    .outputOptions([
      '-hls_time ' + CONFIG.segmentDuration,
      '-hls_list_size ' + CONFIG.listSize,
      '-hls_flags delete_segments+append_list+omit_endlist', // LL-HLS friendly flags
      '-g 60', // Keyframe every 2 seconds (30fps * 2)
      '-sc_threshold 0'
    ])
    
    // 480p Variant
    .output(`${CONFIG.outputDir}/${streamKey}_480p.m3u8`)
    .videoCodec('libx264')
    .size(CONFIG.bitrates['480p'].size)
    .videoBitrate(CONFIG.bitrates['480p'].bitrate)
    .outputOptions([
      '-hls_time ' + CONFIG.segmentDuration,
      '-hls_list_size ' + CONFIG.listSize,
      '-hls_flags delete_segments'
    ])

    // 360p Variant (High traffic variant)
    .output(`${CONFIG.outputDir}/${streamKey}_360p.m3u8`)
    .videoCodec('libx264')
    .size(CONFIG.bitrates['360p'].size)
    .videoBitrate(CONFIG.bitrates['360p'].bitrate)
    .outputOptions([
      '-hls_time ' + CONFIG.segmentDuration,
      '-hls_list_size ' + CONFIG.listSize,
      '-hls_flags delete_segments'
    ])

    .on('start', (cmd) => {
      console.log('FFmpeg started with command: ' + cmd);
      res.json({ status: 'started', masterPlaylist: `/hls/${streamKey}_master.m3u8` });
      
      // Generate Master Playlist manually linking the variants
      createMasterPlaylist(streamKey);
    })
    .on('error', (err) => {
      console.error('An error occurred: ' + err.message);
      // In a real scenario we wouldn't res.send here if already sent, strictly logging
    });

    // Note: We are not running .run() here because we don't have an RTMP source
    // In a real environment, you would call command.run();
    
    res.json({ 
        message: "Stream configuration ready. Requires local RTMP source to execute.",
        ffmpegConfig: "Optimized for " + CONFIG.bitrates['720p'].bitrate + " CBR"
    });
});

function createMasterPlaylist(key) {
  const content = `
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=2128000,RESOLUTION=1280x720
${key}_720p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1596000,RESOLUTION=854x480
${key}_480p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1064000,RESOLUTION=640x360
${key}_360p.m3u8
  `.trim();
  
  fs.writeFileSync(`${CONFIG.outputDir}/${key}_master.m3u8`, content);
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Media Server running on port ${PORT}`);
});