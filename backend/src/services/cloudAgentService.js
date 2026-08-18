const { randomUUID } = require('crypto');
const EventEmitter = require('events');
const dramaService = require('./dramaService');
const pipelineService = require('./pipelineService');
const productService = require('./productService');

const events = new EventEmitter();
let timer = null;
let socket = null;
let running = false;

function parseJson(value, fallback = {}) {
  try { return JSON.parse(value || ''); } catch (_) { return fallback; }
}

function cloudUrl(pathname) {
  return productService.PRODUCT.cloud_base_url.replace(/\/$/, '') + pathname;
}

async function refreshAccessToken() {
  const refreshToken = process.env.HHTC_APP_REFRESH_TOKEN;
  if (!refreshToken) return false;
  const res = await fetch(cloudUrl('/oauth/token'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) return false;
  process.env.HHTC_APP_ACCESS_TOKEN = body.access_token;
  process.env.HHTC_APP_TOKEN_EXPIRES_AT = new Date(Date.now() + Number(body.expires_in || 3600) * 1000).toISOString();
  events.emit('token-refreshed', {
    access_token: body.access_token,
    refresh_token: refreshToken,
    expires_at: process.env.HHTC_APP_TOKEN_EXPIRES_AT,
  });
  return true;
}

async function request(pathname, options = {}, retry = true) {
  let token = process.env.HHTC_APP_ACCESS_TOKEN;
  if (!token && retry && await refreshAccessToken()) return request(pathname, options, false);
  token = process.env.HHTC_APP_ACCESS_TOKEN;
  if (!token) return null;
  const headers = { ...(options.headers || {}), Authorization: `Bearer ${token}` };
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const res = await fetch(cloudUrl(pathname), { ...options, headers });
  if (res.status === 401 && retry && await refreshAccessToken()) return request(pathname, options, false);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body?.error?.message || `HHTC 请求失败 (${res.status})`), { code: body?.error?.code, status: res.status });
  return body.data === undefined ? body : body.data;
}

function createLocalJob(db, log, remote) {
  const existing = db.prepare('SELECT * FROM cloud_jobs WHERE remote_job_id = ?').get(remote.id);
  if (existing) return { row: existing, created: false };
  const manifest = remote.manifest || {};
  const title = String(manifest.title || manifest.projectTitle || manifest.topic || 'GPT 短剧任务').slice(0, 80);
  const description = String(manifest.storyBrief || manifest.brief || manifest.prompt || manifest.description || title);
  const drama = dramaService.createDrama(db, log, {
    title,
    description,
    genre: manifest.genre || '竖屏动画短剧',
    style: manifest.style || 'animation',
    metadata: { source: 'hhtc_gpt', remote_job_id: remote.id, aspect_ratio: manifest.aspectRatio || '9:16' },
  });
  dramaService.saveEpisodes(db, log, drama.id, { episodes: [{
    episode_number: 1,
    title: String(manifest.episodeTitle || `${title} 第1集`).slice(0, 100),
    script_content: manifest.script || description,
    description,
    duration: Number(manifest.targetDuration || 60),
  }] });
  const episode = db.prepare('SELECT id FROM episodes WHERE drama_id = ? AND deleted_at IS NULL ORDER BY episode_number LIMIT 1').get(drama.id);
  const run = pipelineService.createRun(db, {
    drama_id: drama.id,
    episode_id: episode.id,
    genre: manifest.genre,
    aspect_ratio: manifest.aspectRatio || '9:16',
    target_duration: manifest.targetDuration || 60,
    clip_duration: manifest.clipDuration || 10,
    budget_limit: manifest.budgetLimit || remote.estimate?.amount || 0,
    include_brand_hashtag: manifest.includeBrandHashtag !== false,
    preset_key: manifest.presetKey || 'vertical_animation',
    preset_version: manifest.presetVersion,
  }, `cloud-${remote.id}`);
  const now = new Date().toISOString();
  const id = randomUUID();
  const payload = { drama_id: drama.id, episode_id: episode.id, run_id: run.id, manifest };
  db.prepare(`INSERT INTO cloud_jobs (id, remote_job_id, run_id, command, status, payload, result, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'ready', ?, '{}', ?, ?)`)
    .run(id, remote.id, run.id, remote.command || 'create_episode', JSON.stringify(payload), now, now);
  events.emit('job-created', { id, remote_job_id: remote.id, ...payload });
  return { row: db.prepare('SELECT * FROM cloud_jobs WHERE id = ?').get(id), created: true };
}

function localJobView(db, row) {
  const payload = parseJson(row.payload);
  const result = parseJson(row.result);
  const run = row.run_id ? pipelineService.reconcileRun(db, row.run_id) : null;
  return { ...row, payload, result, run };
}

async function reportLocalJobs(db, log) {
  const rows = db.prepare("SELECT * FROM cloud_jobs WHERE remote_job_id IS NOT NULL AND status NOT IN ('reported','cancelled') ORDER BY created_at").all();
  for (const row of rows) {
    const view = localJobView(db, row);
    const run = view.run;
    if (!run) continue;
    try {
      const remote = await request(`/drama-jobs/${encodeURIComponent(row.remote_job_id)}`);
      const command = remote?.command;
      if (command === 'pause' && !['paused', 'completed'].includes(run.status)) pipelineService.command(db, run.id, 'pause');
      if (command === 'resume' && ['paused', 'interrupted'].includes(run.status)) pipelineService.command(db, run.id, 'resume');
      if (command === 'cancel' && run.status !== 'cancelled') pipelineService.command(db, run.id, 'cancel');
      if (command === 'retry_failed' && run.status === 'failed') pipelineService.command(db, run.id, 'retry_failed');
      const current = pipelineService.getRun(db, run.id);
      const completed = current.steps.filter((step) => ['completed', 'skipped'].includes(step.status)).length;
      const progress = Math.round(completed / Math.max(1, current.total_steps) * 100);
      const status = current.status === 'interrupted' ? 'running' : current.status;
      const pack = db.prepare('SELECT package_path, manifest, qa_report FROM publish_packages WHERE episode_id = ?').get(current.episode_id);
      const result = pack ? { local_project_id: current.drama_id, local_episode_id: current.episode_id, package_path: pack.package_path, manifest: parseJson(pack.manifest), qa: parseJson(pack.qa_report) } : { local_project_id: current.drama_id, local_episode_id: current.episode_id };
      await request(`/desktop/jobs/${encodeURIComponent(row.remote_job_id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status, progress, result, error_code: current.status === 'failed' ? 'RETRYABLE_FAILURE' : null, error_message: current.error || null }),
      });
      db.prepare('UPDATE cloud_jobs SET status = ?, result = ?, error = ?, updated_at = ? WHERE id = ?')
        .run(status === 'completed' ? 'reported' : status, JSON.stringify(result), current.error || null, new Date().toISOString(), row.id);
    } catch (error) {
      log.warn('Cloud job status sync failed', { remote_job_id: row.remote_job_id, error: error.message });
    }
  }
}

async function claimNext(db, log) {
  const next = await request('/desktop/jobs/next');
  if (!next?.id) return;
  const known = db.prepare('SELECT id FROM cloud_jobs WHERE remote_job_id = ?').get(next.id);
  if (known) return;
  await request(`/desktop/jobs/${encodeURIComponent(next.id)}/claim`, {
    method: 'POST',
    headers: { 'Idempotency-Key': `desktop-claim-${next.id}` },
    body: JSON.stringify({}),
  });
  createLocalJob(db, log, next);
}

async function tick(db, log) {
  if (running || productService.flavor() !== 'customer') return;
  if (!process.env.HHTC_APP_ACCESS_TOKEN && !process.env.HHTC_APP_REFRESH_TOKEN) return;
  running = true;
  try {
    const account = await request('/account/status');
    if (account?.entitlement) productService.setSetting(db, 'product_entitlement', account.entitlement);
    await reportLocalJobs(db, log);
    await claimNext(db, log);
  } catch (error) {
    log.warn('HHTC cloud agent polling failed', { code: error.code, error: error.message });
  } finally {
    running = false;
  }
}

async function accountStatus(db) {
  const status = await request('/account/status');
  if (status?.entitlement) productService.setSetting(db, 'product_entitlement', status.entitlement);
  return status;
}

function connectWebSocket(db, log) {
  if (socket || !process.env.HHTC_APP_ACCESS_TOKEN) return;
  let WebSocket;
  try { WebSocket = require('ws'); } catch (_) { return; }
  const url = new URL(productService.PRODUCT.cloud_base_url.replace(/^http/, 'ws').replace(/\/app\/v1\/?$/, '/desktop/agent'));
  socket = new WebSocket(url.toString(), { headers: { Authorization: `Bearer ${process.env.HHTC_APP_ACCESS_TOKEN}` } });
  socket.on('message', () => tick(db, log));
  socket.on('error', () => {});
  socket.on('close', () => { socket = null; });
}

function start(db, log) {
  if (timer || process.env.DISABLE_CLOUD_AGENT === '1') return;
  const poll = () => { connectWebSocket(db, log); tick(db, log); };
  poll();
  timer = setInterval(poll, 15000);
  timer.unref?.();
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  if (socket) socket.close();
  socket = null;
}

function getPendingNavigation(db) {
  const row = db.prepare("SELECT * FROM cloud_jobs WHERE status = 'ready' ORDER BY created_at LIMIT 1").get();
  return row ? localJobView(db, row) : null;
}

function acknowledgeNavigation(db, id) {
  return db.prepare("UPDATE cloud_jobs SET status = 'opened', updated_at = ? WHERE id = ? AND status = 'ready'").run(new Date().toISOString(), id).changes > 0;
}

module.exports = { events, start, stop, tick, accountStatus, getPendingNavigation, acknowledgeNavigation, createLocalJob, localJobView };
