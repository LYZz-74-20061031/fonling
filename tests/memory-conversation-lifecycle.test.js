const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function plain(value) { return JSON.parse(JSON.stringify(value)); }

function loadModel(context = {}) {
  const sandbox = { Date, Math, crypto: { randomUUID: () => 'fresh-assistant' }, ...context };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync('js/memory/memory-model.js', 'utf8'), sandbox);
  return sandbox;
}

function extractFunction(source, declaration) {
  const start = source.indexOf(declaration);
  assert.notEqual(start, -1, `${declaration} must exist`);
  const opening = source.indexOf('{', start);
  let depth = 0;
  for (let index = opening; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`Unclosed function: ${declaration}`);
}

function conversationState(Model) {
  return {
    messages: [
      { id: 'u1', role: 'user', content: '第一问' },
      { id: 'a1', role: 'assistant', content: '第一答' },
      { id: 'u2', role: 'user', content: '第二问' },
      { id: 'a2', role: 'assistant', content: '第二答' },
    ],
    summary: '旧摘要',
    memories: [{ id: 'formal', type: 'key_info', content: '正式记忆', sourceMessageIds: ['a2'] }],
    currentScene: Model.normalizeScene({ location: '北门' }),
    memoryCandidates: [
      { id: 'removed-only', sourceMessageIds: ['a2'] },
      { id: 'mixed', sourceMessageIds: ['a1', 'a2'] },
      { id: 'unsourced', sourceMessageIds: [] },
    ],
    memoryAnalysis: {
      analyzedTurnKeys: ['u1|a1', 'u2|a2'],
      lastFailure: { message: 'retry later' },
      activeCharacter: '阿宁',
    },
    memoryRequestTraces: { a1: { used: ['formal'] }, a2: { used: ['formal'] } },
  };
}

test('clear helper removes all conversation artifacts without mutating formal memory or scene', () => {
  const sandbox = loadModel();
  const state = conversationState(sandbox.FonlingMemory.Model);
  const before = plain(state);
  const result = sandbox.FonlingMemory.Model.clearConversationMemoryArtifacts(state);

  assert.deepEqual(plain(result.messages), []);
  assert.equal(result.summary, '');
  assert.deepEqual(plain(result.memoryCandidates), []);
  assert.deepEqual(plain(result.memoryAnalysis), { analyzedTurnKeys: [], lastFailure: null, activeCharacter: null });
  assert.deepEqual(plain(result.memoryRequestTraces), {});
  assert.equal(result.memories, state.memories);
  assert.equal(result.currentScene, state.currentScene);
  assert.deepEqual(plain(state), before);
});

test('retained-message helper removes only derived artifacts that no longer have a retained source', () => {
  const sandbox = loadModel();
  const state = conversationState(sandbox.FonlingMemory.Model);
  const before = plain(state);
  const result = sandbox.FonlingMemory.Model.removeArtifactsAfterMessageIds(state, ['u1', 'a1', 'u2']);

  assert.deepEqual(result.memoryCandidates.map(item => item.id), ['mixed', 'unsourced']);
  assert.deepEqual(result.memoryAnalysis.analyzedTurnKeys, ['u1|a1']);
  assert.deepEqual(Object.keys(result.memoryRequestTraces), ['a1']);
  assert.deepEqual(result.memoryAnalysis.lastFailure, state.memoryAnalysis.lastFailure);
  assert.equal(result.memories, state.memories);
  assert.equal(result.currentScene, state.currentScene);
  assert.deepEqual(plain(state), before);
});

test('retained-message cleanup parses the controller turn key and legacy turn keys', () => {
  const sandbox = loadModel();
  vm.runInContext(fs.readFileSync('js/memory/memory-controller.js', 'utf8'), sandbox);
  const controller = sandbox.FonlingMemory.Controller.createMemoryController({
    getState: () => ({}), getCharacterName: () => '阿宁', save: () => ({ ok: true }), ui: { render() {} },
  });
  const controllerKey = controller.getTurnKey('u1', 'a1');
  assert.equal(controllerKey, 'u1::a1');
  const result = sandbox.FonlingMemory.Model.removeArtifactsAfterMessageIds({
    memoryCandidates: [], memoryRequestTraces: {},
    memoryAnalysis: { analyzedTurnKeys: [controllerKey, 'u2|a2', 'opaque'] },
  }, ['u1', 'a1']);
  assert.deepEqual(Array.from(result.memoryAnalysis.analyzedTurnKeys), [controllerKey, 'opaque']);
  const afterBacktrack = sandbox.FonlingMemory.Model.removeArtifactsAfterMessageIds({
    memoryCandidates: [], memoryRequestTraces: {},
    memoryAnalysis: { analyzedTurnKeys: [controllerKey, 'u2|a2', 'opaque'] },
  }, ['u1']);
  assert.deepEqual(Array.from(afterBacktrack.memoryAnalysis.analyzedTurnKeys), ['opaque']);
});

function lifecycleHarness(options = {}) {
  const html = fs.readFileSync('index.html', 'utf8');
  let saveCount = 0;
  let fetchCount = 0;
  let renderCount = 0;
  let syncCount = 0;
  const warnings = [];
  const sandbox = loadModel({
    confirm: () => true,
    sendBtn: { disabled: false },
    DEEPSEEK_API: 'https://example.test', MODEL: 'test-model',
    buildApiMessages: () => ({
      messages: [],
      memoryTrace: { pinnedMemoryIds: [], relatedMemoryIds: [], sceneUpdatedAt: '', usedSummary: true },
    }),
    updateStreamingBubble() {}, finishStreamingBubble() {}, addSystemMsg() {},
    renderMessages() { renderCount += 1; },
    saveCurrentCharacter() { saveCount += 1; return options.saveResult || { ok: true, rolledBack: true }; },
    async fetch() { fetchCount += 1; return { ok: options.responseOk !== false, status: 503, body: {} }; },
    async readSseContent(_body, onChunk) { onChunk('新回答', '新回答'); return '新回答'; },
    createModelRequestPlan(_task, requestOptions) { const tier = requestOptions && requestOptions.tier === 'air' ? 'air' : 'free'; return { task: 'chat', provider: 'glm', model: tier === 'air' ? 'glm-4.5-air' : 'test-model', tier, apiKey: 'test-key' }; },
    async requestModel(plan, messages, onDelta) {
      const response = await sandbox.fetch('https://example.test', { body: JSON.stringify({ messages }) });
      if (!response.ok) throw new Error(`request failed (${response.status})`);
      const content = await sandbox.readSseContent(response.body, typeof onDelta === 'function' ? onDelta : function() {});
      return { content, attempts: 1, plan };
    },
    modelSession: {
      snapshot() { return { armed: false, busy: false, activeTier: 'free' }; },
      beginSend() { return { id: 'send', tier: 'free' }; },
      beginAirRegenerate() { return { id: 'regenerate', tier: 'air' }; },
      finish() { return true; },
    },
    modelSessionApi: {
      createGenerationMetadata(plan, method) { return { provider: plan.provider, model: plan.model, tier: plan.tier, method, generatedAt: 'now' }; },
    },
    memoryUI: { showStorageWarning(message) { warnings.push(message); } },
    memoryController: { sync() { syncCount += 1; } },
    conversationRequestEpoch: 0,
  });
  sandbox.state = conversationState(sandbox.FonlingMemory.Model);
  sandbox.state.isStreaming = false;
  vm.runInContext(extractFunction(html, 'function captureConversationState()'), sandbox);
  vm.runInContext(extractFunction(html, 'function applyConversationState(next)'), sandbox);
  vm.runInContext(extractFunction(html, 'function conversationStateForMessages(messages, summary)'), sandbox);
  vm.runInContext(extractFunction(html, 'function recordMemoryRequestTrace(existingTraces, assistantMessageId, trace, messages)'), sandbox);
  vm.runInContext(extractFunction(html, 'function reportSaveFailure(result, fallback)'), sandbox);
  vm.runInContext(extractFunction(html, 'function beginConversationRequest()'), sandbox);
  vm.runInContext(extractFunction(html, 'function conversationRequestIsCurrent(request)'), sandbox);
  vm.runInContext(extractFunction(html, 'function finishConversationRequest(request, focusInput)'), sandbox);
  vm.runInContext(extractFunction(html, 'function backtrackMessage(idx)'), sandbox);
  vm.runInContext(extractFunction(html, 'async function regenerateMessage()'), sandbox);
  return {
    sandbox,
    get counts() { return { saveCount, fetchCount, renderCount, syncCount, warningCount: warnings.length }; },
  };
}

test('backtrack cleans derived artifacts and preserves formal data', () => {
  const app = lifecycleHarness();
  const formal = app.sandbox.state.memories;
  const scene = app.sandbox.state.currentScene;

  app.sandbox.backtrackMessage(2);

  assert.deepEqual(app.sandbox.state.messages.map(item => item.id), ['u1', 'a1', 'u2']);
  assert.equal(app.sandbox.state.summary, '旧摘要');
  assert.deepEqual(app.sandbox.state.memoryCandidates.map(item => item.id), ['mixed', 'unsourced']);
  assert.deepEqual(app.sandbox.state.memoryAnalysis.analyzedTurnKeys, ['u1|a1']);
  assert.deepEqual(Object.keys(app.sandbox.state.memoryRequestTraces), ['a1']);
  assert.equal(app.sandbox.state.memories, formal);
  assert.equal(app.sandbox.state.currentScene, scene);
  assert.equal(app.counts.saveCount, 1);
});

test('backtrack restores every conversation branch when persistence fails', () => {
  const app = lifecycleHarness({ saveResult: { ok: false, rolledBack: true } });
  const before = plain(app.sandbox.state);

  app.sandbox.backtrackMessage(2);

  assert.deepEqual(plain(app.sandbox.state), before);
  assert.equal(app.sandbox.state.summary, '旧摘要');
  assert.deepEqual(app.counts, { saveCount: 1, fetchCount: 0, renderCount: 0, syncCount: 1, warningCount: 1 });
});

test('regenerate cleans old response artifacts and persists one newly identified assistant message', async () => {
  const app = lifecycleHarness();

  await app.sandbox.regenerateMessage();

  assert.deepEqual(app.sandbox.state.messages.slice(0, -1).map(item => item.id), ['u1', 'a1', 'u2']);
  const assistant = app.sandbox.state.messages.at(-1);
  assert.equal(assistant.role, 'assistant');
  assert.equal(assistant.content, '新回答');
  assert.equal(assistant.id, 'message_fresh-assistant');
  assert.notEqual(assistant.id, 'a2');
  assert.deepEqual(app.sandbox.state.memoryCandidates.map(item => item.id), ['mixed', 'unsourced']);
  assert.deepEqual(app.sandbox.state.memoryAnalysis.analyzedTurnKeys, ['u1|a1']);
  assert.deepEqual(Object.keys(app.sandbox.state.memoryRequestTraces), ['a1', 'message_fresh-assistant']);
  assert.equal(app.sandbox.state.memoryRequestTraces['message_fresh-assistant'].usedSummary, true);
  assert.equal(app.counts.saveCount, 1);
  assert.equal(app.counts.fetchCount, 1);
});

test('regenerate rolls back and never requests a reply when the atomic save cannot succeed', async () => {
  const app = lifecycleHarness({ saveResult: { ok: false, rolledBack: true } });
  const before = plain(app.sandbox.state);

  await app.sandbox.regenerateMessage();

  assert.deepEqual(plain(app.sandbox.state), before);
  assert.equal(app.sandbox.state.isStreaming, false);
  assert.equal(app.sandbox.sendBtn.disabled, false);
  assert.equal(app.counts.saveCount, 1);
  assert.equal(app.counts.fetchCount, 1);
  assert.equal(app.counts.syncCount, 1);
  assert.equal(app.counts.warningCount, 1);
});

test('regenerate restores the prior response when the API request fails', async () => {
  const app = lifecycleHarness({ responseOk: false });
  const before = plain(app.sandbox.state);

  await app.sandbox.regenerateMessage();

  assert.deepEqual(plain(app.sandbox.state), before);
  assert.equal(app.sandbox.state.isStreaming, false);
  assert.equal(app.sandbox.sendBtn.disabled, false);
  assert.equal(app.counts.fetchCount, 1);
  assert.equal(app.counts.saveCount, 0);
});
