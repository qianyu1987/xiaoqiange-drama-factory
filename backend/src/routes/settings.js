const settingsService = require('../services/settingsService');
const response = require('../response');
const { loadConfig } = require('../config');
const { resolveVideoGenerationTimeoutMinutes } = require('../config/videoGeneration');

function getLanguage(cfg) {
  return (req, res) => {
    const language = settingsService.getLanguage(cfg);
    response.success(res, { language });
  };
}

function updateLanguage(cfg, log) {
  return (req, res) => {
    const lang = req.body?.language;
    if (lang !== 'zh' && lang !== 'en') {
      return response.badRequest(res, '语言参数错误，只支持 zh 或 en');
    }
    const out = settingsService.updateLanguage(cfg, log, lang);
    if (!out.ok) return response.badRequest(res, out.error);
    const message = lang === 'en' ? 'Language switched to English' : '语言已切换为中文';
    response.success(res, { message, language: lang });
  };
}

/** GET /settings/generation — 获取生成相关全局设置 */
function getGenerationSettings(db) {
  return (req, res) => {
    const concurrency = settingsService.getGlobalSetting(db, 'pipeline_concurrency', 2);
    const video_concurrency = Math.min(2, settingsService.getGlobalSetting(db, 'pipeline_video_concurrency', 2));
    const video_generation_timeout_minutes = resolveVideoGenerationTimeoutMinutes(loadConfig());
    response.success(res, { concurrency, video_concurrency, video_generation_timeout_minutes });
  };
}

/** PUT /settings/generation — 更新生成相关全局设置 */
function updateGenerationSettings(db) {
  return (req, res) => {
    const { concurrency, video_concurrency } = req.body || {};
    if (concurrency !== undefined) {
      const n = Number(concurrency);
      if (!Number.isInteger(n) || n < 1 || n > 20) {
        return response.badRequest(res, '图片并发数需为 1-20 之间的整数');
      }
      settingsService.setGlobalSetting(db, 'pipeline_concurrency', n);
    }
    if (video_concurrency !== undefined) {
      const n = Number(video_concurrency);
      if (!Number.isInteger(n) || n < 1 || n > 2) {
        return response.badRequest(res, '视频并发数需为 1-2 之间的整数');
      }
      settingsService.setGlobalSetting(db, 'pipeline_video_concurrency', n);
    }
    const saved = settingsService.getGlobalSetting(db, 'pipeline_concurrency', 2);
    const saved_video = Math.min(2, settingsService.getGlobalSetting(db, 'pipeline_video_concurrency', 2));
    const video_generation_timeout_minutes = resolveVideoGenerationTimeoutMinutes(loadConfig());
    response.success(res, {
      concurrency: saved,
      video_concurrency: saved_video,
      video_generation_timeout_minutes,
    });
  };
}

const DEFAULT_SD2_PROFILE = {
  base_url: 'https://ark.ap-southeast-1.byteplusapi.com/api/v3',
  auth_mode: 'volc_sign',
  path_mode: 'open_api_query',
  api_version: '2024-01-01',
  project_name: '',
  sign_region: 'ap-southeast-1',
  billing_model: '',
};

function getSd2Settings(db) {
  return (req, res) => {
    const saved = settingsService.getGlobalSetting(db, 'sd2_asset_profile', {});
    response.success(res, { ...DEFAULT_SD2_PROFILE, ...(saved || {}), credentials_configured: false });
  };
}

function updateSd2Settings(db) {
  return (req, res) => {
    const body = req.body || {};
    const profile = {};
    for (const key of Object.keys(DEFAULT_SD2_PROFILE)) {
      if (body[key] !== undefined) profile[key] = String(body[key] || '').trim();
    }
    const merged = { ...DEFAULT_SD2_PROFILE, ...profile };
    if (merged.auth_mode === 'volc_sign' && merged.path_mode !== 'open_api_query') {
      return response.badRequest(res, 'AK/SK 签名必须使用官方 OpenAPI 路径模式');
    }
    settingsService.setGlobalSetting(db, 'sd2_asset_profile', merged);
    response.success(res, { ...merged, credentials_configured: false });
  };
}

module.exports = function settingsRoutes(db, cfg, log) {
  return {
    getLanguage: getLanguage(cfg),
    updateLanguage: updateLanguage(cfg, log),
    getGenerationSettings: getGenerationSettings(db),
    updateGenerationSettings: updateGenerationSettings(db),
    getSd2Settings: getSd2Settings(db),
    updateSd2Settings: updateSd2Settings(db),
  };
};
