const response = require('../response');
const videoService = require('../services/videoService');
const taskService = require('../services/taskService');
const videoClient = require('../services/videoClient');
const { normalizeAspectRatioForApi } = videoClient;
const { buildNativeAudioPrompt } = require('../services/nativeAudioPromptService');
const productService = require('../services/productService');

function routes(db, log) {
  return {
    agnes25Status: async (req, res) => {
      if (productService.flavor() === 'customer') {
        return response.notFound(res, '接口不存在');
      }
      const config = videoClient.getDefaultVideoConfig(db, 'agnes-video-2.5');
      if (!config || String(config.api_protocol || '').toLowerCase() !== 'agnes_video') {
        return response.error(res, 409, 'AGNES_CONFIG_MISSING', '未配置 Agnes 视频渠道');
      }
      let models = [];
      let discoveryError = null;
      try {
        models = await videoClient.listAgnesVideoModels(config);
      } catch (error) {
        discoveryError = error.code || 'AGNES_MODEL_DISCOVERY_FAILED';
      }
      const listed = models.some((model) => ['agnes-video-2.5', 'agnes-video-v2.5'].includes(String(model).toLowerCase()));
      response.success(res, {
        available: true,
        documented: true,
        preview: true,
        model: 'agnes-video-2.5',
        listed,
        permission: listed ? 'listed' : 'unknown',
        available_models: models,
        discovery_error: discoveryError,
      });
    },
    list: (req, res) => {
      try {
        const query = { ...req.query };
        const { items, total, page, pageSize } = videoService.list(db, query);
        response.successWithPagination(res, items, total, page, pageSize);
      } catch (err) {
        log.error('videos list', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    create: (req, res) => {
      try {
        const body = req.body || {};
        const task = taskService.createTask(db, log, 'video_generation', String(body.drama_id || ''));
        const now = new Date().toISOString();
        const dramaId = Number(body.drama_id) || 0;
        const storyboardId = body.storyboard_id != null ? Number(body.storyboard_id) : null;
        const customerMode = productService.flavor() === 'customer';
        const provider = customerMode ? 'hhtc' : (body.provider || 'chatfire');
        let prompt = body.prompt || '';
        const style = (body.style || '').toString().trim();
        if (style) {
          const baseLower = String(prompt || '').toLowerCase();
          const styleLower = style.toLowerCase();
          if (!baseLower.includes(styleLower)) {
            prompt = prompt ? `${prompt}. Style: ${style}` : `Style: ${style}`;
          }
        }
        let model = customerMode ? 'xiaoqian-video' : (body.model ?? null);
        let duration = body.duration ?? null;
        let dramaMetadata = {};
        if (dramaId) {
          try {
            const row = db.prepare('SELECT metadata FROM dramas WHERE id = ? AND deleted_at IS NULL').get(dramaId);
            dramaMetadata = JSON.parse(row?.metadata || '{}');
          } catch (_) {}
        }
        const nativeAudioProject = dramaMetadata.native_audio_required === true || dramaMetadata.preset_key === 'landscape_chinese_myth_v1';
        let nativeCharacterReferences = [];
        if (nativeAudioProject) {
          if (!storyboardId) throw Object.assign(new Error('原声神话视频必须关联分镜'), { code: 'STORYBOARD_REQUIRED' });
          const sb = db.prepare(`SELECT dialogue, narration, speaker, spoken_text, offscreen_voice, bgm_prompt, bgm_motif,
            sound_effect, characters FROM storyboards WHERE id = ? AND episode_id IN (SELECT id FROM episodes WHERE drama_id = ?) AND deleted_at IS NULL`).get(storyboardId, dramaId);
          if (!sb) throw Object.assign(new Error('原声神话分镜不存在'), { code: 'STORYBOARD_REQUIRED' });
          prompt = buildNativeAudioPrompt({
            basePrompt: prompt,
            dialogue: sb.dialogue || sb.spoken_text,
            speaker: sb.speaker,
            narration: sb.offscreen_voice || sb.narration,
            bgmMotif: sb.bgm_motif || sb.bgm_prompt,
            soundEffects: sb.sound_effect,
          });
          model = dramaMetadata.video_model || 'xiaoqian-video';
          if (customerMode) model = 'xiaoqian-video';
          duration = 10;
          let characterIds = [];
          try { characterIds = JSON.parse(sb.characters || '[]').map(Number).filter(Number.isFinite); } catch (_) {}
          for (const characterId of characterIds) {
            const character = db.prepare(`SELECT name, four_view_image_url, image_url, local_path FROM characters
              WHERE id = ? AND drama_id = ? AND deleted_at IS NULL`).get(characterId, dramaId);
            const reference = character?.four_view_image_url || character?.image_url || character?.local_path;
            if (!reference) throw Object.assign(new Error(`人物“${character?.name || characterId}”尚未定稿，禁止生成视频`), { code: 'CHARACTER_NOT_LOCKED' });
            nativeCharacterReferences.push(reference);
          }
        }
        // 画幅：请求体归一化（全角冒号等）后写入 DB；未传则从 drama.metadata 读取并同样归一化
        let aspectRatio = null;
        if (nativeAudioProject) {
          aspectRatio = normalizeAspectRatioForApi(dramaMetadata.aspect_ratio || '16:9');
        } else if (body.aspect_ratio != null && String(body.aspect_ratio).trim() !== '') {
          aspectRatio = normalizeAspectRatioForApi(body.aspect_ratio);
        }
        if (!aspectRatio && dramaId) {
          try {
            const dramaRow = db.prepare('SELECT metadata FROM dramas WHERE id = ? AND deleted_at IS NULL').get(dramaId);
            if (dramaRow && dramaRow.metadata) {
              const meta = typeof dramaRow.metadata === 'string' ? JSON.parse(dramaRow.metadata) : dramaRow.metadata;
              if (meta && meta.aspect_ratio) aspectRatio = normalizeAspectRatioForApi(meta.aspect_ratio);
            }
          } catch (_) {}
        }
        const resolution = body.resolution ?? null;
        const seed = body.seed != null ? Number(body.seed) : null;
        const cameraFixed = body.camera_fixed != null ? (body.camera_fixed ? 1 : 0) : null;
        const watermark = body.watermark != null ? (body.watermark ? 1 : 0) : 0;
        const imageUrl = body.image_url ?? null;
        // 首尾帧：支持 URL 或本地路径（sxy，存到 first_frame_url / last_frame_url）
        const firstFrameUrl = body.first_frame_url ?? body.first_frame_local_path ?? null;
        const lastFrameUrl = body.last_frame_url ?? body.last_frame_local_path ?? null;
        // 多图模式：sxy，存 JSON 数组到 reference_image_urls
        const requestedReferences = body.reference_image_urls && Array.isArray(body.reference_image_urls) ? body.reference_image_urls : [];
        const combinedReferences = [...new Set([...requestedReferences, ...nativeCharacterReferences].filter(Boolean))];
        const refImagesJson = combinedReferences.length ? JSON.stringify(combinedReferences.slice(0, 10)) : null;
        db.prepare(
          `INSERT INTO video_generations (drama_id, storyboard_id, provider, prompt, model, duration, aspect_ratio, resolution, seed, camera_fixed, watermark, image_url, first_frame_url, last_frame_url, reference_image_urls, status, task_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'processing', ?, ?, ?)`
        ).run(dramaId, storyboardId, provider, prompt, model, duration, aspectRatio, resolution, seed, cameraFixed, watermark, imageUrl, firstFrameUrl, lastFrameUrl, refImagesJson, task.id, now, now);
        const videoGenId = db.prepare('SELECT last_insert_rowid() as id').get().id;
        setImmediate(() => {
          videoService.processVideoGeneration(db, log, videoGenId);
        });
        const item = videoService.getById(db, videoGenId);
        response.created(res, item || { id: videoGenId, task_id: task.id, status: 'processing' });
      } catch (err) {
        log.error('videos create', { error: err.message });
        if (err.code) return response.error(res, 400, err.code, err.message);
        response.internalError(res, err.message);
      }
    },
    get: (req, res) => {
      try {
        const item = videoService.getById(db, req.params.id);
        if (!item) return response.notFound(res, '记录不存在');
        response.success(res, item);
      } catch (err) {
        log.error('videos get', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    delete: (req, res) => {
      try {
        const ok = videoService.deleteById(db, log, req.params.id);
        if (!ok) return response.notFound(res, '记录不存在');
        response.success(res, { message: '删除成功' });
      } catch (err) {
        log.error('videos delete', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    fromImage: (req, res) => {
      try {
        const task = taskService.createTask(db, log, 'video_generation', req.params.image_gen_id);
        response.success(res, { task_id: task.id });
      } catch (err) {
        log.error('videos fromImage', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    episodeBatch: (req, res) => {
      try {
        response.success(res, []);
      } catch (err) {
        log.error('videos episode batch', { error: err.message });
        response.internalError(res, err.message);
      }
    },
  };
}

module.exports = routes;
