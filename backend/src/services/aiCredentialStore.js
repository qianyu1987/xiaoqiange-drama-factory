const crypto = require('crypto');
const os = require('os');
const { spawnSync } = require('child_process');

// AI credentials are local secrets. Windows uses DPAPI; development platforms
// use a machine/user-bound AES key so the database never contains plaintext.
function fallbackKey() {
  return crypto.createHash('sha256')
    .update(`xiaoqian-ai-config|${os.userInfo().username}|${os.hostname()}`)
    .digest();
}

function powershell(script, input, raw = false) {
  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script,
  ], { input: raw ? String(input || '') : JSON.stringify(input || ''), encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(String(result.stderr || 'Windows 安全存储失败').trim());
  return String(result.stdout || '').trim();
}

function encryptFallback(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', fallbackKey(), iv);
  const data = Buffer.concat([cipher.update(String(value || ''), 'utf8'), cipher.final()]);
  return JSON.stringify({
    version: 1,
    algorithm: 'aes-256-gcm',
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    data: data.toString('base64url'),
  });
}

function decryptFallback(raw) {
  const value = JSON.parse(raw);
  const decipher = crypto.createDecipheriv('aes-256-gcm', fallbackKey(), Buffer.from(value.iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(value.tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(value.data, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

function encrypt(value) {
  const text = String(value || '');
  if (!text) return null;
  if (process.platform === 'win32') {
    return `dpapi:${powershell(
      '$inputText = [Console]::In.ReadToEnd(); $secure = ConvertTo-SecureString $inputText -AsPlainText -Force; ConvertFrom-SecureString $secure',
      text,
    )}`;
  }
  return `local:${encryptFallback(text)}`;
}

function decrypt(raw) {
  if (!raw) return '';
  const value = String(raw);
  try {
    if (value.startsWith('dpapi:') && process.platform === 'win32') {
      return powershell(
        '$encrypted = [Console]::In.ReadToEnd(); $secure = ConvertTo-SecureString $encrypted; $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure); try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }',
        value.slice(6),
        true,
      );
    }
    if (value.startsWith('local:')) return decryptFallback(value.slice(6));
    return '';
  } catch (_) {
    return '';
  }
}

module.exports = { encrypt, decrypt };
