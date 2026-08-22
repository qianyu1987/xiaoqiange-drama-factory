const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const DEFAULT_MANIFEST_URL = 'https://www.hhtc.top/app/v1/desktop-updates/stable/latest.json';
const MAX_PACKAGE_BYTES = 512 * 1024 * 1024;
const ALLOWED_DOWNLOAD_HOSTS = new Set([
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
  'github-releases.githubusercontent.com',
]);

let manifestCache = { value: null, expiresAt: 0 };

async function fetchGithubManifest() {
  const releaseResponse = await fetch('https://api.github.com/repos/qianyu1987/xiaoqiange-drama-factory/releases/latest', {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'xiaoqiange-drama-updater' },
    signal: AbortSignal.timeout(6000),
  });
  if (!releaseResponse.ok) throw new Error('GitHub 更新信息暂时不可用');
  const release = await releaseResponse.json();
  const asset = (Array.isArray(release.assets) ? release.assets : []).find((item) => item.name === 'latest.json');
  if (!asset?.browser_download_url) throw new Error('GitHub 更新清单尚未发布');
  const manifestResponse = await fetch(asset.browser_download_url, {
    headers: { Accept: 'application/json', 'User-Agent': 'xiaoqiange-drama-updater' },
    signal: AbortSignal.timeout(6000),
  });
  if (!manifestResponse.ok) throw new Error('GitHub 更新清单读取失败');
  const manifest = validateManifest(await manifestResponse.json());
  if (String(release.tag_name || '').replace(/^v/i, '') !== manifest.version) throw new Error('GitHub 更新版本不一致');
  return manifest;
}

function versionParts(value) {
  return String(value || '').replace(/^v/i, '').split('.').map((part) => Number(part.replace(/\D.*$/, '')) || 0);
}

function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) > (b[index] || 0) ? 1 : -1;
  }
  return 0;
}

function validSha256(value) {
  return /^[a-f0-9]{64}$/i.test(String(value || '').trim());
}

function validateManifest(input) {
  const manifest = input && typeof input === 'object' ? input : {};
  const version = String(manifest.version || '').trim();
  const url = String(manifest.url || '').trim();
  const sha256 = String(manifest.sha256 || '').trim().toLowerCase();
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('更新版本号无效');
  let parsed;
  try { parsed = new URL(url); } catch (_) { throw new Error('更新下载地址无效'); }
  if (parsed.protocol !== 'https:' || !ALLOWED_DOWNLOAD_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error('更新下载地址不受信任');
  }
  if (!validSha256(sha256)) throw new Error('更新包校验值无效');
  return {
    version,
    url,
    sha256,
    notes: String(manifest.notes || '').slice(0, 4000),
    published_at: manifest.published_at || null,
    mandatory: manifest.mandatory === true,
  };
}

function manifestUrl() {
  const value = String(process.env.HHTC_UPDATE_MANIFEST_URL || DEFAULT_MANIFEST_URL).trim();
  let parsed;
  try { parsed = new URL(value); } catch (_) { throw new Error('更新服务地址无效'); }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'www.hhtc.top') throw new Error('更新服务地址不受信任');
  return parsed.toString();
}

async function fetchManifest({ force = false } = {}) {
  if (!force && manifestCache.value && manifestCache.expiresAt > Date.now()) return manifestCache.value;
  const hhtcRequest = fetch(manifestUrl(), {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(6000),
  }).then(async (response) => {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.success === false) throw new Error('HHTC 更新信息暂时不可用');
    return validateManifest(payload.data || payload);
  });
  const results = await Promise.allSettled([hhtcRequest, fetchGithubManifest()]);
  const manifests = results.filter((result) => result.status === 'fulfilled').map((result) => result.value);
  if (!manifests.length) throw new Error('更新信息暂时不可用');
  const manifest = manifests.sort((left, right) => compareVersions(right.version, left.version))[0];
  manifestCache = { value: manifest, expiresAt: Date.now() + 15 * 60 * 1000 };
  return manifest;
}

function packageDirectory() {
  return process.env.XQG_APP_DATA
    || process.env.APPDATA && path.join(process.env.APPDATA, '小钱哥短剧工厂')
    || path.join(os.homedir(), 'AppData', 'Roaming', '小钱哥短剧工厂');
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function downloadPackage(url, target) {
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(10 * 60 * 1000) });
  if (!response.ok) throw new Error(`更新包下载失败 (${response.status})`);
  const finalUrl = new URL(response.url || url);
  if (finalUrl.protocol !== 'https:' || !ALLOWED_DOWNLOAD_HOSTS.has(finalUrl.hostname.toLowerCase())) throw new Error('更新包跳转地址不受信任');
  const length = Number(response.headers.get('content-length') || 0);
  if (length > MAX_PACKAGE_BYTES) throw new Error('更新包超过允许大小');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const file = fs.createWriteStream(target, { mode: 0o600 });
  let total = 0;
  try {
    if (!response.body) throw new Error('更新包内容为空');
    for await (const chunk of response.body) {
      total += chunk.length;
      if (total > MAX_PACKAGE_BYTES) throw new Error('更新包超过允许大小');
      if (!file.write(chunk)) await new Promise((resolve) => file.once('drain', resolve));
    }
  } finally {
    await new Promise((resolve) => file.end(resolve));
  }
  if (!total) throw new Error('更新包内容为空');
}

async function status() {
  if (process.env.PRODUCT_FLAVOR !== 'customer') return { enabled: false, available: false };
  const currentVersion = String(process.env.PRODUCT_VERSION || '0.0.0');
  try {
    const manifest = await fetchManifest();
    const available = compareVersions(manifest.version, currentVersion) > 0;
    return { enabled: true, available, current_version: currentVersion, latest: available ? manifest : null };
  } catch (_) {
    return { enabled: true, available: false, current_version: currentVersion, latest: null, unavailable: true };
  }
}

async function stageAndSchedule(db, expectedVersion, databaseConfig, backupService) {
  if (process.platform !== 'win32') throw new Error('客户自动更新仅支持 Windows ZIP 版本');
  const currentVersion = String(process.env.PRODUCT_VERSION || '0.0.0');
  const manifest = await fetchManifest({ force: true });
  if (expectedVersion && String(expectedVersion) !== manifest.version) throw new Error('更新版本已变化，请刷新后重试');
  if (compareVersions(manifest.version, currentVersion) <= 0) throw new Error('当前已经是最新版本');

  const backup = await backupService.createBackup(db, databaseConfig, 'update');
  const updateRoot = path.join(packageDirectory(), 'updates');
  fs.mkdirSync(updateRoot, { recursive: true });
  const zipPath = path.join(updateRoot, `XiaoQianDramaFactory-v${manifest.version}-windows-x64.zip`);
  await downloadPackage(manifest.url, zipPath);
  const actual = await sha256File(zipPath);
  if (actual.toLowerCase() !== manifest.sha256) {
    fs.rmSync(zipPath, { force: true });
    throw new Error('更新包 SHA-256 校验失败');
  }
  const pendingPath = path.join(updateRoot, 'pending-update.json');
  const root = path.resolve(__dirname, '../../..');
  const metadata = { version: manifest.version, zip_path: zipPath, root, backup_file: backup?.file_name || null, requested_at: new Date().toISOString() };
  fs.writeFileSync(pendingPath, JSON.stringify(metadata, null, 2), { mode: 0o600 });
  const runner = path.join(root, 'update-runner.js');
  if (!fs.existsSync(runner)) throw new Error('更新组件缺失，请重新下载完整客户包');
  const child = spawn(process.execPath, [runner, pendingPath, String(process.pid)], { cwd: root, detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  setTimeout(() => { try { process.kill(process.pid, 'SIGTERM'); } catch (_) {} }, 1500);
  return { accepted: true, version: manifest.version, backup_file: backup?.file_name || null };
}

module.exports = { compareVersions, validateManifest, fetchManifest, status, stageAndSchedule };
