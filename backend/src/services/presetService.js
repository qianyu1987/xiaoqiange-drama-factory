const PRESET = Object.freeze({
  preset_key: 'vertical_animation',
  version: 1,
  name: '竖屏动画短剧',
  content: {
    aspect_ratio: '9:16',
    target_duration: 60,
    clip_duration: 10,
    video_model: 'xiaoqian-video',
    style: '高品质家庭动画，角色造型稳定，光线明快，动作清晰',
    pacing: '节奏紧凑，前三秒建立冲突，每十秒推进一次剧情，结尾完成情绪落点',
    dialogue_rule: '将角色名、完整对白和说话动作直接写入视频提示词；角色自然发声，嘴部动作与对白同步',
    subtitle: { position: 'bottom_safe', font_scale: 0.038, max_lines: 2 },
    qa: { max_retries: 3, require_audio: true, reject_blank_frames: true },
    brand_hashtag: '#小钱哥',
  },
});

const LANDSCAPE_MYTH_PRESET = Object.freeze({
  preset_key: 'landscape_chinese_myth_v1',
  version: 1,
  name: '中国神话横屏动画',
  content: {
    aspect_ratio: '16:9',
    target_duration: 80,
    clip_duration: 10,
    clip_count: 8,
    video_model: 'xiaoqian-video',
    accepted_video_models: ['xiaoqian-video'],
    image_model: 'xiaoqian-image',
    image_prompt_models: ['xiaoqian-text'],
    style: '东方电影级3D家庭动画，青铜、玉石、云海与上古山川，人物造型稳定，动作清晰',
    pacing: '前2秒建立冲突，每2到3秒产生动作、对白、视角或剧情推进，不使用无推进空镜',
    speech_rate: { min_cjk_chars_per_second: 4, max_cjk_chars_per_second: 5 },
    native_audio_required: true,
    native_dialogue: true,
    native_bgm: true,
    narration_policy: 'native_offscreen_only_when_no_character_speaks',
    dialogue_rule: '每镜最多一个主要说话人；视频模型原生生成普通话对白，其他人物闭口；禁止朗读标签和提示词',
    subtitle: {
      editor: 'openchatcut',
      position: 'bottom_safe',
      languages: ['zh-CN', 'en'],
      zh_font_size: 38,
      en_font_size: 28,
      max_lines: 2,
      encoding: 'UTF-8',
    },
    qa: { max_retries: 3, require_audio: true, require_openchatcut: true, reject_blank_frames: true },
    brand_hashtag: '#小钱哥',
  },
});

function normalizeCustomerPresetContent(input) {
  if (process.env.PRODUCT_FLAVOR !== 'customer') return { content: input, changed: false };
  const content = { ...(input || {}) };
  let changed = false;
  if (/^(?:agnes-video-|gpt-video)/i.test(String(content.video_model || ''))) {
    content.video_model = 'xiaoqian-video';
    changed = true;
  }
  if (Array.isArray(content.accepted_video_models)
    && content.accepted_video_models.some((model) => /^(?:agnes-video-|gpt-video)/i.test(String(model || '')))) {
    content.accepted_video_models = ['xiaoqian-video'];
    changed = true;
  }
  if (/^agnes-image-/i.test(String(content.image_model || ''))) {
    content.image_model = 'xiaoqian-image';
    changed = true;
  }
  if (Array.isArray(content.image_prompt_models)
    && content.image_prompt_models.some((model) => /^(?:gpt-|agnes-)/i.test(String(model || '')))) {
    content.image_prompt_models = ['xiaoqian-text'];
    changed = true;
  }
  return { content, changed };
}

function migrateCustomerPresets(db) {
  if (process.env.PRODUCT_FLAVOR !== 'customer') return;
  const rows = db.prepare('SELECT preset_key, version, content FROM preset_versions').all();
  const update = db.prepare('UPDATE preset_versions SET content = ? WHERE preset_key = ? AND version = ?');
  const migrate = db.transaction(() => {
    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.content || '{}');
        const normalized = normalizeCustomerPresetContent(parsed);
        if (normalized.changed) update.run(JSON.stringify(normalized.content), row.preset_key, row.version);
      } catch (_) {
        // Leave malformed user data untouched; normal preset reads will report it.
      }
    }
  });
  migrate();
}

function ensureDefaultPreset(db) {
  const now = new Date().toISOString();
  const insert = db.prepare(`INSERT OR IGNORE INTO preset_versions
    (preset_key, version, name, content, is_active, created_at) VALUES (?, ?, ?, ?, 1, ?)`)
  insert.run(PRESET.preset_key, PRESET.version, PRESET.name, JSON.stringify(PRESET.content), now);
  insert.run(LANDSCAPE_MYTH_PRESET.preset_key, LANDSCAPE_MYTH_PRESET.version, LANDSCAPE_MYTH_PRESET.name, JSON.stringify(LANDSCAPE_MYTH_PRESET.content), now);
  // Migrate shipped customer presets without replacing unrelated user edits
  // to style, pacing, subtitle rules, or other project-specific content.
  migrateCustomerPresets(db);
  return getPreset(db, PRESET.preset_key, PRESET.version);
}

function getPreset(db, key, version) {
  const row = version == null
    ? db.prepare('SELECT * FROM preset_versions WHERE preset_key = ? AND is_active = 1 ORDER BY version DESC LIMIT 1').get(key)
    : db.prepare('SELECT * FROM preset_versions WHERE preset_key = ? AND version = ?').get(key, version);
  if (!row) return null;
  return { ...row, content: JSON.parse(row.content || '{}'), is_active: !!row.is_active };
}

module.exports = {
  PRESET,
  LANDSCAPE_MYTH_PRESET,
  ensureDefaultPreset,
  getPreset,
  normalizeCustomerPresetContent,
};
