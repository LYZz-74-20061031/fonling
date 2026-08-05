const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadClearChatHandler() {
  const html = fs.readFileSync('index.html', 'utf8');
  const handlerBody = html.match(
    /\$\('clearChatBtn'\)\.addEventListener\('click', function\(\) \{([\s\S]*?)\n\}\);/,
  )?.[1];
  assert.ok(handlerBody, 'clear chat handler must exist in index.html');

  const state = {
    messages: [{ role: 'user', content: '需要清除的对话' }],
    summary: '需要清除的对话摘要',
    apiKey: 'sk-test',
    systemPrompt: 'AI 人设',
    style: '回复风格',
    userIdentity: '主控身份',
    bgImage: 'data:image/jpeg;base64,test',
    historyEvents: ['历史事件'],
    keyInfo: ['关键信息'],
    roles: [{ name: '阿宁', bio: '盟友', color: '#FF6B6B' }],
    currentRole: '阿宁',
    currentState: '当前状态',
  };
  const context = {
    state,
    confirm() { return true; },
    saveCurrentCharacter() {},
    renderMessages() {},
  };
  vm.runInNewContext(`this.clearChat = function() {${handlerBody}\n};`, context);
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
    historyEvents: context.state.historyEvents,
    keyInfo: context.state.keyInfo,
    roles: context.state.roles,
    currentRole: context.state.currentRole,
    currentState: context.state.currentState,
  });

  context.clearChat();

  assert.equal(JSON.stringify(context.state.messages), '[]');
  assert.equal(context.state.summary, '');
  assert.equal(JSON.stringify({
    apiKey: context.state.apiKey,
    systemPrompt: context.state.systemPrompt,
    style: context.state.style,
    userIdentity: context.state.userIdentity,
    bgImage: context.state.bgImage,
    historyEvents: context.state.historyEvents,
    keyInfo: context.state.keyInfo,
    roles: context.state.roles,
    currentRole: context.state.currentRole,
    currentState: context.state.currentState,
  }), settingsBefore);
});
