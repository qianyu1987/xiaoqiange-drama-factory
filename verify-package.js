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

if (!fs.existsSync(root)) failures.push(`客户包目录不存在: ${root}`);
else walk(root);
if (fs.existsSync(path.join(root, 'desktop.exe')) || fs.existsSync(path.join(root, 'electron.exe'))) failures.push('客户 ZIP 不得包含 EXE 安装器');
if (failures.length) {
  console.error(failures.map((item) => `- ${item}`).join('\n'));
  process.exit(1);
}
console.log(`Customer package scan passed: ${root}`);
