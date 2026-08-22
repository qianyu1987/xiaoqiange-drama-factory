const PRODUCT_ALIASES = Object.freeze({
  text: 'xiaoqian-text',
  image: 'xiaoqian-image',
  video: 'xiaoqian-video',
});

function customerMode() {
  return process.env.PRODUCT_FLAVOR === 'customer';
}

function capabilityFor(serviceType) {
  const type = String(serviceType || 'text').toLowerCase();
  if (type === 'image' || type === 'storyboard_image') return 'image';
  if (type === 'video') return 'video';
  if (type === 'text') return 'text';
  return null;
}

function aliasFor(serviceType) {
  const capability = capabilityFor(serviceType);
  return capability ? PRODUCT_ALIASES[capability] : null;
}

function gatewayBase(capability) {
  const root = String(process.env.HHTC_APP_BASE_URL || 'https://www.hhtc.top/app/v1').replace(/\/$/, '');
  return `${root}/model-gateway/${capability}`;
}

function forceModel(serviceType, requestedModel) {
  if (!customerMode()) return requestedModel;
  // Product aliases select the managed row. Any other model belongs to a
  // user-owned config and must remain untouched; an absent/unknown model is
  // resolved by the caller through that service type's default config.
  const alias = aliasFor(serviceType);
  if (!requestedModel || requestedModel === alias) return requestedModel;
  return requestedModel;
}

function normalizeConfig(config, serviceType) {
  if (!customerMode()) return config;
  if (config?.managed_group !== 'xiaoqiange-monthly-subscription' && !config?.is_locked) return config;
  const capability = capabilityFor(serviceType || config?.service_type);
  if (!capability) {
    return { ...(config || {}), api_key: '', model: [], default_model: null, is_active: false };
  }
  const alias = PRODUCT_ALIASES[capability];
  return {
    ...(config || {}),
    service_type: serviceType || config?.service_type || capability,
    provider: 'hhtc',
    api_protocol: capability === 'video' ? 'hhtc_video_generation' : 'openai',
    name: capability === 'text' ? '智能文本' : capability === 'image' ? '智能图片' : '智能视频',
    base_url: gatewayBase(capability),
    api_key: String(process.env.HHTC_APP_ACCESS_TOKEN || '').trim(),
    model: [alias],
    default_model: alias,
    endpoint: capability === 'text' ? '/chat/completions' : capability === 'image' ? '/images/generations' : '',
    query_endpoint: '',
    is_active: true,
    is_default: true,
    priority: 1000,
  };
}

function normalizeManifest(manifest) {
  if (!customerMode() || !manifest || typeof manifest !== 'object') return manifest;
  // Historical manifests are read-only. New and unfinished work keeps the
  // selected config/model so custom defaults can be used by the generators.
  return manifest;
}

function normalizePipelinePayload(value) {
  return value;
}

module.exports = {
  PRODUCT_ALIASES,
  customerMode,
  capabilityFor,
  aliasFor,
  gatewayBase,
  forceModel,
  normalizeConfig,
  normalizeManifest,
  normalizePipelinePayload,
};
