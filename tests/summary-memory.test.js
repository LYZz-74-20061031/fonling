const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadAutoSummarize(fetchImpl, options = {}) {
  const html = fs.readFileSync('index.html', 'utf8');
  const fn = html.match(/async function autoSummarize\(\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(fn, 'autoSummarize must exist in index.html');

  const state = {
    apiKey: 'test-key',
    summary: '旧摘要：主角已经与阿宁结盟。',
    currentCharacter: 'A',
    messages: Array.from({ length: 31 }, (_, index) => ({
      id: `m${index + 1}`,
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `消息 ${index + 1}`,
    })),
    summarising: false,
  };
  const note = {
    remove() {},
    querySelector() { return { textContent: '' }; },
  };
  const context = {
    state,
    MAX_MSG_BEFORE_SUMMARY: 30,
    RECENT_KEEP: 14,
    DEEPSEEK_API: 'https://api.deepseek.com/chat/completions',
    MODEL: 'deepseek-v4-flash',
    FonlingMemory: { Model: { ensureMessageIds(messages) { return messages; } } },
    document: { createElement() { return note; } },
    chatArea: { appendChild() {} },
    scrollToBottom() {},
    saveCurrentCharacter: options.saveCurrentCharacter || function() { return { ok: true, rolledBack: true }; },
    reportSaveFailure() {},
    summaryRequestEpoch: 0,
    renderMessages() {},
    setTimeout(callback) { callback(); },
    fetch: fetchImpl,
  };

  vm.runInNewContext(`${fn}; this.autoSummarize = autoSummarize;`, context);
  return context;
}

test('merges the previous summary into the next bounded summary request', async () => {
  let requestBody;
  const context = loadAutoSummarize(async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return { choices: [{ message: { content: '新的合并摘要' } }] };
      },
    };
  });

  await context.autoSummarize();

  assert.equal(requestBody.max_tokens, 1024);
  assert.ok(
    requestBody.messages.some(message =>
      message.content.includes('旧摘要：主角已经与阿宁结盟。')),
    'the existing summary must be included in the consolidation request',
  );
  assert.equal(context.state.summary, '新的合并摘要');
  assert.equal(context.state.messages.length, 14);
});

test('summary removes only the captured boundary and preserves messages appended while awaiting', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const context = loadAutoSummarize(async () => {
    await gate;
    return { ok: true, async json() { return { choices: [{ message: { content: '边界摘要' } }] }; } };
  });
  const task = context.autoSummarize();
  await Promise.resolve();
  context.state.messages.push({ id: 'new-during-summary', role: 'user', content: '同期新增' });
  release();
  await task;
  assert.deepEqual(context.state.messages.map(message => message.id), [
    ...Array.from({ length: 14 }, (_, index) => `m${index + 18}`),
    'new-during-summary',
  ]);
});

test('late summary response cannot write or save another character', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let saves = 0;
  const context = loadAutoSummarize(async () => {
    await gate;
    return { ok: true, async json() { return { choices: [{ message: { content: 'A摘要' } }] }; } };
  }, { saveCurrentCharacter() { saves += 1; return { ok: true, rolledBack: true }; } });
  const task = context.autoSummarize();
  await Promise.resolve();
  context.state.currentCharacter = 'B';
  context.state.summary = 'B摘要';
  context.state.messages = [{ id: 'b1', role: 'user', content: 'B对话' }];
  context.state.summarising = false;
  release();
  await task;
  assert.equal(context.state.summary, 'B摘要');
  assert.deepEqual(context.state.messages.map(message => message.id), ['b1']);
  assert.equal(saves, 0);
});

test('summary save failure restores the base summary and every concurrent message', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const context = loadAutoSummarize(async () => {
    await gate;
    return { ok: true, async json() { return { choices: [{ message: { content: '不能提交' } }] }; } };
  }, { saveCurrentCharacter() { return { ok: false, rolledBack: true }; } });
  const task = context.autoSummarize();
  await Promise.resolve();
  context.state.messages.push({ id: 'new-during-failed-summary', role: 'assistant', content: '保留我' });
  const before = JSON.stringify(context.state.messages);
  release();
  await task;
  assert.equal(context.state.summary, '旧摘要：主角已经与阿宁结盟。');
  assert.equal(JSON.stringify(context.state.messages), before);
});
