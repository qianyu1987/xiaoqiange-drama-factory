const os = require('os');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const localAuthStore = require('./localAuthStore');

const PRODUCT = Object.freeze({
  name: '小钱哥短剧工厂',
  english_name: 'XiaoQian Drama Factory',
  version: process.env.PRODUCT_VERSION || '2.0.0',
  cloud_base_url: process.env.HHTC_APP_BASE_URL || 'https://www.hhtc.top/app/v1',
  login_url: process.env.HHTC_LOGIN_URL || 'https://www.hhtc.top/login',
});

function flavor() {
  return process.env.PRODUCT_FLAVOR === 'customer' ? 'customer' : 'internal';
}

function getSetting(db, key, fallback = null) {
  const row = db.prepare('SELECT value FROM global_settings WHERE key = ?').get(key);
  if (!row) return fallback;
  try { return JSON.parse(row.value); } catch (_) { return row.value; }
}

function setSetting(db, key, value) {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO global_settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .run(key, JSON.stringify(value), now);
}

function deviceFingerprint() {
  const raw = [os.hostname(), os.platform(), os.arch(), os.userInfo().username].join('|');
  return crypto.createHash('sha256').update('xiaoqian-drama-v1|' + raw).digest('hex');
}

function entitlement(db) {
  if (flavor() === 'internal') {
    return { active: true, plan: 'internal', device_limit: 999, expires_at: null, offline_grace_until: null };
  }
  const saved = getSetting(db, 'product_entitlement', null);
  if (!saved) return { active: false, plan: null, reason: 'NOT_ACTIVATED', device_limit: 1 };
  const now = Date.now();
  const expires = saved.expires_at ? Date.parse(saved.expires_at) : NaN;
  const grace = saved.offline_grace_until ? Date.parse(saved.offline_grace_until) : NaN;
  const active = saved.active === true && (!Number.isFinite(expires) || expires > now || (Number.isFinite(grace) && grace > now));
  return { ...saved, active, reason: active ? null : 'SUBSCRIPTION_EXPIRED' };
}

function loadStoredAuth() {
  if (process.env.HHTC_APP_REFRESH_TOKEN) return localAuthStore.load();
  const stored = localAuthStore.load();
  if (stored?.refresh_token) process.env.HHTC_APP_REFRESH_TOKEN = stored.refresh_token;
  if (stored?.access_token) process.env.HHTC_APP_ACCESS_TOKEN = stored.access_token;
  if (stored?.expires_at) process.env.HHTC_APP_TOKEN_EXPIRES_AT = stored.expires_at;
  return stored;
}

function getStatus(db, cfg) {
  const profile = getSetting(db, 'product_profile', {});
  const product = flavor() === 'customer'
    ? { name: PRODUCT.name, english_name: PRODUCT.english_name, version: PRODUCT.version }
    : PRODUCT;
  return {
    product,
    flavor: flavor(),
    customer_mode: flavor() === 'customer',
    onboarding_complete: flavor() === 'internal' || profile.onboarding_complete === true,
    profile: {
      account_id: profile.account_id || null,
      display_name: profile.display_name || null,
      device_id: profile.device_id || deviceFingerprint(),
      storage_path: profile.storage_path || cfg?.storage?.local_path || './data/storage',
    },
    entitlement: entitlement(db),
    defaults: {
      aspect_ratio: '9:16',
      clip_duration: 10,
      target_duration: 60,
      video_model: 'xiaoqian-video',
      preset_key: 'vertical_animation',
      preset_version: 1,
      brand_hashtag: '#小钱哥',
    },
  };
}

function completeOnboarding(db, body = {}) {
  const profile = {
    onboarding_complete: true,
    account_id: String(body.account_id || '').trim() || null,
    display_name: String(body.display_name || '').trim() || null,
    device_id: String(body.device_id || '').trim() || deviceFingerprint(),
    storage_path: String(body.storage_path || '').trim() || null,
    completed_at: new Date().toISOString(),
  };
  setSetting(db, 'product_profile', profile);
  return profile;
}

async function pairDevice(db, body = {}) {
  const pairingCode = String(body.pairing_code || '').trim();
  if (!/^[A-Z0-9-]{6,32}$/i.test(pairingCode)) throw new Error('请输入有效的设备配对码');
  const deviceId = deviceFingerprint();
  const res = await fetch(PRODUCT.cloud_base_url + '/devices/pair', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `pair-${deviceId}-${pairingCode}` },
    body: JSON.stringify({ pairing_code: pairingCode, device_id: deviceId, device_name: os.hostname(), platform: os.platform() }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload.success === false) {
    const message = payload?.error?.message || payload?.message || `配对失败 (${res.status})`;
    throw new Error(message);
  }
  const data = payload.data || payload;
  if (!data.access_token || !data.refresh_token) throw new Error('配对服务未返回授权令牌');
  process.env.HHTC_APP_ACCESS_TOKEN = data.access_token;
  process.env.HHTC_APP_REFRESH_TOKEN = data.refresh_token;
  localAuthStore.save({ refresh_token: data.refresh_token });
  if (data.expires_at) process.env.HHTC_APP_TOKEN_EXPIRES_AT = data.expires_at;
  if (data.entitlement) setSetting(db, 'product_entitlement', data.entitlement);
  completeOnboarding(db, {
    account_id: data.account?.id,
    display_name: data.account?.display_name,
    device_id: data.device?.id || deviceId,
    storage_path: body.storage_path,
  });
  return {
    account: data.account || null,
    device: data.device || { id: deviceId },
    entitlement: data.entitlement || entitlement(db),
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at || null,
  };
}

function configureStoragePath(cfg, requestedPath) {
  const value = String(requestedPath || '').trim();
  if (!value) return { changed: false, path: cfg?.storage?.local_path || null };
  if (!path.isAbsolute(value)) throw new Error('作品保存目录必须是绝对路径');
  fs.mkdirSync(value, { recursive: true });
  const current = path.resolve(cfg?.storage?.local_path || './data/storage');
  const changed = current !== path.resolve(value);
  cfg.storage = { ...(cfg.storage || {}), type: 'local', local_path: value };
  fs.writeFileSync(path.join(process.cwd(), 'storage-path.json'), JSON.stringify({ path: value, updated_at: new Date().toISOString() }, null, 2), { mode: 0o600 });
  return { changed, path: value };
}

function requireGenerationAccess(db) {
  return (req, res, next) => {
    if (flavor() !== 'customer' || req.method === 'GET') return next();
    const billable = [
      /^\/generation\//,
      /^\/images(?:\/|$)/,
      /^\/videos(?:\/|$)/,
      /^\/audio(?:\/|$)/,
      /^\/episodes\/[^/]+\/(storyboards|finalize)/,
      /^\/(characters|scenes|props)\/.*\/(generate|generate-image|generate-four-view-image)/,
    ].some((pattern) => pattern.test(req.path));
    if (!billable) return next();
    if (!process.env.HHTC_APP_ACCESS_TOKEN && !process.env.HHTC_APP_REFRESH_TOKEN) {
      return res.status(401).json({
        success: false,
        error: { code: 'NOT_ACTIVATED', message: '请先完成产品授权' },
        timestamp: new Date().toISOString(),
      });
    }
    const current = entitlement(db);
    if (current.active) return next();
    res.status(402).json({
      success: false,
      error: { code: current.reason || 'SUBSCRIPTION_REQUIRED', message: '订阅未激活或已到期，已有项目仍可预览和导出' },
      timestamp: new Date().toISOString(),
    });
  };
}

module.exports = {
  PRODUCT,
  flavor,
  getStatus,
  completeOnboarding,
  pairDevice,
  entitlement,
  getSetting,
  setSetting,
  configureStoragePath,
  loadStoredAuth,
  requireGenerationAccess,
};
