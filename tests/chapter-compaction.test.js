const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadContext() {
  const sandbox = { globalThis: null };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync('js/chapter/chapter-context.js', 'utf8'), sandbox);
  return sandbox.FonlingChapter.Context;
}

function messages(count, ownerForIndex) {
  return Array.from({ length: count }, (_, index) => ({
    id: `m${index + 1}`,
    role: index % 2 ? 'assistant' : 'user',
    content: `消息${index + 1}`,
    ...(ownerForIndex(index) ? { chapterId: ownerForIndex(index) } : {}),
  }));
}

function chapter(id, status, confirmedText = '') {
  return {
    id,
    name: id,
    status,
    rollingSummary: `旧${id}摘要`,
    rollingSummaryThroughMessageId: '',
    summary: { confirmedText },
  };
}

test('compaction starts only above 30 messages and keeps the newest 14', () => {
  const context = loadContext();
  assert.equal(context.buildCompactionPlan({ messages: messages(30, () => null), chapters: [], summary: '' }), null);
  const plan = context.buildCompactionPlan({ messages: messages(31, () => null), chapters: [], summary: '旧章外摘要' });
  assert.equal(plan.retiredMessageIds.length, 17);
  assert.equal(plan.groups.length, 1);
  assert.equal(plan.groups[0].ownerKey, 'unchaptered');
  assert.equal(plan.groups[0].baseSummary, '旧章外摘要');
});

test('retired messages are grouped by chapter ownership without mixing prompts', () => {
  const context = loadContext();
  const source = {
    messages: messages(34, index => index < 6 ? 'active' : index < 12 ? null : index < 20 ? 'pending' : null),
    summary: '章外摘要',
    chapters: [chapter('active', 'active'), chapter('pending', 'ended')],
  };
  const plan = context.buildCompactionPlan(source);
  assert.deepEqual(Array.from(plan.groups, group => group.ownerKey), ['active', 'unchaptered', 'pending']);
  assert.ok(plan.groups.every(group => new Set(group.messages.map(message => message.chapterId || 'unchaptered')).size === 1));
});

test('confirmed ended chapter messages can be discarded without another summary request', () => {
  const context = loadContext();
  const source = {
    messages: messages(31, index => index < 17 ? 'confirmed' : null),
    summary: '',
    chapters: [chapter('confirmed', 'ended', '最终确认摘要')],
  };
  const plan = context.buildCompactionPlan(source);
  assert.equal(plan.groups[0].discardOnly, true);
  assert.equal(plan.groups[0].needsSummary, false);
});

test('successful compaction updates each owner summary and removes only planned messages', () => {
  const context = loadContext();
  const source = {
    messages: messages(34, index => index < 6 ? 'active' : index < 12 ? null : index < 20 ? 'pending' : null),
    summary: '旧章外',
    chapters: [chapter('active', 'active'), chapter('pending', 'ended')],
  };
  const plan = context.buildCompactionPlan(source);
  const next = context.applyCompactionResults(source, plan, {
    active: '新活动摘要',
    unchaptered: '新章外摘要',
    pending: '新待确认摘要',
  });
  assert.equal(next.messages.length, 14);
  assert.equal(next.summary, '新章外摘要');
  assert.equal(next.chapters[0].rollingSummary, '新活动摘要');
  assert.equal(next.chapters[1].rollingSummary, '新待确认摘要');
  assert.equal(next.chapters[0].rollingSummaryThroughMessageId, 'm6');
});

test('missing or empty group results abort compaction without mutating source', () => {
  const context = loadContext();
  const source = {
    messages: messages(31, index => index < 8 ? 'active' : null),
    summary: '',
    chapters: [chapter('active', 'active')],
  };
  const before = JSON.stringify(source);
  const plan = context.buildCompactionPlan(source);
  assert.throws(() => context.applyCompactionResults(source, plan, { active: '', unchaptered: 'ok' }), /摘要/);
  assert.equal(JSON.stringify(source), before);
});
