import path from 'path';

// Base directories
const MEDIA_ROOT = process.env.MEDIA_ROOT || './media';

const CONFIG = {
    // RTMP Server Config (for node-media-server)
    rtmp: {
        port: parseInt(process.env.RTMP_PORT) || 1935,
        chunk_size: 60000,
        gop_cache: true,
        ping: 30,
        ping_timeout: 60
    },

    // HTTP Server Config (for node-media-server internal)
    http: {
        port: 8000,
        allow_origin: '*',
        mediaroot: MEDIA_ROOT,
        api: true
    },

    // Transcoding Settings
    transcode: {
        ffmpeg: process.env.FFMPEG_PATH || 'ffmpeg',
        gpuEnabled: process.env.ENABLE_GPU === 'true'
    },

    // Output Directories
    outputDir: path.resolve(MEDIA_ROOT, 'streams'),
    recordingDir: path.resolve(MEDIA_ROOT, 'recordings'),

    // Rendition Settings (Multiple Qualities)
    renditions: {
        h264: [
            { name: '720p', width: 1280, height: 720, bitrate: '2500k', audioBitrate: '128k' },
            { name: '480p', width: 854, height: 480, bitrate: '1500k', audioBitrate: '96k' },
            { name: '360p', width: 640, height: 360, bitrate: '800k', audioBitrate: '64k' },
            { name: '240p', width: 426, height: 240, bitrate: '400k', audioBitrate: '48k' }
        ],
        h265: [
            { name: '720p', width: 1280, height: 720, bitrate: '1500k', audioBitrate: '96k' },
            { name: '480p', width: 854, height: 480, bitrate: '900k', audioBitrate: '64k' },
            { name: '360p', width: 640, height: 360, bitrate: '500k', audioBitrate: '48k' },
            { name: '240p', width: 426, height: 240, bitrate: '250k', audioBitrate: '32k' }
        ]
    },

    // HLS Settings for Low Latency
    hls: {
        segmentDuration: 1,  // 1 second segments for low latency
        playlistSize: 6,     // Keep 6 segments in live playlist (6 seconds buffer)
        deleteSegments: true // Delete old segments to save disk during live
    }
};

export default CONFIG;
