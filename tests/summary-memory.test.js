const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadAutoSummarize(fetchImpl) {
  const html = fs.readFileSync('index.html', 'utf8');
  const fn = html.match(/async function autoSummarize\(\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(fn, 'autoSummarize must exist in index.html');

  const state = {
    apiKey: 'test-key',
    summary: '旧摘要：主角已经与阿宁结盟。',
    messages: Array.from({ length: 31 }, (_, index) => ({
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
    document: { createElement() { return note; } },
    chatArea: { appendChild() {} },
    scrollToBottom() {},
    saveCurrentCharacter() {},
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
