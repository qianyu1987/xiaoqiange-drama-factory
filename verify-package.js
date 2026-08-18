const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || path.join(__dirname, 'stage'));
const failures = [];
const forbiddenPaths = ['hhtc-control-plane', 'desktop/backend-app-secure', '.env', 'drama_generator.db', 'control.db'];
const forbiddenContent = ['/Volumes/brainos', '/Users/mac'];
const secretPatterns = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/,
  /\bcpk-[A-Za-z0-9._~-]{16,}\b/,
  /(?:api[_-]?key|appsecret|client_secret)\s*[:=]\s*["'][A-Za-z0-9._~-]{16,}["']/i,
];
const customerModels = Object.freeze({
  text: new Set(['xiaoqian-text']),
  image: new Set(['xiaoqian-image']),
  storyboard_image: new Set(['xiaoqian-image']),
  video: new Set(['xiaoqian-video']),
});

function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.github' || entry.name === 'skills') continue;
      walk(file);
      continue;
    }
    const relative = path.relative(root, file).replace(/\\/g, '/');
    if (relative === 'verify-package.js') continue;
    for (const marker of forbiddenPaths) if (relative.includes(marker) || file.includes(marker)) failures.push(`禁止文件或路径: ${relative}`);
    if (fs.statSync(file).size > 2 * 1024 * 1024) continue;
    if (!/\.(?:js|json|ya?ml|txt|md|html|css|bat|cmd)$/i.test(entry.name)) continue;
    const content = fs.readFileSync(file, 'utf8');
    for (const marker of forbiddenContent) if (content.includes(marker)) failures.push(`客户包包含开发环境路径: ${relative}`);
    for (const pattern of secretPatterns) if (pattern.test(content)) failures.push(`疑似密钥: ${relative}`);
  }
}

function verifyCustomerModelContract() {
  const configPath = path.join(root, 'backend', 'configs', 'customer-ai-configs.json');
  if (!fs.existsSync(configPath)) {
    failures.push('缺少客户模型别名配置: backend/configs/customer-ai-configs.json');
    return;
  }
  let configs;
  try {
    configs = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    failures.push(`客户模型别名配置无法解析: ${error.message}`);
    return;
  }
  if (!Array.isArray(configs)) {
    failures.push('客户模型别名配置必须是数组');
    return;
  }
  for (const config of configs) {
    const serviceType = String(config?.service_type || '').trim();
    if (serviceType === 'tts') {
      failures.push('客户包不得包含 TTS 渠道配置');
      continue;
    }
    const allowed = customerModels[serviceType];
    if (!allowed) continue;
    const models = Array.isArray(config.model) ? config.model : [config.model];
    if (!models.length || models.some((model) => !allowed.has(String(model || '').trim()))) {
      failures.push(`客户配置包含非产品模型别名: ${serviceType}`);
    }
    if (!allowed.has(String(config.default_model || '').trim())) {
      failures.push(`客户配置默认模型不是产品别名: ${serviceType}`);
    }
    if (String(config.api_key || '').trim()) {
      failures.push(`客户配置包含 API Key: ${serviceType}`);
    }
    if (!/^https:\/\/www\.hhtc\.top\/app\/v1\/model-gateway\//i.test(String(config.base_url || ''))) {
      failures.push(`客户配置 Base URL 不是控制面网关: ${serviceType}`);
    }
  }
  const presetSourcePath = path.join(root, 'backend', 'src', 'services', 'presetService.js');
  if (fs.existsSync(presetSourcePath)) {
    const source = fs.readFileSync(presetSourcePath, 'utf8');
    for (const marker of ["video_model: 'xiaoqian-video'", "image_model: 'xiaoqian-image'", "image_prompt_models: ['xiaoqian-text']"]) {
      if (!source.includes(marker)) failures.push(`客户预设缺少产品别名: ${marker}`);
    }
  }
}

if (!fs.existsSync(root)) failures.push(`客户包目录不存在: ${root}`);
else {
  walk(root);
  verifyCustomerModelContract();
}
if (fs.existsSync(path.join(root, 'desktop.exe')) || fs.existsSync(path.join(root, 'electron.exe'))) failures.push('客户 ZIP 不得包含 EXE 安装器');
if (failures.length) {
  console.error(failures.map((item) => `- ${item}`).join('\n'));
  process.exit(1);
}
console.log(`Customer package scan passed: ${root}`);
