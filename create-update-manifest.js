const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function buildManifest({ version, zipPath, repository, notes, publishedAt }) {
  const normalizedVersion = String(version || '').replace(/^v/i, '').trim();
  if (!/^\d+\.\d+\.\d+$/.test(normalizedVersion)) throw new Error('Invalid release version');
  const zipName = path.basename(zipPath);
  if (!fs.existsSync(zipPath)) throw new Error(`Missing release ZIP: ${zipPath}`);
  const repo = String(repository || 'qianyu1987/xiaoqiange-drama-factory').trim();
  if (!/^[^/]+\/[^/]+$/.test(repo)) throw new Error('Invalid GitHub repository');
  return {
    version: normalizedVersion,
    url: `https://github.com/${repo}/releases/download/v${normalizedVersion}/${zipName}`,
    sha256: sha256(zipPath),
    notes: String(notes || '').slice(0, 4000),
    published_at: publishedAt || new Date().toISOString(),
    mandatory: false,
  };
}

if (require.main === module) {
  const [version, zipPath, outputPath] = process.argv.slice(2);
  const manifest = buildManifest({
    version,
    zipPath,
    repository: process.env.GITHUB_REPOSITORY || 'qianyu1987/xiaoqiange-drama-factory',
    notes: process.env.RELEASE_NOTES || `小钱哥短剧工厂客户版 ${String(version || '').replace(/^v/i, '')}`,
    publishedAt: process.env.RELEASE_PUBLISHED_AT || new Date().toISOString(),
  });
  const target = path.resolve(outputPath || path.join(path.dirname(zipPath), 'latest.json'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`Update manifest written to ${target}`);
}

module.exports = { buildManifest };
