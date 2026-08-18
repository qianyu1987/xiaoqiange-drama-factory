const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function authPath() {
  const root = process.env.XQG_APP_DATA || process.env.APPDATA || path.join(os.homedir(), '.xiaoqian-drama-factory');
  fs.mkdirSync(root, { recursive: true });
  return path.join(root, 'auth.dpapi');
}

function powershell(script, input, raw = false) {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    input: raw ? String(input || '') : JSON.stringify(input || {}), encoding: 'utf8', windowsHide: true,
  });
  if (result.status !== 0) throw new Error(String(result.stderr || 'Windows 安全存储失败').trim());
  return String(result.stdout || '').trim();
}

function fallbackKey() {
  return crypto.createHash('sha256').update(`xiaoqian-drama|${os.userInfo().username}|${os.hostname()}`).digest();
}

function fallbackEncrypt(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', fallbackKey(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value || {}), 'utf8'), cipher.final()]);
  return JSON.stringify({ iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), data: data.toString('base64url') });
}

function fallbackDecrypt(raw) {
  const value = JSON.parse(raw);
  const decipher = crypto.createDecipheriv('aes-256-gcm', fallbackKey(), Buffer.from(value.iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(value.tag, 'base64url'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.data, 'base64url')), decipher.final()]).toString('utf8'));
}

function save(value) {
  const file = authPath();
  let encrypted;
  if (process.platform === 'win32') {
    encrypted = powershell(
      '$inputText = [Console]::In.ReadToEnd(); $secure = ConvertTo-SecureString $inputText -AsPlainText -Force; ConvertFrom-SecureString $secure',
      value,
    );
  } else {
    encrypted = fallbackEncrypt(value);
  }
  fs.writeFileSync(file, encrypted, { encoding: 'utf8', mode: 0o600 });
}

function load() {
  try {
    const raw = fs.readFileSync(authPath(), 'utf8');
    if (process.platform === 'win32') {
      const value = powershell(
        '$encrypted = [Console]::In.ReadToEnd(); $secure = ConvertTo-SecureString $encrypted; $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure); try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }',
        raw,
        true,
      );
      return JSON.parse(value);
    }
    return fallbackDecrypt(raw);
  } catch (_) {
    return null;
  }
}

function clear() {
  try { fs.unlinkSync(authPath()); } catch (_) {}
}

module.exports = { save, load, clear, authPath };
