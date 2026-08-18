const { spawnSync } = require('child_process');
const { getFfmpegPath } = require('./ffmpegPath');

let cachedEncoder;

function getH264Encoder() {
  if (process.env.FFMPEG_H264_ENCODER) return process.env.FFMPEG_H264_ENCODER;
  if (cachedEncoder !== undefined) return cachedEncoder;
  const result = spawnSync(getFfmpegPath(), ['-hide_banner', '-encoders'], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  const output = String(result.stdout || '') + String(result.stderr || '');
  cachedEncoder = ['libx264', 'libopenh264', 'h264_mf'].find((name) => new RegExp(`\\b${name}\\b`).test(output)) || null;
  return cachedEncoder;
}

function h264Args(options = {}) {
  const encoder = getH264Encoder();
  if (!encoder) throw new Error('当前 FFmpeg 没有可用的 H.264 编码器');
  if (encoder === 'libx264') return ['-c:v', encoder, '-preset', options.preset || 'fast', '-crf', String(options.crf ?? 23)];
  return ['-c:v', encoder, '-b:v', options.bitrate || '6M'];
}

module.exports = { getH264Encoder, h264Args };
