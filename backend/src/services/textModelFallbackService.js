const aiClient = require('./aiClient');

async function generateTextWithFallback(db, log, params = {}) {
  const candidates = [...new Set((params.models || []).map((model) => String(model || '').trim()).filter(Boolean))];
  if (!candidates.length) candidates.push(undefined);
  const errors = [];
  for (const model of candidates) {
    try {
      const options = { ...(params.options || {}), model };
      if (model) delete options.scene_key;
      const text = await aiClient.generateText(
        db,
        log,
        params.serviceType || 'text',
        params.userPrompt,
        params.systemPrompt,
        options
      );
      return { text, model: model || null, fallback_from: errors.length ? candidates[0] || null : null, errors };
    } catch (error) {
      errors.push({ model: model || null, error: String(error.message || error).slice(0, 300) });
      log.warn('Text model candidate failed', { scene_key: params.options?.scene_key, model: model || '(default)', error: error.message });
    }
  }
  const error = new Error(`文本模型全部失败：${errors.map((item) => `${item.model || 'default'}: ${item.error}`).join(' | ')}`);
  error.code = 'TEXT_MODEL_FALLBACK_EXHAUSTED';
  error.attempts = errors;
  throw error;
}

module.exports = { generateTextWithFallback };
