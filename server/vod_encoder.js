import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import CONFIG from './config.js';

/**
 * VOD Encoder - Re-encodes recorded FLV to multiple HLS renditions for VOD
 * 
 * Usage:
 *   node vod_encoder.js <path-to-flv>
 * 
 * This creates a complete adaptive bitrate HLS package from the recording.
 */

export const VOD_RENDITIONS = [
    { name: '1080p', width: 1920, height: 1080, bitrate: '5000k', audioBitrate: '192k' },
    { name: '720p', width: 1280, height: 720, bitrate: '2500k', audioBitrate: '128k' },
    { name: '480p', width: 854, height: 480, bitrate: '1500k', audioBitrate: '96k' },
    { name: '360p', width: 640, height: 360, bitrate: '800k', audioBitrate: '64k' },
    { name: '240p', width: 426, height: 240, bitrate: '400k', audioBitrate: '48k' }
];

/**
 * Creates master playlist for VOD
 */
function createMasterPlaylist(outputDir, baseName, renditions) {
    let content = '#EXTM3U\n#EXT-X-VERSION:3\n';

    renditions.forEach(r => {
        const bandwidth = (parseInt(r.bitrate) + parseInt(r.audioBitrate)) * 1000;
        content += `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${r.width}x${r.height}\n`;
        content += `${baseName}_${r.name}.m3u8\n`;
    });

    const masterPath = path.join(outputDir, `${baseName}_master.m3u8`);
    fs.writeFileSync(masterPath, content);
    console.log(`[VOD] Created master playlist: ${masterPath}`);
    return masterPath;
}

/**
 * Re-encodes a recording to VOD renditions
 * @param {string} inputPath - Path to the FLV recording
 * @param {string} outputDir - Directory to output VOD files
 * @param {boolean} useGpu - Whether to use GPU encoding
 * @returns {Promise<string>} - Path to master playlist
 */
export function encodeToVOD(inputPath, outputDir, useGpu = false) {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(inputPath)) {
            return reject(new Error(`Input file not found: ${inputPath}`));
        }

        const baseName = path.basename(inputPath, path.extname(inputPath));
        const vodDir = path.join(outputDir, baseName);

        if (!fs.existsSync(vodDir)) {
            fs.mkdirSync(vodDir, { recursive: true });
        }

        console.log(`[VOD] Starting encoding: ${inputPath}`);
        console.log(`[VOD] Output directory: ${vodDir}`);
        console.log(`[VOD] GPU: ${useGpu ? 'ENABLED' : 'DISABLED'}`);

        const args = [
            '-i', inputPath,
            '-y'
        ];

        // Add each rendition as an output
        VOD_RENDITIONS.forEach(r => {
            const outputPath = path.join(vodDir, `${baseName}_${r.name}.m3u8`);
            const segmentPath = path.join(vodDir, `${baseName}_${r.name}_%03d.ts`);

            args.push('-map', '0:v:0', '-map', '0:a:0');

            // Video encoder
            if (useGpu) {
                args.push('-c:v', 'h264_nvenc', '-preset', 'p4');
            } else {
                args.push('-c:v', 'libx264', '-preset', 'medium'); // Higher quality for VOD
            }

            args.push(
                '-b:v', r.bitrate,
                '-maxrate', r.bitrate,
                '-bufsize', `${parseInt(r.bitrate) * 2}k`,
                '-vf', `scale=${r.width}:${r.height}`,
                '-g', '48',
                '-keyint_min', '48',
                '-sc_threshold', '0'
            );

            // Audio
            args.push('-c:a', 'aac', '-b:a', r.audioBitrate, '-ac', '2', '-ar', '44100');

            // HLS output (VOD mode - keep all segments)
            args.push(
                '-f', 'hls',
                '-hls_time', '4',           // 4 second segments for VOD (better seeking)
                '-hls_list_size', '0',      // Keep all segments
                '-hls_playlist_type', 'vod', // Mark as VOD
                '-hls_segment_filename', segmentPath,
                outputPath
            );
        });

        console.log(`[VOD] FFmpeg command: ffmpeg ${args.slice(0, 20).join(' ')}...`);

        const ffmpegProcess = spawn('ffmpeg', args);

        let lastProgress = 0;
        ffmpegProcess.stderr.on('data', (data) => {
            const msg = data.toString();
            // Parse progress
            const timeMatch = msg.match(/time=(\d+:\d+:\d+\.\d+)/);
            if (timeMatch) {
                const timeStr = timeMatch[1];
                const now = Date.now();
                if (now - lastProgress > 5000) { // Log every 5 seconds
                    console.log(`[VOD] Progress: ${timeStr}`);
                    lastProgress = now;
                }
            }
            if (msg.includes('Error') || msg.includes('error')) {
                console.error(`[VOD] ${msg}`);
            }
        });

        ffmpegProcess.on('close', (code) => {
            if (code === 0) {
                const masterPath = createMasterPlaylist(vodDir, baseName, VOD_RENDITIONS);
                console.log(`[VOD] ✅ Encoding complete: ${masterPath}`);
                resolve(masterPath);
            } else {
                reject(new Error(`FFmpeg exited with code ${code}`));
            }
        });

        ffmpegProcess.on('error', (err) => {
            reject(err);
        });
    });
}

/**
 * Process all pending recordings in a directory
 */
export async function processAllRecordings(recordingDir, vodDir, useGpu = false) {
    const files = fs.readdirSync(recordingDir).filter(f => f.endsWith('.flv'));

    console.log(`[VOD] Found ${files.length} recordings to process`);

    for (const file of files) {
        const inputPath = path.join(recordingDir, file);
        try {
            await encodeToVOD(inputPath, vodDir, useGpu);

            // Move processed file to 'processed' folder
            const processedDir = path.join(recordingDir, 'processed');
            if (!fs.existsSync(processedDir)) fs.mkdirSync(processedDir);

            const newPath = path.join(processedDir, file);
            fs.renameSync(inputPath, newPath);
            console.log(`[VOD] Moved to processed: ${newPath}`);

        } catch (error) {
            console.error(`[VOD] ❌ Failed to process ${file}:`, error.message);
        }
    }
}

// CLI mode check for ESM
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2);

    if (args.length === 0) {
        // Process all recordings
        const recordingDir = CONFIG.recordingDir;
        const vodDir = path.join(CONFIG.outputDir, 'vod');
        const useGpu = process.env.ENABLE_GPU === 'true';

        processAllRecordings(recordingDir, vodDir, useGpu)
            .then(() => console.log('[VOD] All recordings processed'))
            .catch(err => console.error('[VOD] Error:', err));
    } else {
        // Process single file
        const inputPath = args[0];
        const vodDir = args[1] || path.join(CONFIG.outputDir, 'vod');
        const useGpu = process.env.ENABLE_GPU === 'true';

        encodeToVOD(inputPath, vodDir, useGpu)
            .then(masterPath => console.log(`[VOD] Done: ${masterPath}`))
            .catch(err => console.error('[VOD] Error:', err));
    }
}
