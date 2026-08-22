const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadClearChatHandler(saveResult = { ok: true }) {
  const html = fs.readFileSync('index.html', 'utf8');
  const handlerBody = html.match(
    /\$\('clearChatBtn'\)\.addEventListener\('click', function\(\) \{([\s\S]*?)\n\}\);/,
  )?.[1];
  const reportSaveFailure = html.match(/function reportSaveFailure\([^)]*\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(handlerBody, 'clear chat handler must exist in index.html');
  assert.ok(reportSaveFailure, 'reportSaveFailure must exist in index.html');

  const state = {
    messages: [{ role: 'user', content: '需要清除的对话' }],
    summary: '需要清除的对话摘要',
    apiKey: 'sk-test',
    systemPrompt: 'AI 人设',
    style: '回复风格',
    userIdentity: '主控身份',
    bgImage: 'data:image/jpeg;base64,test',
    memories: [{ id: 'formal', type: 'key_info', content: '正式记忆', status: 'active', pinned: true }],
    currentScene: { location: '北门', notes: '正式场景' },
    memoryCandidates: [{ id: 'candidate', status: 'pending' }],
    memoryAnalysis: { analyzedTurnKeys: ['turn-1'], lastFailure: { message: 'old' }, activeCharacter: '阿宁' },
    memoryRequestTraces: { request1: { status: 'done' } },
    roles: [{ name: '阿宁', bio: '盟友', color: '#FF6B6B' }],
    currentRole: '阿宁',
  };
  let renderCount = 0;
  let syncCount = 0;
  let warningCount = 0;
  const context = {
    state,
    confirm() { return true; },
    saveCurrentCharacter() { return saveResult; },
    renderMessages() { renderCount += 1; },
    memoryController: { sync() { syncCount += 1; } },
    memoryUI: { showStorageWarning() { warningCount += 1; } },
    getCounts() { return { renderCount, syncCount, warningCount }; },
  };
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync('js/memory/memory-model.js', 'utf8'), context);
  vm.runInNewContext(`${reportSaveFailure}\nthis.clearChat = function() {${handlerBody}\n};`, context);
  return context;
}

test('clear chat removes conversation data without changing settings', () => {
  const context = loadClearChatHandler();
  const settingsBefore = JSON.stringify({
    apiKey: context.state.apiKey,
    systemPrompt: context.state.systemPrompt,
    style: context.state.style,
    userIdentity: context.state.userIdentity,
    bgImage: context.state.bgImage,
    memories: context.state.memories,
    currentScene: context.state.currentScene,
    roles: context.state.roles,
    currentRole: context.state.currentRole,
  });

  context.clearChat();

  assert.equal(JSON.stringify(context.state.messages), '[]');
  assert.equal(context.state.summary, '');
  assert.deepEqual(Array.from(context.state.memoryCandidates), []);
  assert.deepEqual(JSON.parse(JSON.stringify(context.state.memoryAnalysis)), {
    analyzedTurnKeys: [], lastFailure: null, activeCharacter: null,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(context.state.memoryRequestTraces)), {});
  assert.equal(JSON.stringify({
    apiKey: context.state.apiKey,
    systemPrompt: context.state.systemPrompt,
    style: context.state.style,
    userIdentity: context.state.userIdentity,
    bgImage: context.state.bgImage,
    memories: context.state.memories,
    currentScene: context.state.currentScene,
    roles: context.state.roles,
    currentRole: context.state.currentRole,
  }), settingsBefore);
});

test('clear chat still clears derived memory when messages are already empty', () => {
  const context = loadClearChatHandler();
  context.state.messages = [];
  context.state.summary = '';

  context.clearChat();

  assert.deepEqual(Array.from(context.state.memoryCandidates), []);
  assert.deepEqual(JSON.parse(JSON.stringify(context.state.memoryRequestTraces)), {});
});

test('clear chat restores all conversation-derived state when persistence fails', () => {
  const context = loadClearChatHandler({ ok: false, rolledBack: true });
  const before = JSON.stringify(context.state);

  context.clearChat();

  assert.equal(JSON.stringify(context.state), before);
  assert.deepEqual(context.getCounts(), { renderCount: 0, syncCount: 1, warningCount: 1 });
});
