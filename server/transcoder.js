const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const CONFIG = require('./config');

// Track active FFmpeg processes
const activeProcesses = new Map();

/**
 * Creates master HLS playlist pointing to all renditions
 */
function createMasterPlaylist(streamKey, codec, renditions) {
    let content = '#EXTM3U\n#EXT-X-VERSION:3\n';

    renditions.forEach(r => {
        const bandwidth = (parseInt(r.bitrate) + parseInt(r.audioBitrate)) * 1000;
        content += `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${r.width}x${r.height}\n`;
        content += `${streamKey}_${codec}_${r.name}.m3u8\n`;
    });

    const masterPath = path.join(CONFIG.outputDir, `${streamKey}_${codec}.m3u8`);
    fs.writeFileSync(masterPath, content);
    console.log(`[Transcoder] Created master playlist: ${masterPath}`);
}

/**
 * Builds FFmpeg arguments for multi-rendition transcoding
 */
function buildFFmpegArgs(inputUrl, streamKey, useGpu, enableH265) {
    const args = [
        '-i', inputUrl,
        '-y',  // Overwrite output files
        '-max_muxing_queue_size', '1024'
    ];

    // --- H.264 Outputs ---
    CONFIG.renditions.h264.forEach((r, idx) => {
        const outputPath = path.join(CONFIG.outputDir, `${streamKey}_h264_${r.name}.m3u8`);
        const segmentPath = path.join(CONFIG.outputDir, `${streamKey}_h264_${r.name}_%03d.ts`);

        // Map to new output stream
        args.push('-map', '0:v:0', '-map', '0:a:0');

        // Video encoder
        if (useGpu) {
            args.push('-c:v', 'h264_nvenc', '-preset', 'p4', '-tune', 'll');
        } else {
            args.push('-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency');
        }

        // Video settings
        args.push(
            '-b:v', r.bitrate,
            '-maxrate', r.bitrate,
            '-bufsize', `${parseInt(r.bitrate) * 2}k`,
            '-vf', `scale=${r.width}:${r.height}`,
            '-g', '30',  // Keyframe every 30 frames (1s at 30fps)
            '-sc_threshold', '0'
        );

        // Audio settings
        args.push('-c:a', 'aac', '-b:a', r.audioBitrate, '-ac', '2', '-ar', '44100');

        // HLS settings (Low Latency)
        args.push(
            '-f', 'hls',
            '-hls_time', String(CONFIG.hls.segmentDuration),
            '-hls_list_size', String(CONFIG.hls.playlistSize),
            '-hls_flags', 'delete_segments+independent_segments',
            '-hls_segment_filename', segmentPath,
            outputPath
        );
    });

    // --- H.265 Outputs (Optional) ---
    if (enableH265) {
        CONFIG.renditions.h265.forEach((r, idx) => {
            const outputPath = path.join(CONFIG.outputDir, `${streamKey}_h265_${r.name}.m3u8`);
            const segmentPath = path.join(CONFIG.outputDir, `${streamKey}_h265_${r.name}_%03d.ts`);

            args.push('-map', '0:v:0', '-map', '0:a:0');

            if (useGpu) {
                args.push('-c:v', 'hevc_nvenc', '-preset', 'p4', '-tune', 'll', '-tag:v', 'hvc1');
            } else {
                args.push('-c:v', 'libx265', '-preset', 'fast', '-tag:v', 'hvc1');
            }

            args.push(
                '-b:v', r.bitrate,
                '-maxrate', r.bitrate,
                '-bufsize', `${parseInt(r.bitrate) * 2}k`,
                '-vf', `scale=${r.width}:${r.height}`,
                '-g', '30',
                '-sc_threshold', '0'
            );

            args.push('-c:a', 'aac', '-b:a', r.audioBitrate, '-ac', '2', '-ar', '44100');

            args.push(
                '-f', 'hls',
                '-hls_time', String(CONFIG.hls.segmentDuration),
                '-hls_list_size', String(CONFIG.hls.playlistSize),
                '-hls_flags', 'delete_segments+independent_segments',
                '-hls_segment_filename', segmentPath,
                outputPath
            );
        });
    }

    // --- Recording Output (Full quality, no re-encode) ---
    const timestamp = Date.now();
    const recordingPath = path.join(CONFIG.recordingDir, `${streamKey}_${timestamp}.flv`);

    args.push('-map', '0:v:0', '-map', '0:a:0');
    args.push('-c', 'copy');  // No re-encoding for recording
    args.push('-f', 'flv', recordingPath);

    return { args, recordingPath };
}

/**
 * Starts FFmpeg transcoding process
 */
function startTranscoding(streamKey, enableH265 = false) {
    const inputUrl = `rtmp://127.0.0.1:${CONFIG.rtmp.port}/live/${streamKey}`;
    const useGpu = CONFIG.transcode.gpuEnabled;

    console.log(`[Transcoder] Starting for ${streamKey}`);
    console.log(`[Transcoder] GPU: ${useGpu ? 'ENABLED' : 'DISABLED'}, H.265: ${enableH265 ? 'ENABLED' : 'DISABLED'}`);

    // Ensure directories exist
    if (!fs.existsSync(CONFIG.outputDir)) fs.mkdirSync(CONFIG.outputDir, { recursive: true });
    if (!fs.existsSync(CONFIG.recordingDir)) fs.mkdirSync(CONFIG.recordingDir, { recursive: true });

    // Build FFmpeg command
    const { args, recordingPath } = buildFFmpegArgs(inputUrl, streamKey, useGpu, enableH265);

    console.log(`[Transcoder] FFmpeg command: ffmpeg ${args.join(' ')}`);

    // Spawn FFmpeg process
    const ffmpegProcess = spawn(CONFIG.transcode.ffmpeg, args, {
        stdio: ['ignore', 'pipe', 'pipe']
    });

    ffmpegProcess.stdout.on('data', (data) => {
        // FFmpeg sends most output to stderr, stdout is usually empty
    });

    ffmpegProcess.stderr.on('data', (data) => {
        const msg = data.toString();
        // Only log errors, not progress
        if (msg.includes('Error') || msg.includes('error')) {
            console.error(`[FFmpeg] ${msg}`);
        }
    });

    ffmpegProcess.on('close', (code) => {
        console.log(`[Transcoder] FFmpeg exited with code ${code} for ${streamKey}`);
        activeProcesses.delete(streamKey);
    });

    ffmpegProcess.on('error', (err) => {
        console.error(`[Transcoder] Failed to start FFmpeg:`, err);
    });

    // Store process reference
    activeProcesses.set(streamKey, {
        process: ffmpegProcess,
        recordingPath: recordingPath
    });

    // Create master playlists (after a short delay to ensure first segments are created)
    setTimeout(() => {
        createMasterPlaylist(streamKey, 'h264', CONFIG.renditions.h264);
        if (enableH265) {
            createMasterPlaylist(streamKey, 'h265', CONFIG.renditions.h265);
        }
    }, 2000);

    return recordingPath;
}

/**
 * Stops FFmpeg transcoding process
 */
function stopTranscoding(streamKey) {
    const entry = activeProcesses.get(streamKey);

    if (entry) {
        console.log(`[Transcoder] Stopping ${streamKey}`);

        // Send SIGINT for graceful shutdown (allows FFmpeg to finalize files)
        entry.process.kill('SIGINT');

        // Force kill after 5 seconds if still running
        setTimeout(() => {
            if (!entry.process.killed) {
                entry.process.kill('SIGKILL');
            }
        }, 5000);

        activeProcesses.delete(streamKey);

        return entry.recordingPath;
    }

    return null;
}

/**
 * Get recording path for a stream
 */
function getRecordingPath(streamKey) {
    const entry = activeProcesses.get(streamKey);
    return entry ? entry.recordingPath : null;
}

module.exports = {
    startTranscoding,
    stopTranscoding,
    getRecordingPath
};
