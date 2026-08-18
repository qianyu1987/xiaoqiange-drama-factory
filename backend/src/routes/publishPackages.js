const response = require('../response');
const service = require('../services/publishPackageService');

module.exports = function publishPackageRoutes(db, cfg, log) {
  return {
    get(req, res) {
      const record = service.getPackage(db, req.params.episode_id);
      if (!record) return response.notFound(res, '发布包尚未生成');
      response.success(res, record);
    },
    async create(req, res) {
      if (!req.get('Idempotency-Key')) return response.error(res, 400, 'IDEMPOTENCY_KEY_REQUIRED', '缺少 Idempotency-Key');
      try {
        response.created(res, await service.createPackage(db, cfg, log, req.params.episode_id, { ...(req.body || {}), idempotency_key: req.get('Idempotency-Key') }));
      } catch (err) {
        response.error(res, err.code === 'NOT_FOUND' ? 404 : 400, err.code || 'PUBLISH_PACKAGE_FAILED', err.message);
      }
    },
    download(req, res) {
      const zip = service.zipPackage(db, req.params.episode_id);
      if (!zip) return response.notFound(res, '发布包不存在');
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(zip.filename)}`);
      res.send(zip.buffer);
    },
  };
};
