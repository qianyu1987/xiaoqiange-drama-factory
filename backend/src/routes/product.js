const response = require('../response');
const productService = require('../services/productService');
const { getFfmpegPath, getFfprobePath, hasLocalFfmpeg } = require('../utils/ffmpegPath');
const cloudAgentService = require('../services/cloudAgentService');
const backupService = require('../services/backupService');
const updateService = require('../services/updateService');

module.exports = function productRoutes(db, cfg) {
  return {
    status(req, res) {
      response.success(res, productService.getStatus(db, cfg));
    },
    onboarding(req, res) {
      const profile = productService.completeOnboarding(db, req.body || {});
      response.success(res, { profile, status: productService.getStatus(db, cfg) });
    },
    async pair(req, res) {
      try {
        const result = await productService.pairDevice(db, req.body || {});
        const storage = productService.configureStoragePath(cfg, req.body?.storage_path);
        response.success(res, {
          account: result.account,
          device: result.device,
          entitlement: result.entitlement,
          expires_at: result.expires_at,
          storage,
          restart_required: storage.changed,
        });
      } catch (err) {
        response.error(res, 400, 'DEVICE_PAIR_FAILED', err.message || '设备配对失败');
      }
    },
    async selfTest(req, res) {
      let account = null;
      let cloudError = null;
      if (productService.flavor() === 'customer') {
        try { account = await cloudAgentService.accountStatus(db); }
        catch (error) { cloudError = error.message; }
      }
      response.success(res, {
        database: { ok: true },
        ffmpeg: { ok: hasLocalFfmpeg(), path: getFfmpegPath(), ffprobe_path: getFfprobePath() },
        cloud: { configured: true, ok: productService.flavor() !== 'customer' || !!account, error: cloudError ? '云端服务暂时不可用' : null },
        account,
        storage: { path: cfg?.storage?.local_path || './data/storage' },
      });
    },
    pendingCloudJob(req, res) {
      response.success(res, cloudAgentService.getPendingNavigation(db));
    },
    acknowledgeCloudJob(req, res) {
      const acknowledged = cloudAgentService.acknowledgeNavigation(db, req.params.id);
      if (!acknowledged) return response.notFound(res, '云端任务不存在或已打开');
      response.success(res, { acknowledged: true });
    },
    listBackups(req, res) {
      response.success(res, backupService.listBackups(cfg.database));
    },
    async createBackup(req, res) {
      try { response.created(res, await backupService.createBackup(db, cfg.database, 'manual')); }
      catch (err) { response.error(res, 500, 'BACKUP_FAILED', err.message); }
    },
    restoreBackup(req, res) {
      try { response.success(res, backupService.scheduleRestore(cfg.database, req.body?.file_name)); }
      catch (err) { response.error(res, 400, 'RESTORE_FAILED', err.message); }
    },
    async updateStatus(req, res) {
      response.success(res, await updateService.status());
    },
    async update(req, res) {
      try {
        const result = await updateService.stageAndSchedule(db, req.body?.version, cfg.database, backupService);
        response.accepted(res, result);
      } catch (err) {
        response.error(res, 400, 'UPDATE_FAILED', err.message || '更新失败');
      }
    },
    diagnostics(req, res) {
      try {
        const file = backupService.diagnosticPackage(db, cfg);
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
        res.send(file.buffer);
      } catch (err) {
        response.error(res, 500, 'DIAGNOSTICS_FAILED', err.message);
      }
    },
  };
};
