# Rolling Summary Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve all prior compressed conversation memory across repeated summarization cycles while keeping the rolling summary bounded to prevent token growth.

**Architecture:** Keep one consolidated rolling summary rather than appending summary segments. Each compression request will merge the existing `state.summary` with only the messages being retired, ask DeepSeek to rewrite them into one bounded summary, and continue using the existing `max_tokens: 1024` hard output limit.

**Tech Stack:** Single-file HTML/CSS/JavaScript application, browser Fetch API, DeepSeek Chat Completions API, Node.js built-in test runner.

## Global Constraints

- Preserve the current single-file application architecture in `index.html`.
- Do not add runtime dependencies or a build step.
- Keep at most 14 recent raw messages after successful compression.
- Keep the summary request output capped at 1024 tokens.
- Never append summaries indefinitely; rewrite one consolidated summary on each compression cycle.
- Do not delete raw messages unless the replacement summary request succeeds and returns non-empty content.

---

### Task 1: Add a regression test for rolling summary continuity

**Files:**
- Create: `tests/summary-memory.test.js`
- Test: `tests/summary-memory.test.js`

**Interfaces:**
- Consumes: `autoSummarize()` and its constants extracted from `index.html`.
- Produces: A regression test proving that the next summary request receives the previous summary and retains the 1024-token output ceiling.

- [ ] **Step 1: Write the failing test**

```js
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
  const note = { remove() {}, querySelector() { return { textContent: '' }; } };
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
    requestBody.messages.some(message => message.content.includes('旧摘要：主角已经与阿宁结盟。')),
    'the existing summary must be included in the consolidation request',
  );
  assert.equal(context.state.summary, '新的合并摘要');
  assert.equal(context.state.messages.length, 14);
});
```

- [ ] **Step 2: Run the test to verify it fails for the reported bug**

Run: `node --test tests/summary-memory.test.js`

Expected: FAIL at `the existing summary must be included in the consolidation request`; the test must still observe `max_tokens === 1024`.

---

### Task 2: Merge old memory into one bounded rolling summary

**Files:**
- Modify: `index.html:557-590`
- Test: `tests/summary-memory.test.js`

**Interfaces:**
- Consumes: `state.summary`, `toSummarize`, `MODEL`, and the existing DeepSeek request path.
- Produces: A single replacement summary in `state.summary`, capped by `max_tokens: 1024`, followed by retention of the latest `RECENT_KEEP` raw messages.

- [ ] **Step 1: Add the previous summary to the consolidation request**

Replace the summary prompt construction with:

```js
const summaryPrompt = [
  {
    role: 'system',
    content: '你是长期剧情记忆整理助手。请把已有长期摘要与新增对话合并重写为一份新的完整摘要。保留人物身份、关系变化、承诺、冲突、重要事件、时间线、用户偏好和未解决事项；合并重复内容，删除寒暄和无关细节。不要逐段追加旧摘要，必须重新压缩成一份连贯摘要。只输出摘要正文，不要解释。摘要必须控制在约 1000 tokens 以内。',
  },
];
if (state.summary) {
  summaryPrompt.push({ role: 'system', content: '已有长期摘要：\n' + state.summary });
}
summaryPrompt.push({ role: 'system', content: '以下是需要并入长期记忆的新增对话：' });
```

Keep the existing loop that appends `toSummarize`, and keep the API body output limit unchanged:

```js
body: JSON.stringify({ model: MODEL, messages: summaryPrompt, stream: false, max_tokens: 1024 }),
```

- [ ] **Step 2: Run the focused regression test**

Run: `node --test tests/summary-memory.test.js`

Expected: PASS; the captured request contains the previous summary, `max_tokens` remains exactly `1024`, the returned consolidated summary replaces `state.summary`, and 14 raw messages remain.

- [ ] **Step 3: Run a JavaScript syntax check against the embedded script**

Run:

```powershell
$html = Get-Content -Raw -Encoding UTF8 .\index.html
$script = [regex]::Match($html, '<script>([\s\S]*?)</script>').Groups[1].Value
$script | node --check -
```

Expected: exit code 0 with no syntax errors.

- [ ] **Step 4: Re-run all available tests**

Run: `node --test tests/*.test.js`

Expected: all tests pass with no failures or warnings.

- [ ] **Step 5: Commit the focused change if the directory is placed under Git later**

```bash
git add index.html tests/summary-memory.test.js docs/superpowers/plans/2026-08-03-rolling-summary-memory.md
git commit -m "fix: preserve bounded rolling chat summary"
```

The current workspace is not a Git repository, so this step is intentionally skipped unless Git is initialized outside this task.
