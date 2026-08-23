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

function chapter(id, endedAt, confirmedText, overrides = {}) {
  return {
    id,
    name: id,
    status: 'ended',
    endedAt,
    rollingSummary: '',
    rollingSummaryThroughMessageId: '',
    messages: [],
    summary: {
      confirmedText,
      draftStatus: 'none',
      draftText: '',
    },
    ...overrides,
  };
}

test('draft summaries are excluded while unconfirmed chapters use transition context', () => {
  const context = loadContext();
  const result = context.buildNarrativeContext({
    chapters: [chapter('pending', '2026-08-23T03:00:00Z', '', {
      rollingSummary: '已压缩的山门冲突',
      messages: [
        { id: 'u1', role: 'user', speakerName: '主控', content: '旧消息' },
        { id: 'a1', role: 'assistant', speakerName: '阿宁', content: '最新原文' },
      ],
      rollingSummaryThroughMessageId: 'u1',
      summary: { confirmedText: '', draftStatus: 'ready', draftText: '绝不能发送的草稿' },
    })],
    activeChapterId: null,
    summary: '',
  });
  const text = result.messages.map(message => message.content).join('\n');
  assert.match(text, /已压缩的山门冲突/);
  assert.match(text, /最新原文/);
  assert.doesNotMatch(text, /绝不能发送的草稿/);
  assert.deepEqual(Array.from(result.trace.chapterSummaryIds), ['pending']);
});

test('active rolling summary, newest confirmed chapter, and unchaptered summary follow priority order', () => {
  const context = loadContext();
  const result = context.buildNarrativeContext({
    chapters: [
      chapter('old', '2026-08-20T00:00:00Z', '旧章提到沙漠'),
      chapter('latest', '2026-08-22T00:00:00Z', '最近章节到达雪山'),
      {
        id: 'active', name: '进行中', status: 'active', endedAt: '',
        rollingSummary: '本章已经发现密道', messages: [],
        summary: { confirmedText: '', draftStatus: 'none', draftText: '' },
      },
    ],
    activeChapterId: 'active',
    summary: '章外曾购买地图',
    userText: '继续探索雪山',
  });
  const text = result.messages[0].content;
  const activeIndex = text.indexOf('本章已经发现密道');
  const latestIndex = text.indexOf('最近章节到达雪山');
  const unchapteredIndex = text.indexOf('章外曾购买地图');
  assert.ok(activeIndex >= 0 && latestIndex > activeIndex && unchapteredIndex > latestIndex);
  assert.match(text, /上回剧情/);
  assert.equal(result.trace.usedActiveChapterRollingSummary, true);
  assert.equal(result.trace.usedUnchapteredSummary, true);
  assert.deepEqual(Array.from(result.trace.chapterSummaryIds).slice(0, 2), ['active', 'latest']);
});

test('older confirmed chapters are selected by relevance with deterministic recency ties', () => {
  const context = loadContext();
  const result = context.buildNarrativeContext({
    chapters: [
      chapter('desert', '2026-08-19T00:00:00Z', '沙漠绿洲藏着蓝色钥匙'),
      chapter('harbor-old', '2026-08-20T00:00:00Z', '港口船长交付星盘'),
      chapter('harbor-new', '2026-08-21T00:00:00Z', '港口灯塔发现走私者'),
      chapter('latest', '2026-08-22T00:00:00Z', '众人在王城休整'),
    ],
    activeChapterId: null,
    summary: '',
    userText: '返回港口寻找灯塔船长',
  }, { budget: 5000 });
  assert.deepEqual(Array.from(result.trace.chapterSummaryIds), ['latest', 'harbor-new', 'harbor-old']);
});

test('narrative layer obeys its character budget and reports omitted sources', () => {
  const context = loadContext();
  const result = context.buildNarrativeContext({
    chapters: [
      chapter('old', '2026-08-20T00:00:00Z', '旧'.repeat(200)),
      chapter('latest', '2026-08-22T00:00:00Z', '新'.repeat(200)),
    ],
    summary: '外'.repeat(200),
    userText: '无关',
  }, { budget: 180 });
  const content = result.messages.map(message => message.content).join('');
  assert.ok(content.length <= 180);
  assert.equal(result.trace.chapterSummaryIds[0], 'latest');
  assert.equal(result.trace.usedUnchapteredSummary, false);
});

test('confirmed text stays active while a replacement draft is generating', () => {
  const context = loadContext();
  const result = context.buildNarrativeContext({
    chapters: [chapter('latest', '2026-08-22T00:00:00Z', '原确认摘要', {
      summary: { confirmedText: '原确认摘要', draftStatus: 'ready', draftText: '替代草稿' },
    })],
    summary: '',
  });
  const text = result.messages[0].content;
  assert.match(text, /原确认摘要/);
  assert.doesNotMatch(text, /替代草稿/);
});
