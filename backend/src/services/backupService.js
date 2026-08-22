const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const AdmZip = require('adm-zip');

function databasePath(databaseConfig) {
  return path.resolve(databaseConfig?.path || './data/localminidrama.db');
}

function backupDirectory(databaseConfig) {
  return path.join(path.dirname(databasePath(databaseConfig)), 'backups');
}

function markerPath(databaseConfig) {
  return databasePath(databaseConfig) + '.restore-pending.json';
}

function safeBackupPath(databaseConfig, fileName) {
  const root = backupDirectory(databaseConfig);
  const target = path.resolve(root, path.basename(String(fileName || '')));
  if (!target.startsWith(root + path.sep)) throw new Error('备份文件路径无效');
  return target;
}

function validateDatabase(file) {
  const check = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const integrity = check.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') throw new Error(`数据库完整性检查失败: ${integrity}`);
    const required = new Set(check.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name));
    if (!required.has('dramas') || !required.has('episodes')) throw new Error('备份不是有效的短剧工厂数据库');
  } finally {
    check.close();
  }
}

function applyPendingRestore(databaseConfig, log = console) {
  const marker = markerPath(databaseConfig);
  if (!fs.existsSync(marker)) return false;
  const data = JSON.parse(fs.readFileSync(marker, 'utf8'));
  const source = safeBackupPath(databaseConfig, data.file_name);
  validateDatabase(source);
  const target = databasePath(databaseConfig);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (fs.existsSync(target)) {
    const emergency = `${target}.before-restore-${Date.now()}.db`;
    fs.copyFileSync(target, emergency);
  }
  fs.copyFileSync(source, target);
  for (const suffix of ['-wal', '-shm']) {
    try { fs.unlinkSync(target + suffix); } catch (_) {}
  }
  fs.unlinkSync(marker);
  log.info?.('Database backup restored', { source, target });
  return true;
}

function listBackups(databaseConfig) {
  const root = backupDirectory(databaseConfig);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root)
    .filter((name) => /^xiaoqian-backup-.*\.db$/.test(name))
    .map((name) => {
      const stat = fs.statSync(path.join(root, name));
      return { file_name: name, size: stat.size, created_at: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

async function createBackup(db, databaseConfig, reason = 'manual') {
  const root = backupDirectory(databaseConfig);
  fs.mkdirSync(root, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const fileName = `xiaoqian-backup-${stamp}-${String(reason).replace(/[^a-z0-9_-]/gi, '').slice(0, 20) || 'manual'}.db`;
  const target = path.join(root, fileName);
  await db.backup(target);
  validateDatabase(target);
  const backups = listBackups(databaseConfig);
  for (const stale of backups.slice(10)) {
    try { fs.unlinkSync(path.join(root, stale.file_name)); } catch (_) {}
  }
  return listBackups(databaseConfig).find((item) => item.file_name === fileName);
}

function scheduleRestore(databaseConfig, fileName) {
  const source = safeBackupPath(databaseConfig, fileName);
  validateDatabase(source);
  fs.writeFileSync(markerPath(databaseConfig), JSON.stringify({ file_name: path.basename(source), requested_at: new Date().toISOString() }, null, 2), { mode: 0o600 });
  return { scheduled: true, restart_required: true, file_name: path.basename(source) };
}

function redact(value) {
  return String(value || '')
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [REDACTED]')
    .replace(/(api[_-]?key|token|secret|authorization)(["'\s:=]+)([^\s,"']+)/gi, '$1$2[REDACTED]')
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, 'sk-[REDACTED]');
}

function diagnosticPackage(db, cfg) {
  const zip = new AdmZip();
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((row) => row.name);
  const counts = {};
  for (const table of tables) {
    try { counts[table] = db.prepare(`SELECT COUNT(*) count FROM "${table.replace(/"/g, '""')}"`).get().count; } catch (_) {}
  }
  zip.addFile('diagnostic.json', Buffer.from(JSON.stringify({
    product: '小钱哥短剧工厂', version: process.env.PRODUCT_VERSION || '2.0.12', flavor: process.env.PRODUCT_FLAVOR || 'internal',
    platform: process.platform, arch: process.arch, node: process.version, created_at: new Date().toISOString(), table_counts: counts,
  }, null, 2)));
  const configCopy = JSON.parse(JSON.stringify(cfg || {}));
  if (configCopy.ai) configCopy.ai = '[REDACTED]';
  zip.addFile('config-redacted.json', Buffer.from(redact(JSON.stringify(configCopy, null, 2))));
  const logFile = process.env.LOG_FILE;
  if (logFile && fs.existsSync(logFile)) {
    const stat = fs.statSync(logFile);
    const start = Math.max(0, stat.size - 2 * 1024 * 1024);
    const handle = fs.openSync(logFile, 'r');
    const buffer = Buffer.alloc(stat.size - start);
    fs.readSync(handle, buffer, 0, buffer.length, start);
    fs.closeSync(handle);
    zip.addFile('app-redacted.log', Buffer.from(redact(buffer.toString('utf8'))));
  }
  return { buffer: zip.toBuffer(), filename: `xiaoqian-diagnostics-${Date.now()}.zip` };
}

async function ensureDailyBackup(db, databaseConfig, log = console) {
  const latest = listBackups(databaseConfig)[0];
  if (latest && Date.parse(latest.created_at) > Date.now() - 24 * 3600000) return latest;
  try { return await createBackup(db, databaseConfig, 'auto'); }
  catch (error) { log.warn?.('Automatic backup failed', { error: error.message }); return null; }
}

module.exports = { applyPendingRestore, listBackups, createBackup, scheduleRestore, diagnosticPackage, ensureDailyBackup, redact, validateDatabase };
