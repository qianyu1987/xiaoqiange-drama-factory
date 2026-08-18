const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const AdmZip = require('adm-zip');
const sharp = require('sharp');
const { getFfmpegPath, getFfprobePath } = require('../utils/ffmpegPath');
const { h264Args } = require('../utils/h264Encoder');

function storageRoot(cfg) {
  const configured = cfg?.storage?.local_path || './data/storage';
  return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
}

function safeName(value) {
  return String(value || 'episode').replace(/[\\/:*?"<>|\x00-\x1F]/g, '_').trim().slice(0, 80) || 'episode';
}

function localMediaPath(root, value) {
  if (!value) return null;
  const text = String(value).trim();
  if (/^https?:\/\//i.test(text)) {
    try {
      const u = new URL(text);
      if (!['127.0.0.1', 'localhost'].includes(u.hostname)) return null;
      return path.join(root, decodeURIComponent(u.pathname.replace(/^\/static\/?/, '')));
    } catch (_) { return null; }
  }
  return path.isAbsolute(text) ? text : path.join(root, text.replace(/^\/static\/?/, '').replace(/^\//, ''));
}

function srtTime(seconds) {
  const ms = Math.max(0, Math.round(Number(seconds || 0) * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const rem = ms % 1000;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':') + ',' + String(rem).padStart(3, '0');
}

function cleanDialogue(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[^：:\n]{1,20}[：:]\s*/, '').trim())
    .filter(Boolean)
    .join('\n');
}

function dialogueChunks(value) {
  const chunks = [];
  for (const dialogueLine of cleanDialogue(value).split(/\r?\n/).filter(Boolean)) {
    const characters = Array.from(dialogueLine);
    for (let offset = 0; offset < characters.length; offset += 36) {
      const cue = characters.slice(offset, offset + 36);
      chunks.push([cue.slice(0, 18).join(''), cue.slice(18, 36).join('')].filter(Boolean));
    }
  }
  return chunks;
}

function buildSrt(storyboards) {
  let cursor = 0;
  let index = 1;
  const blocks = [];
  for (const board of storyboards) {
    const duration = Math.max(1, Number(board.duration) || 10);
    const chunks = dialogueChunks(board.dialogue || board.narration);
    if (chunks.length) {
      const start = cursor + 0.2;
      const end = Math.max(start + 0.1, cursor + duration - 0.2);
      const cueDuration = (end - start) / chunks.length;
      chunks.forEach((lines, cueIndex) => {
        const cueStart = start + cueDuration * cueIndex;
        const cueEnd = cueIndex === chunks.length - 1 ? end : start + cueDuration * (cueIndex + 1);
        blocks.push(`${index++}\n${srtTime(cueStart)} --> ${srtTime(cueEnd)}\n${lines.join('\n')}`);
      });
    }
    cursor += duration;
  }
  return blocks.join('\n\n') + (blocks.length ? '\n' : '');
}

function probeMedia(filePath) {
  const result = spawnSync(getFfprobePath(), [
    '-v', 'error', '-show_streams', '-show_format', '-of', 'json', filePath,
  ], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  if (result.status === 0) {
    try {
      const payload = JSON.parse(result.stdout || '{}');
      const video = (payload.streams || []).find((s) => s.codec_type === 'video');
      const audio = (payload.streams || []).find((s) => s.codec_type === 'audio');
      return {
        ok: !!video,
        duration: Number(payload.format?.duration) || Number(video?.duration) || 0,
        width: Number(video?.width) || 0,
        height: Number(video?.height) || 0,
        video_codec: video?.codec_name || null,
        audio_codec: audio?.codec_name || null,
        has_audio: !!audio,
      };
    } catch (_) {}
  }

  // macOS internal builds may ship only ffmpeg. Its input summary is sufficient
  // for the delivery gates used here and keeps QA from reporting a false 0x0.
  const fallback = spawnSync(getFfmpegPath(), ['-hide_banner', '-i', filePath], {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
  const summary = String(fallback.stderr || fallback.stdout || '');
  const videoLine = summary.split('\n').find((line) => /Video:/.test(line)) || '';
  const audioLine = summary.split('\n').find((line) => /Audio:/.test(line)) || '';
  const dimensions = videoLine.match(/\b(\d{2,5})x(\d{2,5})\b/);
  const duration = summary.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/);
  const seconds = duration
    ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3])
    : 0;
  return {
    ok: !!dimensions,
    duration: seconds,
    width: dimensions ? Number(dimensions[1]) : 0,
    height: dimensions ? Number(dimensions[2]) : 0,
    video_codec: (videoLine.match(/Video:\s*([^\s,]+)/) || [])[1] || null,
    audio_codec: (audioLine.match(/Audio:\s*([^\s,]+)/) || [])[1] || null,
    has_audio: !!audioLine,
    error: dimensions ? null : String(result.stderr || 'ffprobe and ffmpeg probe failed').trim().slice(0, 500),
  };
}

function detectFrameIssues(filePath) {
  const result = spawnSync(getFfmpegPath(), [
    '-hide_banner', '-nostats', '-i', filePath,
    '-vf', 'blackdetect=d=0.5:pic_th=0.98,freezedetect=n=-60dB:d=2',
    '-an', '-f', 'null', '-',
  ], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  const output = String(result.stderr || '');
  return {
    checked: result.status === 0,
    black_segments: (output.match(/black_start:/g) || []).length,
    freeze_segments: (output.match(/freeze_start:/g) || []).length,
    error: result.status === 0 ? null : output.slice(-500),
  };
}

function ffmpegFilterPath(filePath) {
  return String(filePath).replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

function deliveryProfile(aspectRatio) {
  if (String(aspectRatio || '').replace(/：/g, ':') === '16:9') {
    return { aspectRatio: '16:9', width: 1920, height: 1080, durationRange: [78, 82], zhFontSize: 38, marginV: 55 };
  }
  return { aspectRatio: '9:16', width: 1080, height: 1920, durationRange: [45, 90], zhFontSize: 22, marginV: 76 };
}

function normalizeVideo(source, target, probe, subtitlePath, hasSubtitles, profile = deliveryProfile('9:16')) {
  const alreadyReady = !hasSubtitles && probe.ok && probe.width === profile.width && probe.height === profile.height && probe.video_codec === 'h264' && probe.audio_codec === 'aac';
  if (alreadyReady) { fs.copyFileSync(source, target); return { normalized: false }; }
  const filters = [`scale=${profile.width}:${profile.height}:force_original_aspect_ratio=decrease`, `pad=${profile.width}:${profile.height}:(ow-iw)/2:(oh-ih)/2:black`];
  if (hasSubtitles) filters.push(`subtitles='${ffmpegFilterPath(subtitlePath)}':force_style='FontSize=${profile.zhFontSize},Alignment=2,MarginV=${profile.marginV},Outline=2,Shadow=0'`);
  const args = ['-y', '-i', source, '-vf', filters.join(','), ...h264Args({ preset: 'medium', crf: 20, bitrate: '8M' }), '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', target];
  const result = spawnSync(getFfmpegPath(), args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (result.status === 0 && fs.existsSync(target)) return { normalized: true };
  fs.copyFileSync(source, target);
  return { normalized: false, warning: `${profile.width}x${profile.height} 标准化失败，已保留原始成片`, error: String(result.stderr || '').slice(-800) };
}

function escapeXml(value) {
  return String(value || '').replace(/[<>&'\"]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[ch]);
}

async function makeCover(source, target, title, profile = deliveryProfile('9:16')) {
  const landscape = profile.aspectRatio === '16:9';
  const boxX = Math.round(profile.width * 0.05);
  const boxWidth = Math.round(profile.width * 0.9);
  const boxHeight = landscape ? 230 : 330;
  const boxY = profile.height - boxHeight - Math.round(profile.height * 0.1);
  const centerX = Math.round(profile.width / 2);
  const titleY = boxY + Math.round(boxHeight * 0.48);
  const brandY = boxY + Math.round(boxHeight * 0.75);
  const overlay = Buffer.from(`<svg width="${profile.width}" height="${profile.height}" xmlns="http://www.w3.org/2000/svg">
    <rect x="${boxX}" y="${boxY}" width="${boxWidth}" height="${boxHeight}" rx="8" fill="#000" fill-opacity="0.72"/>
    <text x="${centerX}" y="${titleY}" text-anchor="middle" fill="#fff" font-size="${landscape ? 68 : 76}" font-family="Arial, sans-serif" font-weight="700">${escapeXml(title).slice(0, 20)}</text>
    <text x="${centerX}" y="${brandY}" text-anchor="middle" fill="#f3c548" font-size="${landscape ? 30 : 34}" font-family="Arial, sans-serif">小钱哥短剧工厂</text>
  </svg>`);
  await sharp(source).resize(profile.width, profile.height, { fit: 'cover', position: 'centre' }).composite([{ input: overlay }]).jpeg({ quality: 92 }).toFile(target);
}

function parseJson(value, fallback = {}) {
  try { return JSON.parse(value || ''); } catch (_) { return fallback; }
}

function getOpenChatCutReceipt(db, episodeId) {
  const row = db.prepare(`SELECT ps.result FROM pipeline_steps ps
    JOIN pipeline_runs pr ON pr.id = ps.run_id
    WHERE pr.episode_id = ? AND ps.step_key = 'subtitle_edit' AND ps.status = 'completed'
    ORDER BY ps.completed_at DESC, ps.id DESC LIMIT 1`).get(Number(episodeId));
  const result = parseJson(row?.result, {});
  return result && result.applied === true ? result : null;
}

function readUtf8Subtitle(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const text = fs.readFileSync(filePath, 'utf8').normalize('NFC');
  if (text.includes('\uFFFD')) throw Object.assign(new Error('OpenChatCut 字幕包含乱码替换字符'), { code: 'SUBTITLE_ENCODING_FAILED' });
  return text;
}

function findCoverSource(db, root, episodeId) {
  const row = db.prepare(`SELECT ig.local_path FROM storyboards sb
    JOIN image_generations ig ON ig.storyboard_id = sb.id
    WHERE sb.episode_id = ? AND sb.deleted_at IS NULL AND ig.status = 'completed' AND ig.deleted_at IS NULL AND ig.local_path IS NOT NULL
    ORDER BY sb.storyboard_number, ig.created_at DESC LIMIT 1`).get(episodeId);
  const candidate = localMediaPath(root, row?.local_path);
  return candidate && fs.existsSync(candidate) ? candidate : null;
}

function extractCoverFrame(videoPath, target) {
  const result = spawnSync(getFfmpegPath(), [
    '-y', '-ss', '1', '-i', videoPath, '-frames:v', '1', '-q:v', '2', target,
  ], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  return result.status === 0 && fs.existsSync(target);
}

async function createPackage(db, cfg, log, episodeId, options = {}) {
  const idempotencyKey = String(options.idempotency_key || '').trim();
  if (idempotencyKey) {
    const existing = db.prepare('SELECT * FROM publish_packages WHERE episode_id = ? AND idempotency_key = ? AND status = \'completed\'').get(Number(episodeId), idempotencyKey);
    if (existing && fs.existsSync(existing.package_path)) return getPackage(db, episodeId);
  }
  const episode = db.prepare(`SELECT ep.*, d.title drama_title, d.description drama_description, d.genre, d.tags, d.metadata drama_metadata
    FROM episodes ep JOIN dramas d ON d.id = ep.drama_id WHERE ep.id = ? AND ep.deleted_at IS NULL AND d.deleted_at IS NULL`).get(Number(episodeId));
  if (!episode) throw Object.assign(new Error('剧集不存在'), { code: 'NOT_FOUND' });
  const root = storageRoot(cfg);
  const metadata = parseJson(episode.drama_metadata, {});
  const profile = deliveryProfile(metadata.aspect_ratio);
  const requireOpenChatCut = metadata.preset_key === 'landscape_chinese_myth_v1' || metadata.require_openchatcut === true;
  const openChatCut = getOpenChatCutReceipt(db, episodeId);
  if (requireOpenChatCut && !openChatCut) {
    throw Object.assign(new Error('横屏神话项目必须先完成并应用 OpenChatCut 字幕编辑'), { code: 'OPENCHATCUT_REQUIRED' });
  }
  const sourceVideo = localMediaPath(root, openChatCut?.export_path || episode.video_url);
  if (!sourceVideo || !fs.existsSync(sourceVideo)) throw Object.assign(new Error('请先完成整集合成并保存到本地'), { code: 'VIDEO_NOT_READY' });
  const storyboards = db.prepare('SELECT * FROM storyboards WHERE episode_id = ? AND deleted_at IS NULL ORDER BY storyboard_number').all(Number(episodeId));
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const dir = path.join(root, 'publish_packages', `episode_${episodeId}_${stamp}`);
  fs.mkdirSync(dir, { recursive: true });
  const baseName = safeName(`${episode.drama_title}-第${episode.episode_number || 1}集`);
  const subtitlePath = path.join(dir, `${baseName}.srt`);
  const openChatCutSubtitlePath = openChatCut?.subtitle_path ? localMediaPath(root, openChatCut.subtitle_path) : null;
  const subtitleContent = openChatCutSubtitlePath ? readUtf8Subtitle(openChatCutSubtitlePath) : buildSrt(storyboards);
  fs.writeFileSync(subtitlePath, subtitleContent, 'utf8');
  const videoTarget = path.join(dir, `${baseName}.mp4`);
  const sourceProbe = probeMedia(sourceVideo);
  const normalizeResult = normalizeVideo(sourceVideo, videoTarget, sourceProbe, subtitlePath, !openChatCut && subtitleContent.trim().length > 0, profile);
  const finalProbe = probeMedia(videoTarget);
  const title = options.title || episode.title || `${episode.drama_title} 第${episode.episode_number || 1}集`;
  const hashtags = Array.from(new Set([
    ...(String(episode.tags || '').split(/[,，\s]+/).filter(Boolean).map((tag) => tag.startsWith('#') ? tag : '#' + tag)),
    '#AI短剧', '#动画短剧', ...(options.include_brand_hashtag === false ? [] : ['#小钱哥']),
  ])).slice(0, 10);
  const description = String(options.description || episode.drama_description || title).trim().slice(0, 300);
  let coverSource = findCoverSource(db, root, episodeId);
  const fallbackCoverSource = path.join(dir, '.cover-frame.jpg');
  if (!coverSource && extractCoverFrame(sourceVideo, fallbackCoverSource)) coverSource = fallbackCoverSource;
  const coverPath = path.join(dir, `${baseName}-封面.jpg`);
  try {
    if (coverSource) await makeCover(coverSource, coverPath, title, profile);
  } finally {
    if (fs.existsSync(fallbackCoverSource)) fs.unlinkSync(fallbackCoverSource);
  }
  const frames = detectFrameIssues(videoTarget);
  const expectedDialogue = storyboards.reduce((count, sb) => count + dialogueChunks(sb.dialogue || sb.narration).length, 0);
  const subtitleEntries = (subtitleContent.match(/^\d+$/gm) || []).length;
  const subtitleLines = subtitleContent.split('\n').filter((line) => line && !/^\d+$/.test(line) && !/-->/.test(line));
  const expectedDialogueText = storyboards.map((sb) => cleanDialogue(sb.dialogue || sb.narration)).join('');
  const dialogueOrderPassed = openChatCut
    ? openChatCut.subtitle_qa?.script_match === true
    : subtitleLines.join('').replace(/\s+/g, '') === expectedDialogueText.replace(/\s+/g, '');
  const durationPassed = finalProbe.duration >= profile.durationRange[0] && finalProbe.duration <= profile.durationRange[1];
  const dimensionsPassed = finalProbe.width === profile.width && finalProbe.height === profile.height;
  const subtitlesPassed = openChatCut
    ? openChatCut.subtitle_qa?.passed === true && dialogueOrderPassed && subtitleContent.trim().length > 0 && !subtitleContent.includes('\uFFFD')
    : subtitleEntries === expectedDialogue && dialogueOrderPassed && subtitleLines.every((line) => Array.from(line).length <= 18);
  const qa = {
    passed: finalProbe.ok && dimensionsPassed && finalProbe.has_audio && durationPassed && frames.checked && frames.black_segments === 0 && frames.freeze_segments === 0 && subtitlesPassed && (!requireOpenChatCut || !!openChatCut),
    checks: {
      playable: finalProbe.ok,
      dimensions: { expected: `${profile.width}x${profile.height}`, actual: `${finalProbe.width || 0}x${finalProbe.height || 0}`, passed: dimensionsPassed },
      audio: { required: true, passed: finalProbe.has_audio },
      duration: { expected_seconds: profile.durationRange, actual: finalProbe.duration, passed: durationPassed },
      black_frames: { passed: frames.checked && frames.black_segments === 0, segments: frames.black_segments },
      frozen_frames: { passed: frames.checked && frames.freeze_segments === 0, segments: frames.freeze_segments },
      subtitles: { entries: subtitleEntries, expected_entries: expectedDialogue, max_lines: 2, max_characters_per_line: 18, position: 'bottom_safe', passed: subtitlesPassed },
      dialogue_order: { passed: dialogueOrderPassed },
      openchatcut: { required: requireOpenChatCut, applied: !!openChatCut, project_id: openChatCut?.project_id || null, edit_session_id: openChatCut?.edit_session_id || null, passed: !requireOpenChatCut || !!openChatCut },
      cover: { passed: !!coverSource },
    },
    warnings: [normalizeResult.warning, frames.error ? '黑帧/冻结帧检测执行失败' : null, !coverSource ? '没有找到分镜图，未生成封面' : null].filter(Boolean),
    generated_at: now.toISOString(),
  };
  const publishMetadata = { title, description, hashtags, aspect_ratio: profile.aspectRatio, episode_id: Number(episodeId), drama_id: episode.drama_id };
  fs.writeFileSync(path.join(dir, '发布文案.txt'), `${title}\n\n${description}\n\n${hashtags.join(' ')}`.trim() + '\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify(publishMetadata, null, 2), 'utf8');
  fs.writeFileSync(path.join(dir, 'qa-report.json'), JSON.stringify(qa, null, 2), 'utf8');
  const manifest = {
    version: 2,
    product: '小钱哥短剧工厂',
    created_at: now.toISOString(),
    video: path.basename(videoTarget),
    cover: coverSource ? path.basename(coverPath) : null,
    subtitles: path.basename(subtitlePath),
    openchatcut: openChatCut ? { project_id: openChatCut.project_id || null, edit_session_id: openChatCut.edit_session_id || null, applied: true } : null,
    copy: '发布文案.txt',
    metadata: 'metadata.json',
    qa: 'qa-report.json',
  };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  db.prepare(`INSERT INTO publish_packages (episode_id, package_path, manifest, qa_report, status, idempotency_key, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'completed', ?, ?, ?)
    ON CONFLICT(episode_id) DO UPDATE SET package_path=excluded.package_path, manifest=excluded.manifest, qa_report=excluded.qa_report, status='completed', idempotency_key=excluded.idempotency_key, updated_at=excluded.updated_at`)
    .run(Number(episodeId), dir, JSON.stringify(manifest), JSON.stringify(qa), idempotencyKey || null, now.toISOString(), now.toISOString());
  log.info('Publish package created', { episode_id: Number(episodeId), qa_passed: qa.passed, package_path: dir });
  return { episode_id: Number(episodeId), package_path: dir, manifest, qa_report: qa, metadata: publishMetadata };
}

function getPackage(db, episodeId) {
  const row = db.prepare('SELECT * FROM publish_packages WHERE episode_id = ?').get(Number(episodeId));
  if (!row) return null;
  return { ...row, manifest: JSON.parse(row.manifest || '{}'), qa_report: JSON.parse(row.qa_report || '{}') };
}

function zipPackage(db, episodeId) {
  const record = getPackage(db, episodeId);
  if (!record || !fs.existsSync(record.package_path)) return null;
  const zip = new AdmZip();
  zip.addLocalFolder(record.package_path);
  return { buffer: zip.toBuffer(), filename: safeName(path.basename(record.package_path)) + '.zip' };
}

module.exports = { createPackage, getPackage, zipPackage, buildSrt, probeMedia, detectFrameIssues, deliveryProfile, getOpenChatCutReceipt, readUtf8Subtitle };
