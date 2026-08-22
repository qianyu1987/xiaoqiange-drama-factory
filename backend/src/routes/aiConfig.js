const aiConfigService = require('../services/aiConfigService');
const response = require('../response');
const productService = require('../services/productService');

function publicConfig(config) {
  if (!config) return config;
  const customerMode = productService.flavor() === 'customer';
  const redact = (value) => {
    if (Array.isArray(value)) return value.map(redact);
    if (!value || typeof value !== 'object') return value;
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (/(?:^|_)(?:api[_-]?key|access[_-]?key|secret[_-]?key|token|session|password)$/i.test(key)) continue;
      out[key] = redact(item);
    }
    return out;
  };
  let safeSettings = config.settings;
  if (safeSettings) {
    try {
      safeSettings = JSON.stringify(redact(typeof safeSettings === 'string' ? JSON.parse(safeSettings) : safeSettings));
    } catch (_) {
      safeSettings = null;
    }
  }
  return {
    ...config,
    api_key: '',
    api_key_configured: !!config.api_key,
    base_url: customerMode && config.managed_group
      ? '由小钱哥短剧工厂托管'
      : config.base_url,
    managed_group: config.managed_group || null,
    is_locked: !!config.is_locked,
    credential_storage: config.credential_storage || (config.managed_group ? 'hhtc-runtime' : 'local-encrypted'),
    settings: safeSettings,
  };
}

function list(db) {
  return (req, res) => {
    const list = aiConfigService.listConfigs(db, req.query.service_type);
    response.success(res, list.map(publicConfig));
  };
}

function get(db) {
  return (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return response.badRequest(res, '无效的配置ID');
    const config = aiConfigService.getConfig(db, id);
    if (!config) return response.notFound(res, '配置不存在');
    response.success(res, publicConfig(config));
  };
}

function vendorLock(cfg) {
  return (req, res) => {
    const status = aiConfigService.getVendorLockStatus(cfg);
    response.success(res, status);
  };
}

function create(db, log, cfg) {
  return (req, res) => {
    const body = req.body || {};
    if (!body.service_type || !body.name || !body.provider || !body.base_url) {
      return response.badRequest(res, '缺少必填字段: service_type, name, provider, base_url');
    }
    try {
      const config = aiConfigService.createConfig(db, log, {
        ...body,
        model: body.model ?? [],
      });
      response.created(res, publicConfig(config));
    } catch (err) {
      log.errorw('Create AI config failed', { error: err.message });
      response.internalError(res, '创建失败');
    }
  };
}

function update(db, log, cfg) {
  return (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return response.badRequest(res, '无效的配置ID');

    let body = req.body || {};
    try {
      const config = aiConfigService.updateConfig(db, log, id, body);
      if (!config) return response.notFound(res, '配置不存在');
      response.success(res, publicConfig(config));
    } catch (err) {
      if (err.code === 'AI_CONFIG_LOCKED') return response.forbidden(res, err.message);
      log.error('Update AI config failed', { error: err.message });
      response.internalError(res, '保存失败');
    }
  };
}

function remove(db, log, cfg) {
  return (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return response.badRequest(res, '无效的配置ID');
    try {
      const ok = aiConfigService.deleteConfig(db, log, id);
      if (!ok) return response.notFound(res, '配置不存在');
      response.success(res, { message: '删除成功' });
    } catch (err) {
      if (err.code === 'AI_CONFIG_LOCKED') return response.forbidden(res, err.message);
      response.internalError(res, '删除失败');
    }
  };
}

function setDefault(db, log) {
  return (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return response.badRequest(res, '无效的配置ID');
    try {
      const config = aiConfigService.setDefaultConfig(db, log, id);
      if (!config) return response.notFound(res, '配置不存在');
      response.success(res, publicConfig(config));
    } catch (err) {
      log.error('Set default AI config failed', { error: err.message });
      response.internalError(res, '切换默认配置失败');
    }
  };
}

function bulkUpdateKey(db, log, cfg) {
  return (req, res) => {
    if (productService.flavor() === 'customer') {
      return response.forbidden(res, '客户版不接收本地 API Key');
    }
    if (!aiConfigService.getVendorLockStatus(cfg).enabled) {
      return response.badRequest(res, '批量换Key仅在厂商锁定模式下可用');
    }
    const { api_key } = req.body || {};
    if (!api_key || !api_key.trim()) {
      return response.badRequest(res, '请提供新的 API Key');
    }
    try {
      const count = aiConfigService.bulkUpdateApiKey(db, log, api_key.trim());
      response.success(res, { updated: count, message: `已更新 ${count} 条配置的 API Key` });
    } catch (err) {
      log.error('Bulk update api_key failed', { error: err.message });
      response.internalError(res, '批量换Key失败');
    }
  };
}

function testConnection(db, log) {
  return async (req, res) => {
    let body = req.body || {};
    if (body.config_id && !String(body.api_key || '').trim()) {
      const stored = aiConfigService.getConfig(db, Number(body.config_id));
      if (!stored) return response.notFound(res, '配置不存在');
      body = {
        ...stored,
        ...body,
        base_url: stored.base_url,
        api_key: stored.api_key,
        model: stored.model,
        provider: stored.provider,
        api_protocol: stored.api_protocol,
        endpoint: stored.endpoint,
        service_type: stored.service_type,
        settings: stored.settings,
      };
    }
    if (body.config_id && !body.api_key) {
      return response.badRequest(res, '该配置未设置本地凭据');
    }
    if (!body.base_url || !body.api_key) {
      return response.badRequest(res, '缺少 base_url 或 api_key');
    }
    try {
      await aiConfigService.testConnection({
        base_url: body.base_url,
        api_key: body.api_key,
        model: body.model,
        provider: body.provider,
        api_protocol: body.api_protocol,
        endpoint: body.endpoint,
        service_type: body.service_type,
        settings: body.settings,
      });
      response.success(res, { message: '连接测试成功' });
    } catch (err) {
      log.error('AI config test connection failed', { error: err.message });
      response.badRequest(res, '连接测试失败: ' + (err.message || '未知错误'));
    }
  };
}

/** ModelArk / 方舟私有资产库：代理调用 CreateAssetGroup、ListAssets 等（与官方 Action 名一致） */
function modelArkAsset(db, log) {
  return async (req, res) => {
    const body = req.body || {};
    const action = (body.action || '').toString().trim();
    try {
      const stored = body.config_id ? aiConfigService.getConfig(db, Number(body.config_id)) : null;
      const modelArkAssetProxyService = require('../services/modelArkAssetProxyService');
      const data = await modelArkAssetProxyService.callModelArkAsset(
        {
        base_url: stored?.base_url || body.base_url,
          api_key: body.api_key || stored?.api_key,
          action,
          body: body.payload,
          path_mode: body.path_mode,
          http_method: body.http_method,
          api_version: body.api_version,
          auth_mode: body.auth_mode,
          access_key_id: body.access_key_id,
          secret_access_key: body.secret_access_key,
          sign_region: body.sign_region,
          sign_service: body.sign_service,
          session_token: body.session_token,
          project_name: body.project_name,
        },
        log
      );
      response.success(res, data);
    } catch (err) {
      log.error('model-ark-asset proxy failed', { error: err.message, action });
      const status = err.status >= 400 && err.status < 600 ? err.status : 400;
      return response.error(res, status, 'MODEL_ARK_ASSET', err.message || '请求失败', err.payload);
    }
  };
}

/** 即梦2角色认证：代理 GET 素材列表（表单未保存也可用当前填写的网关与 Token） */
function listJimeng2MaterialAssets(db, log) {
  return async (req, res) => {
    const body = req.body || {};
    const stored = body.config_id ? aiConfigService.getConfig(db, Number(body.config_id)) : null;
    const base_url = (stored?.base_url || body.base_url || '').toString().trim().replace(/\/$/, '');
    let api_key = (body.api_key || stored?.api_key || '').toString().trim();
    if (/^bearer\s+/i.test(api_key)) api_key = api_key.replace(/^bearer\s+/i, '').trim();
    if (!base_url || !api_key) {
      return response.badRequest(res, '请先填写网关 URL 与 Token');
    }
    const jimengMaterialHubService = require('../services/jimengMaterialHubService');
    const ctx = { baseUrl: base_url, token: api_key };
    const r = await jimengMaterialHubService.listAssets(ctx, { limit: body.limit, cursor: body.cursor }, log);
    if (!r.ok) {
      return response.badRequest(res, String(r.error || '列出素材失败').slice(0, 800));
    }
    response.success(res, r.data);
  };
}

module.exports = function aiConfigRoutes(db, log, cfg) {
  return {
    list: list(db),
    get: get(db),
    vendorLock: vendorLock(cfg),
    create: create(db, log, cfg),
    update: update(db, log, cfg),
    delete: remove(db, log, cfg),
    setDefault: setDefault(db, log),
    testConnection: testConnection(db, log),
    listJimeng2MaterialAssets: listJimeng2MaterialAssets(db, log),
    modelArkAsset: modelArkAsset(db, log),
    bulkUpdateKey: bulkUpdateKey(db, log, cfg),
  };
};
