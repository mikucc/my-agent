// 账号昵称表
//
// 为什么需要：记忆和日记里默认用「对方」——私聊没问题，群里就不知道是谁。
// 这里把 QQ 号 → 昵称 的对应记下来（收到消息时自动学），需要显示名字的地方查它。
//
// 存储：data/names.json
//   { "123456789": { "name": "示例昵称", "updatedAt": 1699999999999, "manual": true } }
// manual=true 的条目不会被自动学习覆盖（手动绑定优先）。
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';

const FILE = path.join(DATA_DIR, 'names.json');
let cache = null;

function load() {
  if (cache) return cache;
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8').replace(/^\uFEFF/, ''));
    cache = raw && typeof raw === 'object' ? raw : {};
  } catch {
    cache = {};
  }
  return cache;
}

function save() {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    const tmp = `${FILE}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(load(), null, 1), 'utf8');
    fs.renameSync(tmp, FILE);
  } catch { /* 昵称表失败不影响聊天 */ }
}

/** 查昵称；没有就返回空串。 */
export function nameOf(userId) {
  const key = String(userId || '').trim();
  if (!key) return '';
  return String(load()[key]?.name || '');
}

/** 收到消息时顺手学：不覆盖手动绑定。 */
export function learn(userId, name, now = Date.now()) {
  const key = String(userId || '').trim();
  const nm = String(name || '').trim().slice(0, 24);
  if (!/^\d{4,15}$/.test(key) || !nm || nm === '我') return null;
  const all = load();
  const prev = all[key];
  if (prev?.manual === true) return prev;
  if (prev?.name === nm) {
    prev.lastSeenAt = now;
    return prev;
  }
  all[key] = { ...(prev || {}), name: nm, updatedAt: now, lastSeenAt: now, manual: false };
  save();
  return all[key];
}

/** 手动绑定（不会被自动学习覆盖）。 */
export function bind(userId, name, now = Date.now()) {
  const key = String(userId || '').trim();
  const nm = String(name || '').trim().slice(0, 24);
  if (!/^\d{4,15}$/.test(key) || !nm) return null;
  const all = load();
  all[key] = { ...(all[key] || {}), name: nm, updatedAt: now, manual: true };
  save();
  return all[key];
}

/** 全部条目（调试/展示用）。 */
export function list() {
  return { ...load() };
}

/** 清掉缓存（测试用）。 */
export function resetCache() {
  cache = null;
}
