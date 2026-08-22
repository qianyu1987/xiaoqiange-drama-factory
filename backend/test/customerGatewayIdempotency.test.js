const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

process.env.PRODUCT_FLAVOR = 'customer';
process.env.HHTC_APP_ACCESS_TOKEN = 'customer-test-session';

const aiConfigService = require('../src/services/aiConfigService');
const aiClient = require('../src/services/aiClient');
const imageClient = require('../src/services/imageClient');

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

test('customer text and image calls send stable gateway idempotency keys', async (t) => {
  const requests = [];
  const server = await startServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      requests.push({
        method: req.method,
        url: req.url,
        idempotency: req.headers['idempotency-key'],
        body: Buffer.concat(chunks).toString('utf8'),
      });
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/event-stream');
      if (req.url === '/chat/completions') {
        res.end('data: {"choices":[{"delta":{"content":"测试完成"}}]}\n\ndata: [DONE]\n\n');
        return;
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ data: [{ url: 'http://127.0.0.1/generated.png' }] }));
    });
  });
  t.after(() => closeServer(server));

  const originalListConfigs = aiConfigService.listConfigs;
  const base = `http://127.0.0.1:${server.address().port}`;
  const configs = [
    {
      id: 1,
      service_type: 'text',
      provider: 'hhtc',
      api_protocol: 'openai',
      base_url: base,
      endpoint: '/chat/completions',
      api_key: 'gateway-token',
      model: ['xiaoqian-text'],
      default_model: 'xiaoqian-text',
      is_active: true,
      is_default: true,
    },
    {
      id: 2,
      service_type: 'image',
      provider: 'hhtc',
      api_protocol: 'openai',
      base_url: base,
      endpoint: '/images/generations',
      api_key: 'gateway-token',
      model: ['xiaoqian-image'],
      default_model: 'xiaoqian-image',
      is_active: true,
      is_default: true,
    },
  ];
  aiConfigService.listConfigs = (_db, serviceType) => configs.filter((item) => item.service_type === serviceType);
  t.after(() => { aiConfigService.listConfigs = originalListConfigs; });

  const log = { info() {}, warn() {}, error() {} };
  const text = await aiClient.generateText(
    {},
    log,
    'text',
    '返回一句话',
    '',
    { idempotency_key: 'text-job-42', model: 'tampered-model' },
  );
  assert.equal(text, '测试完成');

  const image = await imageClient.callImageApi({}, log, {
    prompt: '一张测试图片',
    model: 'tampered-image-model',
    image_gen_id: 77,
    size: '1:1',
  });
  assert.equal(image.image_url, 'http://127.0.0.1/generated.png');

  const textRequest = requests.find((request) => request.url === '/chat/completions');
  const imageRequest = requests.find((request) => request.url === '/images/generations');
  assert.equal(textRequest.idempotency, 'text-job-42');
  assert.equal(imageRequest.idempotency, 'local-mini-drama-image-77');
  assert.equal(JSON.parse(textRequest.body).model, 'xiaoqian-text');
  assert.equal(JSON.parse(imageRequest.body).model, 'xiaoqian-image');
});

