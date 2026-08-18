'use strict';

/**
 * 即梦2角色认证 — 业务侧「素材管理」HTTP API（与官方路径一致，如 /api/business/v1/assets）。
 * 网关 URL 与 Token 从 AI 配置（service_type = jimeng2_character_auth）读取；可选兼容旧版 config 中的 jimeng_material_hub / silvamux_hub。
 * 参考：https://83zi.com/sd2realperson.html
 */

function loadAiJimeng2AuthRow(db) {
  if (!db) return null;
  try {
    return db
      .prepare(
        `SELECT base_url, api_key FROM ai_service_configs
         WHERE deleted_at IS NULL AND service_type = ? AND is_active = 1
         ORDER BY is_default DESC, priority DESC, id ASC LIMIT 1`
      )
      .get('jimeng2_character_auth');
  } catch (_) {
    return null;
  }
}

function legacyYamlHubSection(cfg) {
  return cfg?.jimeng_material_hub || cfg?.silvamux_hub || {};
}

/** 与 routes/aiConfig.js listJimeng2MaterialAssets 一致：存库/环境变量里若含「Bearer 」前缀，hubJson 会再拼 Bearer，需先去重 */
function normalizeMaterialHubToken(raw) {
  let s = String(raw || '').trim();
  if (/^bearer\s+/i.test(s)) s = s.replace(/^bearer\s+/i, '').trim();
  // 兼容误填为 "token" / 'token' 的场景
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  // 去除不可见空白，避免网关把 header 判定为无效
  s = s.replace(/[\r\n\t]/g, '').trim();
  return s;
}

/**
 * 解析即梦2角色认证调用上下文（供素材注册 API 使用）
 * @param {object} cfg - 应用 config.yaml
 * @param {object|null} db - better-sqlite3（可选，用于读 AI 配置表）
 * @param {object|null} [log] - 可选 logger；传入时打一条不含密钥原文的鉴权诊断
 * @returns {{ baseUrl: string, token: string, poll_max_ms?: number, poll_interval_ms?: number, hubAuthDiag?: object }}
 */
function buildHubContext(cfg, db, log) {
  const row = loadAiJimeng2AuthRow(db);
  let base_url = (row?.base_url || '').toString().trim();
  let token = (row?.api_key || '').toString().trim();
  let poll_max_ms;
  let poll_interval_ms;

  if (!base_url || !token) {
    const y = legacyYamlHubSection(cfg);
    if (!base_url) base_url = (y.base_url || '').toString().trim();
    if (!token) token = (y.token || '').toString().trim();
    if (poll_max_ms == null && y.poll_max_ms != null) poll_max_ms = Number(y.poll_max_ms);
    if (poll_interval_ms == null && y.poll_interval_ms != null) poll_interval_ms = Number(y.poll_interval_ms);
  }

  const baseUrl = (
    process.env.JIMENG2_CHARACTER_AUTH_URL ||
    base_url ||
    process.env.JIMENG_MATERIAL_HUB_BASE_URL ||
    process.env.SILVAMUX_HUB_BASE_URL ||
    'https://silvamux.tingyutech.com'
  )
    .toString()
    .trim()
    .replace(/\/$/, '');

  const rawTokJoined = (
    process.env.JIMENG2_CHARACTER_AUTH_TOKEN ||
    token ||
    process.env.JIMENG_MATERIAL_HUB_TOKEN ||
    process.env.SILVAMUX_HUB_TOKEN ||
    process.env.HUB_TOKEN ||
    ''
  )
    .toString()
    .trim();

  const hadLeadingBearer = /^bearer\s+/i.test(rawTokJoined);
  const tok = normalizeMaterialHubToken(rawTokJoined);

  const env2 = !!String(process.env.JIMENG2_CHARACTER_AUTH_TOKEN || '').trim();
  const envMat = !!String(process.env.JIMENG_MATERIAL_HUB_TOKEN || '').trim();
  const envSilva = !!String(process.env.SILVAMUX_HUB_TOKEN || '').trim();
  const envHub = !!String(process.env.HUB_TOKEN || '').trim();
  const dbKeyLen = String(row?.api_key || '').trim().length;

  let winningTokenSource = 'none';
  if (env2) winningTokenSource = 'env:JIMENG2_CHARACTER_AUTH_TOKEN';
  else if (String(token || '').trim()) {
    winningTokenSource = dbKeyLen ? 'db:ai_service_configs(jimeng2_character_auth.api_key)' : 'yaml:jimeng_material_hub|silvamux_hub.token';
  } else if (envMat) winningTokenSource = 'env:JIMENG_MATERIAL_HUB_TOKEN';
  else if (envSilva) winningTokenSource = 'env:SILVAMUX_HUB_TOKEN';
  else if (envHub) winningTokenSource = 'env:HUB_TOKEN';

  const hubAuthDiag = {
    winning_token_source: winningTokenSource,
    raw_token_chars_before_normalize: rawTokJoined.length,
    token_chars_in_bearer_payload: tok.length,
    raw_had_leading_bearer_prefix: hadLeadingBearer,
    leading_bearer_prefix_stripped: hadLeadingBearer,
    env_token_flags: {
      JIMENG2_CHARACTER_AUTH_TOKEN: env2,
      JIMENG_MATERIAL_HUB_TOKEN: envMat,
      SILVAMUX_HUB_TOKEN: envSilva,
      HUB_TOKEN: envHub,
    },
    db_jimeng2_active_row_found: !!row,
    db_api_key_field_chars: dbKeyLen,
    request_header_shape: 'Authorization: Bearer <token>',
    note:
      '若 raw_had_leading_bearer_prefix 为 true，旧版会发出 Bearer Bearer…；现已规范化。环境变量 JIMENG2_CHARACTER_AUTH_TOKEN 优先于数据库 api_key。',
  };

  if (log && typeof log.info === 'function') {
    log.info('[JimengMaterialHub] buildHubContext 鉴权诊断（不含密钥原文）', {
      hub_gateway: baseUrl,
      token_present: !!tok,
      ...hubAuthDiag,
    });
  }

  return { baseUrl, token: tok, poll_max_ms, poll_interval_ms, hubAuthDiag };
}

async function hubJson(path, ctx, { method, body, log } = {}) {
  const base = ctx.baseUrl;
  const token = ctx.token;
  if (!token) {
    return {
      ok: false,
      error:
        '未配置即梦2角色认证：请在「AI 配置」中添加类型为「即梦2角色认证」的一条配置，填写网关 URL 与 Token（或设置环境变量 JIMENG2_CHARACTER_AUTH_*；兼容旧 config / SILVAMUX_*）',
    };
  }
  const url = `${base}/api/business/v1${path}`;
  const init = {
    method: method || 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      // 某些有缺陷的中转实现会错误地大小写敏感，这里双写做兼容
      authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  };
  if (body != null) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  if (log && typeof log.info === 'function' && method === 'POST' && path === '/assets' && body?.url) {
    log.info('[JimengMaterialHub] POST /api/business/v1/assets', {
      hub_gateway: base,
      register_image_url: body.url,
      asset_name: body.name,
      asset_type: body.asset_type,
      bearer_token_payload_chars: token.length,
    });
  }
  if (log && typeof log.info === 'function' && method === 'GET' && String(path || '').startsWith('/assets')) {
    log.info('[JimengMaterialHub] GET /api/business/v1/assets', {
      hub_gateway: base,
      path_query: String(path).includes('?') ? String(path).split('?')[1]?.slice(0, 120) : '',
      bearer_token_payload_chars: token.length,
    });
  }

  const res = await fetch(url, init);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : {};
  } catch (_) {
    json = { _raw: text };
  }
  if (!res.ok) {
    const detail = json?.detail || json?.title || json?.message || text || res.statusText;
    const detailStr = typeof detail === 'string' ? detail : JSON.stringify(detail);
    if (log && typeof log.warn === 'function') {
      const baseWarn = {
        path,
        method: method || 'GET',
        httpStatus: res.status,
        hub_gateway: base,
        register_image_url: body && body.url ? body.url : undefined,
        response_preview: detailStr.slice(0, 2000),
        bearer_token_payload_chars: token.length,
      };
      if (res.status === 401) {
        baseWarn.hint401 =
          'invalid token 常见原因：密钥与网关不匹配；机器上 JIMENG2_CHARACTER_AUTH_TOKEN 等环境变量覆盖数据库配置；配置里写了「Bearer xxx」导致旧版双重 Bearer（请看 buildHubContext 日志 raw_had_leading_bearer_prefix）';
      }
      log.warn('[JimengMaterialHub] HTTP 错误', baseWarn);
    }
    return { ok: false, status: res.status, error: detailStr };
  }
  return { ok: true, data: json };
}

async function createImageAsset(ctx, params, log) {
  const name = String(params.name || 'c').replace(/\s+/g, '').slice(0, 12) || 'c';
  return hubJson('/assets', ctx, {
    method: 'POST',
    body: { url: params.url, asset_type: 'Image', name },
    log,
  });
}

/**
 * 列出组织下素材（分页）
 * @see https://83zi.com/sd2realperson.html
 */
async function listAssets(ctx, opts = {}, log) {
  const limitRaw = opts.limit != null ? Number(opts.limit) : 20;
  const limit = Math.min(100, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 20));
  const q = new URLSearchParams();
  q.set('limit', String(limit));
  if (opts.cursor) q.set('cursor', String(opts.cursor));
  const path = `/assets?${q.toString()}`;
  return hubJson(path, ctx, { method: 'GET', log });
}

async function getAsset(ctx, assetId, log) {
  const id = encodeURIComponent(String(assetId || '').trim());
  if (!id) return { ok: false, error: '缺少 asset id' };
  return hubJson(`/assets/${id}`, ctx, { method: 'GET', log });
}

async function pollAssetUntilSettled(ctx, assetId, options = {}) {
  const maxMs = options.maxMs ?? 120000;
  const intervalMs = options.intervalMs ?? 2000;
  const log = options.log;
  const deadline = Date.now() + maxMs;
  let last;
  while (Date.now() < deadline) {
    const r = await getAsset(ctx, assetId, log);
    if (!r.ok) return { ok: false, error: r.error };
    last = r.data;
    const st = (last && last.status) || '';
    if (st === 'active' || st === 'failed') {
      return { ok: true, asset: last };
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return { ok: true, asset: last, timedOut: true };
}

function hubToken(cfg, db) {
  return buildHubContext(cfg, db).token;
}

module.exports = {
  buildHubContext,
  hubToken,
  createImageAsset,
  listAssets,
  getAsset,
  pollAssetUntilSettled,
};
