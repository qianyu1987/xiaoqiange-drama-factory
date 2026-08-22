const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const [pendingPath, parentPid] = process.argv.slice(2);
if (!pendingPath || !fs.existsSync(pendingPath)) process.exit(2);
const pending = JSON.parse(fs.readFileSync(pendingPath, 'utf8'));
const root = path.resolve(pending.root || path.join(__dirname));
const zipPath = path.resolve(pending.zip_path || '');
const staging = path.join(path.dirname(zipPath), `stage-${pending.version}-${Date.now()}`);
const backup = path.join(path.dirname(zipPath), `previous-${pending.version}-${Date.now()}`);

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'ignore', windowsHide: true });
  if (result.status !== 0) throw new Error(`${command} failed`);
}

async function waitForParent() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = spawnSync('tasklist', ['/FI', `PID eq ${parentPid}`], { encoding: 'utf8', windowsHide: true });
    if (!result.stdout || !new RegExp(`\\b${parentPid}\\b`).test(result.stdout)) return;
    await sleep(500);
  }
  throw new Error('旧服务未退出');
}

function copyDirectory(source, target) {
  fs.cpSync(source, target, { recursive: true, force: true });
}

async function main() {
  await waitForParent();
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${staging.replace(/'/g, "''")}' -Force`]);
  const entries = fs.readdirSync(staging);
  const packageRoot = entries.length === 1 && fs.statSync(path.join(staging, entries[0])).isDirectory() ? path.join(staging, entries[0]) : staging;
  if (!fs.existsSync(path.join(packageRoot, 'VERSION')) || !fs.existsSync(path.join(packageRoot, 'start.bat'))) throw new Error('更新包不是有效的客户包');
  const replaceable = ['backend', 'frontend', 'tools', 'start.bat', 'stop.bat', 'launcher.js', 'update-runner.js', 'README.md', 'LICENSE', 'VERSION', 'PACKAGE-MANIFEST.json', 'docs'];
  const packageEntries = replaceable.filter((name) => fs.existsSync(path.join(packageRoot, name)));
  fs.mkdirSync(backup, { recursive: true });
  for (const name of packageEntries) {
    const source = path.join(root, name);
    if (fs.existsSync(source)) fs.renameSync(source, path.join(backup, name));
  }
  try {
    for (const name of packageEntries) {
      const source = path.join(packageRoot, name);
      if (fs.existsSync(source)) copyDirectory(source, path.join(root, name));
    }
    fs.rmSync(pendingPath, { force: true });
    fs.rmSync(staging, { recursive: true, force: true });
    const restart = spawn(process.env.ComSpec || 'cmd.exe', ['/c', 'start', '', path.join(root, 'start.bat')], { detached: true, stdio: 'ignore', windowsHide: true });
    restart.unref();
  } catch (error) {
    for (const name of packageEntries) {
      fs.rmSync(path.join(root, name), { recursive: true, force: true });
      const old = path.join(backup, name);
      if (fs.existsSync(old)) fs.renameSync(old, path.join(root, name));
    }
    throw error;
  }
}

main().catch((error) => {
  try { fs.writeFileSync(path.join(path.dirname(pendingPath), 'update-error.txt'), `${new Date().toISOString()} ${error.message}\n`, 'utf8'); } catch (_) {}
  process.exit(1);
});
