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
  return aliasFor(serviceType) || requestedModel;
}

function normalizeConfig(config, serviceType) {
  if (!customerMode()) return config;
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
  return {
    ...manifest,
    model: PRODUCT_ALIASES.video,
    imageModel: PRODUCT_ALIASES.image,
    imagePromptModels: [PRODUCT_ALIASES.text],
    acceptedVideoModels: [PRODUCT_ALIASES.video],
    modelPolicy: 'agnes-only-v1',
  };
}

function normalizePipelinePayload(value) {
  if (!customerMode() || value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(normalizePipelinePayload);
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    if (['model', 'video_model', 'actual_video_model', 'accepted_video_models'].includes(key)) {
      output[key] = Array.isArray(child) ? [PRODUCT_ALIASES.video] : PRODUCT_ALIASES.video;
    } else if (['image_model', 'asset_image_model'].includes(key)) {
      output[key] = PRODUCT_ALIASES.image;
    } else if (['text_model', 'image_prompt_model', 'image_prompt_models'].includes(key)) {
      output[key] = Array.isArray(child) ? [PRODUCT_ALIASES.text] : PRODUCT_ALIASES.text;
    } else {
      output[key] = normalizePipelinePayload(child);
    }
  }
  return output;
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
