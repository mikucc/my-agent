// 日记插件
//
// 为什么单独做：塑料记忆只收"值得长期留"的事，而且会被合并/归档；
// 日记是**她自己的记录**——不限字数、不用给别人看、想写什么写什么。
//
// 存储：data/diary/<YYYY-MM-DD>.md。同一天可以分多次追加。
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, getConfig } from '../../src/config.js';
import { chatCompletion, resolveApiKey } from '../../src/llm.js';

const DIR = path.join(DATA_DIR, 'diary');
let api = null;
let cfg = () => ({});

function pad(n) {
  return String(n).padStart(2, '0');
}

export function todayKey(now = Date.now()) {
  const d = new Date(now);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fileOf(date) {
  return path.join(DIR, `${date}.md`);
}

function summaryFileOf(date) {
  return path.join(DIR, `${date}.json`);
}

export function readDiary(date) {
  try {
    return fs.readFileSync(fileOf(date), 'utf8');
  } catch {
    return '';
  }
}

/** 摘要：优先用她写日记时顺手给的那句；没给就从正文取开头，凑到 20~100 字。 */
export function buildSummary(text = '') {
  const clean = String(text || '')
    .replace(/^#.*$/m, '')
    .replace(/（\d{2}:\d{2}）/g, '')
    .replace(/^---$/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return '';
  const sentences = clean.split(/(?<=[。！？!?])/).map((s) => s.trim()).filter(Boolean);
  // 兜底拆句：先挑带情绪的句子，再补后面的，保证 20~100 字（只截第一句会很没用）
  const EMO = /气|烦|累|困|开心|高兴|难过|委屈|哭|笑|不想|难受|舒服|怕|紧张|尬|无聊|喜欢/;
  const priority = sentences.filter((s) => EMO.test(s));
  const ordered = [...priority, ...sentences.filter((s) => !priority.includes(s))];
  let out = '';
  for (const s of ordered) {
    if (out.length >= 40) break;
    out += s;
  }
  if (!out) out = clean;
  return out.slice(0, 100);
}

/**
 * 让模型把日记压成一句 20~100 字的摘要（带状态和情绪）。
 * 失败返回空字符串，调用方退回 buildSummary 的兜底截取。
 */
export async function summarizeDiary(text = '') {
  const body = String(text || '').trim();
  if (!body) return '';
  const c = getConfig();
  const api = c.api || {};
  const conf = {
    baseUrl: String(api.baseUrl || '').trim(),
    apiKey: String(resolveApiKey(c) || '').trim(),
    model: String(api.model || '').trim()
  };
  if (!conf.baseUrl || !conf.model || !conf.apiKey) return '';
  try {
    const r = await chatCompletion({
      messages: [
        {
          role: 'system',
          content: [
            '把这段日记压成一句话摘要，20~100 字。',
            '要写出"今天整体什么状态、什么感受"（累/气/开心/无奈…），不要罗列做了什么事。',
            '用第一人称，口语，不要引号，不要分条，不要"总结："这种前缀。只输出这一句。'
          ].join('\n')
        },
        { role: 'user', content: body.slice(0, 1200) }
      ],
      temperature: 0.5,
      maxTokens: 800,
      overrides: { ...conf, timeoutMs: 40000 }
    });
    const out = String(r?.message?.content || '').trim().replace(/^["'“”]+|["'“”]+$/g, '').trim();
    return out ? out.slice(0, 100) : '';
  } catch {
    return '';
  }
}

export function readSummary(date) {
  try {
    const raw = JSON.parse(fs.readFileSync(summaryFileOf(date), 'utf8'));
    const s = String(raw?.summary || '').trim();
    if (s) return s.slice(0, 100);
  } catch { /* 没有 sidecar */ }
  return buildSummary(readDiary(date));
}

export function writeDiary(text, { date = todayKey(), now = Date.now(), summary = '' } = {}) {
  const body = String(text || '').trim();
  if (!body) return { ok: false, error: '内容是空的' };
  const hh = new Date(now).toTimeString().slice(0, 5);
  try {
    fs.mkdirSync(DIR, { recursive: true });
    const file = fileOf(date);
    const exists = fs.existsSync(file);
    const block = exists ? `\n\n---\n\n（${hh}）\n${body}\n` : `# ${date}\n\n（${hh}）\n${body}\n`;
    fs.appendFileSync(file, block, 'utf8');
    // 摘要单独存：注入用它，正文只在 diary_read 时给全文
    const sum = String(summary || '').trim().slice(0, 100) || buildSummary(body);
    if (sum) {
      let prev = '';
      try {
        const old = JSON.parse(fs.readFileSync(summaryFileOf(date), 'utf8'));
        prev = String(old?.summary || '');
      } catch { /* 首次写 */ }
      // 同一天多次写：用"最新一次"的摘要（更接近当天结尾的状态）
      fs.writeFileSync(summaryFileOf(date), JSON.stringify({ summary: sum || prev, updatedAt: now }, null, 1), 'utf8');
    }
    return { ok: true, date, chars: body.length, summary: sum };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

export function hasDiary(date = todayKey()) {
  return readDiary(date).trim().length > 0;
}

/** 最近一篇日记（今天没有就往前找），用于注入。 */
export function latestDiary(now = Date.now()) {
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(now - i * 86400000);
    const key = todayKey(d.getTime());
    const text = readDiary(key);
    if (text.trim()) return { date: key, text };
  }
  return null;
}

function log(...args) {
  try { api?.log?.(...args); } catch { /* ignore */ }
}

export function setup(a) {
  api = a;
  cfg = a?.config || (() => ({}));
  registerTools();   // ⚠️ 别忘：daily-schedule 就是漏了这行，工具一直没注册
  log('[diary] 日记已加载');
}

export const hooks = {};

/** 到点还没写日记 → orchestrator 会开一次运行专门写日记。 */
export const providers = {
  'diary.pending': () => ({
    pending: !hasDiary(),
    hour: Math.max(0, Math.min(23, Number(cfg()?.writeHour) ?? 23)),
    minute: Math.max(0, Math.min(59, Number(cfg()?.writeMinute) ?? 20))
  })
};

export function promptSections() {
  try {
    if (cfg()?.enabled === false) return [];
    const latest = latestDiary();
    const lines = [];
    if (latest) {
      // 只注入一行摘要（20~100 字）：全文留在文件里，需要时用 diary_read
      const summary = readSummary(latest.date);
      if (summary) lines.push(`【日记·${latest.date}】${summary}`);
    }
    const hour = new Date().getHours();
    if (cfg()?.remind !== false && hour >= Math.max(0, Math.min(23, Number(cfg()?.writeHour) ?? 22)) && !hasDiary()) {
      lines.push('（今天还没写日记。想写就随手写两句——用 diary_write，写给自己看，不用发消息给对方；不想写就算了。）');
    }
    if (!lines.length) return [];
    return [{ id: 'diary', title: '日记', priority: 52, content: lines.join('\n') }];
  } catch {
    return [];
  }
}

function registerTools() {
  api.registerTool({
    id: 'diary_write',
    name: '写日记',
    description: '写今天的日记：不限字数、不限主题，想到什么写什么，只给自己看。同一天可以写多次，会追加。写完不需要发消息告诉对方。',
    category: 'memory',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '日记内容，随性写；可以是一句话，也可以很长' },
        summary: { type: 'string', description: '可选：一句话概括今天（20~100 字），以后聊天时只会带这一句，不带全文' },
        date: { type: 'string', description: '补写某一天（YYYY-MM-DD），不填就是今天' }
      },
      required: ['text']
    },
    async execute(_ctx, args) {
      const text = String(args?.text || '').trim();
      if (!text) return { content: '没写内容，没记。' };
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(args?.date || '')) ? String(args.date) : todayKey();
      let summary = String(args?.summary || '').trim();
      // 她没给摘要就自己压一句（带情绪的 20~100 字），失败再退回截取
      if (!summary && cfg()?.autoSummary !== false) summary = await summarizeDiary(text);
      const r = writeDiary(text, { date, summary });
      if (!r.ok) return { content: `记日记失败：${r.error}` };
      return { content: `写好了（${date}，${r.chars} 字）。摘要：${r.summary || '（无）'}` };
    }
  });

  api.registerTool({
    id: 'diary_read',
    name: '翻日记',
    description: '看某一天或最近一篇日记。想看自己之前写过什么时用；不要把日记原文念给别人。',
    category: 'memory',
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD，不填就是最近一篇' }
      }
    },
    execute(_ctx, args) {
      const wantDate = String(args?.date || '').trim();
      if (wantDate) {
        const text = readDiary(wantDate);
        return { content: text ? text.slice(0, 1500) : `${wantDate} 没有日记。` };
      }
      const latest = latestDiary();
      return { content: latest ? `（${latest.date}）\n${latest.text.slice(0, 1500)}` : '还没有写过日记。' };
    }
  });
}

export { registerTools as _registerTools };

export function deactivate() {
  api = null;
}
