// 账号昵称表测试（临时数据目录）
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-names-'));
process.env.QQ_AGENT_DATA_DIR = tmp;

const names = await import('../src/names.js');

let pass = 0;
const ok = (name, fn) => { fn(); pass += 1; console.log(`  ✓ ${name}`); };

ok('learn 记下昵称，nameOf 能查', () => {
  names.learn('123456789', '示例昵称');
  assert.equal(names.nameOf('123456789'), '示例昵称');
});

ok('昵称变了会更新（非手动）', () => {
  names.learn('123456789', '示例昵称改');
  assert.equal(names.nameOf('123456789'), '示例昵称改');
});

ok('手动绑定后，自动学习不再覆盖', () => {
  names.bind('123456789', '主人');
  names.learn('123456789', '随便改');
  assert.equal(names.nameOf('123456789'), '主人');
});

ok('非法 QQ 号 / 空昵称不记', () => {
  assert.equal(names.learn('abc', 'x'), null);
  assert.equal(names.learn('123456789', ''), null);
  assert.equal(names.nameOf('abc'), '');
});

ok('list 能列出全部', () => {
  const all = names.list();
  assert.ok(Object.keys(all).length >= 1);
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n账号昵称：通过 ${pass}，失败 0`);
