const { randomUUID } = require('crypto');
const presetService = require('./presetService');

const STEPS = Object.freeze([
  ['story_brief', '故事简报'],
  ['visual_anchors', '三张视觉锚点'],
  ['asset_lock', '角色场景道具锁定'],
  ['script', '剧本'],
  ['storyboards', '分镜'],
  ['reference_images', '参考图'],
  ['video_clips', '10秒视频片段'],
  ['merge', '整集合成'],
  ['subtitle_edit', 'OpenChatCut原声剪辑与字幕'],
  ['media_qa', '媒体质量检查'],
  ['publish_package', '封面与发布包'],
]);

function parseJson(value, fallback = {}) {
  try { return JSON.parse(value || ''); } catch (_) { return fallback; }
}

function rowToRun(row, steps) {
  return {
    ...row,
    manifest: parseJson(row.manifest),
    artifacts: parseJson(row.artifacts),
    steps: (steps || []).map((step) => ({ ...step, payload: parseJson(step.payload), result: parseJson(step.result) })),
  };
}

function getRun(db, id) {
  const row = db.prepare('SELECT * FROM pipeline_runs WHERE id = ?').get(id);
  if (!row) return null;
  const steps = db.prepare('SELECT * FROM pipeline_steps WHERE run_id = ? ORDER BY sort_order').all(id);
  return rowToRun(row, steps);
}

function listRuns(db, filters = {}) {
  const clauses = [];
  const params = [];
  if (filters.drama_id) { clauses.push('drama_id = ?'); params.push(Number(filters.drama_id)); }
  if (filters.episode_id) { clauses.push('episode_id = ?'); params.push(Number(filters.episode_id)); }
  if (filters.active) clauses.push("status IN ('pending','running','paused','interrupted','failed')");
  const sql = `SELECT * FROM pipeline_runs ${clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''} ORDER BY created_at DESC LIMIT 100`;
  return db.prepare(sql).all(...params).map((row) => rowToRun(row, db.prepare('SELECT * FROM pipeline_steps WHERE run_id = ? ORDER BY sort_order').all(row.id)));
}

function defaultManifest(body, dramaId, episodeId, preset) {
  return {
    projectId: dramaId,
    episodeId,
    genre: body.genre || preset.name || '动画短剧',
    aspectRatio: body.aspect_ratio || preset.content.aspect_ratio,
    targetDuration: Number(body.target_duration) || preset.content.target_duration,
    clipDuration: Number(body.clip_duration) || preset.content.clip_duration,
    budgetLimit: Number(body.budget_limit) || 0,
    presetKey: preset.preset_key,
    presetVersion: preset.version,
    model: preset.content.video_model,
    imageModel: preset.content.image_model || null,
    imagePromptModels: preset.content.image_prompt_models || [],
    acceptedVideoModels: preset.content.accepted_video_models || [preset.content.video_model],
    nativeAudioRequired: preset.content.native_audio_required === true,
    nativeDialogue: preset.content.native_dialogue === true,
    nativeBgm: preset.content.native_bgm === true,
    narrationPolicy: preset.content.narration_policy || null,
    speechRate: preset.content.speech_rate || null,
    subtitleProfile: preset.content.subtitle || null,
    includeBrandHashtag: body.include_brand_hashtag !== false,
  };
}

function createRun(db, body, idempotencyKey) {
  if (!idempotencyKey) throw Object.assign(new Error('缺少 Idempotency-Key'), { code: 'IDEMPOTENCY_KEY_REQUIRED' });
  const existing = db.prepare('SELECT id FROM pipeline_runs WHERE idempotency_key = ?').get(idempotencyKey);
  if (existing) return getRun(db, existing.id);
  const dramaId = Number(body.drama_id || body.projectId);
  const episodeId = Number(body.episode_id || body.episodeId);
  const drama = db.prepare('SELECT id FROM dramas WHERE id = ? AND deleted_at IS NULL').get(dramaId);
  const episode = db.prepare('SELECT id FROM episodes WHERE id = ? AND drama_id = ? AND deleted_at IS NULL').get(episodeId, dramaId);
  if (!drama || !episode) throw Object.assign(new Error('项目或剧集不存在'), { code: 'NOT_FOUND' });
  const preset = presetService.getPreset(db, body.preset_key || 'vertical_animation', body.preset_version) || presetService.ensureDefaultPreset(db);
  const now = new Date().toISOString();
  const id = randomUUID();
  const manifest = defaultManifest(body, dramaId, episodeId, preset);
  db.transaction(() => {
    db.prepare(`INSERT INTO pipeline_runs
      (id, idempotency_key, drama_id, episode_id, preset_key, preset_version, status, current_step, step_index, total_steps, manifest, cost_estimate, artifacts, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, 0, ?, ?, ?, '{}', ?, ?)`)
      .run(id, idempotencyKey, dramaId, episodeId, preset.preset_key, preset.version, STEPS[0][0], STEPS.length, JSON.stringify(manifest), Number(body.cost_estimate) || 0, now, now);
    const insert = db.prepare(`INSERT INTO pipeline_steps (run_id, step_key, sort_order, status, payload, result, updated_at)
      VALUES (?, ?, ?, 'pending', '{}', '{}', ?)`);
    STEPS.forEach(([key], index) => insert.run(id, key, index + 1, now));
  })();
  reconcileRun(db, id);
  return getRun(db, id);
}

function completedFacts(db, run) {
  const episode = db.prepare('SELECT script_content, video_url FROM episodes WHERE id = ?').get(run.episode_id) || {};
  const drama = db.prepare('SELECT description, metadata FROM dramas WHERE id = ?').get(run.drama_id) || {};
  const boards = db.prepare('SELECT id FROM storyboards WHERE episode_id = ? AND deleted_at IS NULL').all(run.episode_id);
  const boardIds = boards.map((b) => b.id);
  const countFor = (table, field) => boardIds.length
    ? db.prepare(`SELECT COUNT(DISTINCT ${field}) count FROM ${table} WHERE ${field} IN (${boardIds.map(() => '?').join(',')}) AND status = 'completed' AND deleted_at IS NULL`).get(...boardIds).count
    : 0;
  const assets = ['characters', 'scenes', 'props'].every((table) => {
    const row = db.prepare(`SELECT COUNT(*) total, SUM(CASE WHEN local_path IS NOT NULL OR image_url IS NOT NULL THEN 1 ELSE 0 END) ready FROM ${table} WHERE drama_id = ? AND deleted_at IS NULL`).get(run.drama_id);
    if (table === 'props' && Number(row.total) === 0) return true;
    return Number(row.total) > 0 && Number(row.ready) === Number(row.total);
  });
  const visualAnchorCount = ['characters', 'scenes', 'props'].reduce((total, table) => {
    const row = db.prepare(`SELECT COUNT(*) count FROM ${table} WHERE drama_id = ? AND deleted_at IS NULL AND (local_path IS NOT NULL OR image_url IS NOT NULL)`).get(run.drama_id);
    return total + Number(row?.count || 0);
  }, 0);
  const merge = db.prepare("SELECT id FROM video_merges WHERE episode_id = ? AND status = 'completed' AND deleted_at IS NULL ORDER BY id DESC LIMIT 1").get(run.episode_id);
  const pack = db.prepare("SELECT episode_id, qa_report FROM publish_packages WHERE episode_id = ? AND status = 'completed'").get(run.episode_id);
  const qa = parseJson(pack?.qa_report, {});
  return {
    story_brief: !!String(drama.description || '').trim(),
    visual_anchors: visualAnchorCount >= 3,
    asset_lock: assets,
    script: !!String(episode.script_content || '').trim(),
    storyboards: boardIds.length > 0,
    reference_images: boardIds.length > 0 && Number(countFor('image_generations', 'storyboard_id')) === boardIds.length,
    video_clips: boardIds.length > 0 && Number(countFor('video_generations', 'storyboard_id')) === boardIds.length,
    media_qa: qa.passed === true,
    merge: !!episode.video_url || !!merge,
    publish_package: !!pack,
  };
}

function reconcileRun(db, id) {
  const run = getRun(db, id);
  if (!run) return null;
  const facts = completedFacts(db, run);
  const now = new Date().toISOString();
  const update = db.prepare("UPDATE pipeline_steps SET status = 'completed', completed_at = COALESCE(completed_at, ?), updated_at = ? WHERE run_id = ? AND step_key = ? AND status NOT IN ('completed','skipped')");
  for (const [key] of STEPS) if (facts[key]) update.run(now, now, id, key);
  const steps = db.prepare('SELECT step_key, status, sort_order FROM pipeline_steps WHERE run_id = ? ORDER BY sort_order').all(id);
  const next = steps.find((step) => !['completed', 'skipped'].includes(step.status));
  const allDone = !next;
  const nextStatus = allDone ? 'completed' : run.status === 'completed' ? 'running' : run.status;
  db.prepare(`UPDATE pipeline_runs SET current_step = ?, step_index = ?, status = ?, updated_at = ?, completed_at = ? WHERE id = ?`)
    .run(next?.step_key || STEPS.at(-1)[0], next ? next.sort_order - 1 : STEPS.length, nextStatus, now, allDone ? now : null, id);
  return getRun(db, id);
}

function updateStep(db, id, stepKey, body = {}) {
  if (!STEPS.some(([key]) => key === stepKey)) throw Object.assign(new Error('未知流水线步骤'), { code: 'BAD_REQUEST' });
  const allowed = new Set(['pending', 'running', 'paused', 'completed', 'failed', 'skipped']);
  const status = allowed.has(body.status) ? body.status : 'running';
  if (stepKey === 'subtitle_edit' && status === 'completed') {
    const result = body.result || {};
    const valid = result.applied === true
      && String(result.export_path || '').trim()
      && String(result.subtitle_path || '').trim()
      && result.subtitle_qa?.passed === true
      && result.native_audio_preserved === true
      && result.tts_added !== true
      && result.bgm_added !== true;
    if (!valid) {
      throw Object.assign(new Error('OpenChatCut 完成回执必须包含 applied、导出文件、字幕 QA，并确认保留原声且未添加 TTS/BGM'), {
        code: 'OPENCHATCUT_RECEIPT_INVALID',
      });
    }
  }
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT attempt FROM pipeline_steps WHERE run_id = ? AND step_key = ?').get(id, stepKey);
  if (!existing) throw Object.assign(new Error('流水线不存在'), { code: 'NOT_FOUND' });
  db.prepare(`UPDATE pipeline_steps SET status = ?, attempt = ?, payload = ?, result = ?, error = ?,
    started_at = CASE WHEN ? = 'running' THEN COALESCE(started_at, ?) ELSE started_at END,
    completed_at = CASE WHEN ? IN ('completed','skipped') THEN ? ELSE completed_at END, updated_at = ?
    WHERE run_id = ? AND step_key = ?`)
    .run(status, Number(body.attempt) || existing.attempt || 0, JSON.stringify(body.payload || {}), JSON.stringify(body.result || {}), body.error || null, status, now, status, now, now, id, stepKey);
  db.prepare('UPDATE pipeline_runs SET status = ?, current_step = ?, updated_at = ?, error = ? WHERE id = ?')
    .run(status === 'failed' ? 'failed' : status === 'paused' ? 'paused' : 'running', stepKey, now, body.error || null, id);
  return reconcileRun(db, id);
}

function command(db, id, commandName) {
  const run = getRun(db, id);
  if (!run) return null;
  const map = { pause: 'paused', resume: 'running', cancel: 'cancelled', retry_failed: 'running' };
  if (commandName === 'complete') {
    const reconciled = reconcileRun(db, id);
    if (!reconciled) return null;
    const incomplete = reconciled.steps.filter((step) => !['completed', 'skipped'].includes(step.status));
    if (incomplete.length) {
      throw Object.assign(new Error(`仍有 ${incomplete.length} 个生产步骤未完成`), { code: 'PIPELINE_INCOMPLETE' });
    }
    return reconciled;
  }
  const status = map[commandName];
  if (!status) throw Object.assign(new Error('不支持的命令'), { code: 'BAD_REQUEST' });
  const now = new Date().toISOString();
  if (commandName === 'retry_failed') {
    db.prepare("UPDATE pipeline_steps SET status = 'pending', attempt = attempt + 1, error = NULL, updated_at = ? WHERE run_id = ? AND status = 'failed'").run(now, id);
  }
  db.prepare('UPDATE pipeline_runs SET status = ?, error = NULL, updated_at = ?, completed_at = ? WHERE id = ?')
    .run(status, now, status === 'completed' ? now : null, id);
  return reconcileRun(db, id);
}

function recoverInterruptedRuns(db) {
  const now = new Date().toISOString();
  return db.prepare("UPDATE pipeline_runs SET status = 'interrupted', updated_at = ? WHERE status = 'running'").run(now).changes;
}

module.exports = { STEPS, createRun, getRun, listRuns, updateStep, command, reconcileRun, recoverInterruptedRuns };
