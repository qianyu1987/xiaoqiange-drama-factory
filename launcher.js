const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');

const root = __dirname;
const appData = process.env.XQG_APP_DATA || path.join(process.env.APPDATA || path.join(process.env.USERPROFILE || root, 'AppData', 'Roaming'), '小钱哥短剧工厂');
const mediaDir = process.env.XQG_MEDIA_DIR || path.join(process.env.USERPROFILE || root, 'Videos', '小钱哥短剧工厂');
const port = String(process.env.PORT || '5679');
const pidFile = path.join(appData, 'server.pid');

const major = Number(process.versions.node.split('.')[0]);
if (process.platform !== 'win32' || major < 22) {
  console.error('小钱哥短剧工厂需要 Windows 10/11 和 Node.js 22 LTS。');
  process.exit(1);
}

fs.mkdirSync(appData, { recursive: true });
fs.mkdirSync(mediaDir, { recursive: true });
const env = {
  ...process.env,
  PRODUCT_FLAVOR: 'customer',
  PRODUCT_VERSION: fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim(),
  XQG_APP_DATA: appData,
  XQG_MEDIA_DIR: mediaDir,
  WEB_DIST_PATH: path.join(root, 'frontend'),
  FFMPEG_PATH: path.join(root, 'tools', 'ffmpeg', 'ffmpeg.exe'),
  FFPROBE_PATH: path.join(root, 'tools', 'ffmpeg', 'ffprobe.exe'),
  PORT: port,
  HOST: '127.0.0.1',
};

const child = spawn(process.execPath, [path.join(root, 'backend', 'src', 'server.js')], {
  cwd: root,
  env,
  stdio: 'inherit',
  windowsHide: false,
});
fs.writeFileSync(pidFile, String(child.pid), 'utf8');

const clean = () => {
  try { fs.rmSync(pidFile, { force: true }); } catch (_) {}
};
child.once('exit', (code) => { clean(); process.exit(code || 0); });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { child.kill(); clean(); });

setTimeout(() => {
  execFile(process.env.ComSpec || 'cmd.exe', ['/c', 'start', '', `http://127.0.0.1:${port}/`], { windowsHide: true });
}, 1200);
