const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function extractFunction(name) {
  const match = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(html);
  assert.ok(match, `${name} must exist`);
  const start = match.index;
  const braceStart = html.indexOf('{', start);
  let depth = 0;
  for (let index = braceStart; index < html.length; index += 1) {
    if (html[index] === '{') depth += 1;
    else if (html[index] === '}') depth -= 1;
    if (depth === 0) return html.slice(start, index + 1);
  }
  throw new Error(`unterminated function ${name}`);
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function waitFor(predicate, message) {
  for (let index = 0; index < 30; index += 1) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.fail(message || 'condition was not reached');
}

function initialState() {
  return {
    currentCharacter: '阿宁', apiKey: 'sk-test', systemPrompt: '', style: '', userIdentity: '', bgImage: '',
    roles: [], currentRole: null, summary: '',
    messages: [
      { id: 'u-old', role: 'user', content: '我们继续前往旧港。' },
      { id: 'a-old', role: 'assistant', content: '阿宁离开城门，抵达了旧港。' },
    ],
    memories: [],
    currentScene: { time: '', location: '', presentCharacters: [], currentGoal: '', currentConflict: '', characterStates: '', environment: '', notes: '', updatedAt: '' },
    memoryCandidates: [],
    memoryAnalysis: { analyzedTurnKeys: [], lastFailure: null, activeCharacter: null },
    memoryRequestTraces: { 'a-old': { relatedMemoryIds: [] } },
    isStreaming: false,
  };
}

function createRaceHarness(options = {}) {
  const state = initialState();
  let stored = clone(state);
  const analysisCalls = [];
  const storyRequests = [];
  const storyResponse = deferred();
  const warnings = [];
  const systems = [];
  let storySaveCount = 0;

  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    AbortController,
    crypto: { randomUUID: (() => { let id = 0; return () => `uuid-${++id}`; })() },
    state,
    messageInput: { value: '', style: {}, focus() {} },
    sendBtn: { disabled: false },
    DEEPSEEK_API: 'https://story.test/chat',
    MODEL: 'story-model',
    buildApiMessages() { return { messages: [], memoryTrace: { pinnedMemoryIds: [], relatedMemoryIds: [], usedSummary: false } }; },
    fetch(_url, request) { storyRequests.push(request); return storyResponse.promise; },
    async readSseContent(body, onDelta) {
      const content = body && body.content ? body.content : '';
      if (content) onDelta(content, content);
      return content;
    },
    saveCurrentCharacter() {
      storySaveCount += 1;
      if (options.storySaveFails) return { ok: false, rolledBack: true };
      stored = clone(state);
      return { ok: true, rolledBack: true };
    },
    renderMessages() {}, updateStreamingBubble() {}, finishStreamingBubble() {},
    addSystemMsg(message) { systems.push(message); },
    memoryUI: { showStorageWarning(message) { warnings.push(message); } },
    conversationRequestEpoch: 0,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const file of ['memory-model.js', 'memory-analyzer.js', 'memory-controller.js']) {
    vm.runInContext(fs.readFileSync(`js/memory/${file}`, 'utf8'), sandbox, { filename: file });
  }

  function analysisFetch(_url, request) {
    const gate = deferred();
    analysisCalls.push({ gate, request });
    return gate.promise;
  }
  const ui = { render() {}, showStorageWarning(message) { warnings.push(message); }, showAnalysisFailure(message) { warnings.push(message); } };
  const controller = sandbox.FonlingMemory.Controller.createMemoryController({
    getState: () => state,
    save: () => ({ ok: true, rolledBack: true }),
    getCharacterName: () => state.currentCharacter,
    loadCharacterSnapshot: () => clone(stored),
    saveCharacterSnapshot(_name, snapshot) {
      stored = clone(snapshot);
      state.memoryCandidates = clone(snapshot.memoryCandidates || []);
      state.memoryAnalysis = clone(snapshot.memoryAnalysis || {});
      return { ok: true, rolledBack: true };
    },
    getAnalysisConfig: snapshot => ({
      apiUrl: 'https://analysis.test/chat', apiKey: snapshot.apiKey, model: 'analysis-model', fetchImpl: analysisFetch,
    }),
    ui,
    now: () => '2026-08-20T00:00:00.000Z',
  });
  sandbox.memoryController = controller;

  const names = [
    'beginConversationRequest', 'conversationRequestIsCurrent', 'finishConversationRequest', 'reportSaveFailure',
    'captureConversationState', 'applyConversationState', 'conversationStateForMessages',
    'recordMemoryRequestTrace', 'regenerateMessage',
  ];
  vm.runInContext(`${names.map(extractFunction).join('\n')}; this.regenerateMessage = regenerateMessage;`, sandbox);

  function resolveAnalysis(callIndex, assistantId, content) {
    const candidate = {
      operation: 'add', memoryType: 'history_event', content,
      sourceMessageIds: ['u-old', assistantId], reason: '剧情变化',
    };
    analysisCalls[callIndex].gate.resolve({
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({ shouldSuggest: true, candidates: [candidate] }) } }] }),
    });
  }

  return {
    sandbox, state, controller, analysisCalls, storyRequests, storyResponse, warnings, systems,
    get stored() { return stored; },
    get storySaveCount() { return storySaveCount; },
    resolveAnalysis,
  };
}

test('successful regenerate invalidates old in-flight analysis and only analyzes the new assistant', async () => {
  const harness = createRaceHarness();
  const oldWork = harness.controller.considerTurn({ characterName: '阿宁', userMessageId: 'u-old', assistantMessageId: 'a-old' });
  await waitFor(() => harness.analysisCalls.length === 1, 'old analysis did not start');

  const regenerate = harness.sandbox.regenerateMessage();
  await waitFor(() => harness.storyRequests.length === 1, 'regenerate request did not start');
  harness.resolveAnalysis(0, 'a-old', '旧回答产生的候选');
  assert.equal((await oldWork).skipped, 'STALE_ANALYSIS_EPOCH');
  assert.equal(harness.stored.memoryCandidates.length, 0);

  harness.storyResponse.resolve({ ok: true, body: { content: '阿宁离开旧港，抵达钟楼。' } });
  await regenerate;
  const newAssistantId = harness.state.messages.at(-1).id;
  await waitFor(() => harness.analysisCalls.length === 2, 'new assistant analysis did not start');
  harness.resolveAnalysis(1, newAssistantId, '阿宁离开旧港并抵达钟楼');
  await waitFor(() => harness.stored.memoryAnalysis.analyzedTurnKeys.length === 1, 'new analysis did not persist');

  assert.equal(JSON.stringify(harness.stored.messages), JSON.stringify(harness.state.messages));
  assert.equal(harness.stored.memoryCandidates.length, 1);
  assert.deepEqual(Array.from(harness.stored.memoryCandidates[0].sourceMessageIds), ['u-old', newAssistantId]);
  const messageIds = new Set(harness.stored.messages.map(message => message.id));
  assert.equal(harness.stored.memoryCandidates[0].sourceMessageIds.every(id => messageIds.has(id)), true);
});

test('failed regenerate cannot be overwritten by old analysis and the restored old turn remains retryable', async () => {
  const harness = createRaceHarness();
  const oldWork = harness.controller.considerTurn({ characterName: '阿宁', userMessageId: 'u-old', assistantMessageId: 'a-old' });
  await waitFor(() => harness.analysisCalls.length === 1);
  const regenerate = harness.sandbox.regenerateMessage();
  await waitFor(() => harness.storyRequests.length === 1);
  harness.resolveAnalysis(0, 'a-old', '不得提交的旧候选');
  assert.equal((await oldWork).skipped, 'STALE_ANALYSIS_EPOCH');
  harness.storyResponse.resolve({ ok: false, status: 500 });
  await regenerate;

  assert.deepEqual(harness.stored.messages, harness.state.messages);
  assert.equal(harness.stored.memoryCandidates.length, 0);
  const retry = harness.controller.considerTurn({ characterName: '阿宁', userMessageId: 'u-old', assistantMessageId: 'a-old' });
  await waitFor(() => harness.analysisCalls.length === 2);
  harness.resolveAnalysis(1, 'a-old', '重试后有效候选');
  await retry;
  assert.equal(harness.stored.memoryCandidates.length, 1);
  assert.deepEqual(harness.stored.memoryCandidates[0].sourceMessageIds, ['u-old', 'a-old']);
});

test('regenerate save failure restores storage and memory consistently without losing retryability', async () => {
  const harness = createRaceHarness({ storySaveFails: true });
  const oldWork = harness.controller.considerTurn({ characterName: '阿宁', userMessageId: 'u-old', assistantMessageId: 'a-old' });
  await waitFor(() => harness.analysisCalls.length === 1);
  const regenerate = harness.sandbox.regenerateMessage();
  await waitFor(() => harness.storyRequests.length === 1);
  harness.resolveAnalysis(0, 'a-old', '不得提交的旧候选');
  assert.equal((await oldWork).skipped, 'STALE_ANALYSIS_EPOCH');
  harness.storyResponse.resolve({ ok: true, body: { content: '未能保存的新回答' } });
  await regenerate;

  assert.deepEqual(harness.stored.messages, harness.state.messages);
  assert.deepEqual(harness.stored.memoryAnalysis, harness.state.memoryAnalysis);
  assert.deepEqual(harness.stored.memoryCandidates, harness.state.memoryCandidates);
  assert.equal(harness.stored.memoryCandidates.length, 0);
  const retry = harness.controller.considerTurn({ characterName: '阿宁', userMessageId: 'u-old', assistantMessageId: 'a-old' });
  await waitFor(() => harness.analysisCalls.length === 2);
  harness.resolveAnalysis(1, 'a-old', '保存失败后重试有效');
  await retry;
  assert.equal(harness.stored.memoryCandidates.length, 1);
});
