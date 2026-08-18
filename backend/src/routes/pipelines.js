const response = require('../response');
const pipelineService = require('../services/pipelineService');

module.exports = function pipelineRoutes(db, log) {
  return {
    list(req, res) {
      response.success(res, pipelineService.listRuns(db, req.query || {}));
    },
    create(req, res) {
      try {
        const run = pipelineService.createRun(db, req.body || {}, req.get('Idempotency-Key'));
        response.created(res, run);
      } catch (err) {
        response.error(res, err.code === 'NOT_FOUND' ? 404 : 400, err.code || 'PIPELINE_CREATE_FAILED', err.message);
      }
    },
    get(req, res) {
      const run = pipelineService.reconcileRun(db, req.params.id);
      if (!run) return response.notFound(res, '流水线不存在');
      response.success(res, run);
    },
    command(req, res) {
      try {
        const run = pipelineService.command(db, req.params.id, req.body?.command);
        if (!run) return response.notFound(res, '流水线不存在');
        response.success(res, run);
      } catch (err) {
        response.error(res, 400, err.code || 'PIPELINE_COMMAND_FAILED', err.message);
      }
    },
    updateStep(req, res) {
      try {
        response.success(res, pipelineService.updateStep(db, req.params.id, req.params.step_key, req.body || {}));
      } catch (err) {
        log.warn('pipeline step update failed', { error: err.message });
        response.error(res, err.code === 'NOT_FOUND' ? 404 : 400, err.code || 'PIPELINE_STEP_FAILED', err.message);
      }
    },
  };
};
