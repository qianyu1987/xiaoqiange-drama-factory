/**
 * Seedance2 / 即梦素材库：主图变更与认证快照（与 videoClient 中 storage 路径归一化规则一致）
 */

function normalizeStorageRelPath(p) {
  let s = String(p || '').trim().replace(/^[/\\]+/, '').split('?')[0];
  s = s.replace(/\\/g, '/').replace(/\/+$/, '');
  return s;
}

function normImageUrlKey(u) {
  return String(u || '').trim().split('?')[0];
}

function parseSeedance2Asset(val) {
  if (val == null || val === '') return null;
  try {
    return typeof val === 'string' ? JSON.parse(val) : val;
  } catch (_) {
    return null;
  }
}

/**
 * 角色主图（local_path / image_url）相对上次保存发生变化时，若 seedance2 仍为 active，则标为 stale，避免旧 asset 误绑新脸。
 * @param {object} prevRow — 含 id, local_path, image_url, seedance2_asset（更新前快照）
 * @param {{ local_path?: string|null; image_url?: string|null }} nextPatch — 未传字段沿用 prevRow
 */
function markStaleOnCharacterMainImageDrift(db, log, prevRow, nextPatch) {
  if (!db || !prevRow || !prevRow.id) return;
  const nextLp = normalizeStorageRelPath(
    nextPatch.local_path !== undefined ? nextPatch.local_path : prevRow.local_path || ''
  );
  const nextImg = normImageUrlKey(
    nextPatch.image_url !== undefined ? nextPatch.image_url : prevRow.image_url || ''
  );
  const oldLp = normalizeStorageRelPath(prevRow.local_path || '');
  const oldImg = normImageUrlKey(prevRow.image_url || '');
  if (oldLp === nextLp && oldImg === nextImg) return;
  const asset = parseSeedance2Asset(prevRow.seedance2_asset);
  if (!asset || String(asset.status || '').toLowerCase() !== 'active') return;
  const now = new Date().toISOString();
  const merged = {
    ...asset,
    status: 'stale',
    stale_reason: 'character_main_image_changed',
    updated_at: now,
  };
  db.prepare('UPDATE characters SET seedance2_asset = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(merged),
    now,
    Number(prevRow.id)
  );
  log?.info?.('[SD2认证] 角色主图已变更，素材状态已标为 stale，需重新认证后视频才可将该图替换为 asset://', {
    character_id: prevRow.id,
  });
}

module.exports = {
  normalizeStorageRelPath,
  markStaleOnCharacterMainImageDrift,
  parseSeedance2Asset,
};
