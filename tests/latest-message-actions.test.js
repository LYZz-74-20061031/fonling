const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');

function extractFunction(name) {
  const match = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(html);
  assert.ok(match, `${name} must exist`);
  const start = match.index;
  const opening = html.indexOf('{', start);
  let depth = 0;
  for (let index = opening; index < html.length; index += 1) {
    if (html[index] === '{') depth += 1;
    else if (html[index] === '}') {
      depth -= 1;
      if (depth === 0) return html.slice(start, index + 1);
    }
  }
  throw new Error(`Unclosed function: ${name}`);
}

function loadMemoryModel(sandbox) {
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync('js/memory/memory-model.js', 'utf8'), sandbox);
}

function createRegenerateHarness(options = {}) {
  const plans = [];
  const sessionCalls = [];
  let saveCount = 0;
  let confirmCount = 0;
  let syncCount = 0;
  const sandbox = {
    Date,
    Math,
    crypto: { randomUUID: () => 'replacement' },
    state: {
      currentCharacter: '阿宁',
      messages: [
        { id: 'u1', role: 'user', content: '继续前进' },
        { id: 'a1', role: 'assistant', content: '旧回答' },
        { id: 'u2', role: 'user', content: '打开石门' },
        { id: 'a2', role: 'assistant', content: '石门后出现守卫' },
      ],
      summary: '',
      memories: [],
      currentScene: {},
      memoryCandidates: [{ id: 'candidate-a2', sourceMessageIds: ['u2', 'a2'] }],
      memoryAnalysis: {
        analyzedTurnKeys: ['u1::a1', 'u2::a2'],
        lastFailure: { turnKey: 'u2::a2', message: '旧回答整理失败' },
        activeCharacter: '阿宁',
      },
      memoryRequestTraces: {
        a1: { pinnedMemoryIds: [], relatedMemoryIds: [], usedSummary: false },
        a2: { pinnedMemoryIds: [], relatedMemoryIds: [], usedSummary: false },
      },
      isStreaming: false,
    },
    sendBtn: { disabled: false },
    conversationRequestEpoch: 0,
    buildApiMessages: () => ({
      messages: [],
      memoryTrace: { pinnedMemoryIds: [], relatedMemoryIds: [], sceneUpdatedAt: '', usedSummary: false },
    }),
    createModelRequestPlan(task, options) {
      plans.push({ task, options: { ...(options || {}) } });
      const air = options && options.tier === 'air';
      return {
        task,
        provider: air ? 'glm' : (options && options.provider) || 'deepseek',
        tier: air ? 'air' : 'free',
        model: air ? 'glm-4.5-air' : 'glm-4.7-flash',
        apiKey: 'test-key',
      };
    },
    async requestModel(plan) {
      if (options.requestError) throw new Error('request failed');
      return { content: options.emptyReply ? '' : `新回答-${plan.tier}`, plan };
    },
    modelSession: {
      cancelPending() { sessionCalls.push('cancelPending'); return true; },
      beginSend() { sessionCalls.push('beginSend'); return { id: 'free', tier: 'free' }; },
      beginAirRegenerate() { sessionCalls.push('beginAirRegenerate'); return { id: 'air', tier: 'air' }; },
      finish() { sessionCalls.push('finish'); return true; },
    },
    modelSessionApi: {
      createGenerationMetadata(plan, method) {
        return { provider: plan.provider, model: plan.model, tier: plan.tier, method };
      },
    },
    memoryController: {
      invalidateAnalysis() {},
      considerTurn() {},
      sync() { syncCount += 1; },
    },
    saveCurrentCharacter() {
      saveCount += 1;
      return options.saveResult || { ok: true, rolledBack: true };
    },
    confirm() { confirmCount += 1; return true; },
    renderMessages() {},
    addSystemMsg() {},
    reportSaveFailure() {},
    updateModelStatusBar() {},
    clearTransientReasoning() {},
    renderRegenerationPreview() {},
    removeRegenerationPreview() {},
    reasoningUI: {
      begin() {},
      update() {},
      complete() {},
      remove() {},
    },
  };
  const persistedSnapshot = JSON.parse(JSON.stringify(sandbox.state));
  sandbox.loadCharacterSnapshotForAnalysis = () => JSON.parse(JSON.stringify(persistedSnapshot));
  loadMemoryModel(sandbox);
  for (const name of [
    'captureConversationState',
    'applyConversationState',
    'restoreConversationAfterSaveFailure',
    'conversationStateForMessages',
    'recordMemoryRequestTrace',
    'beginConversationRequest',
    'conversationRequestIsCurrent',
    'finishConversationRequest',
    'startEdit',
    'commitMessageEdit',
    'backtrackMessage',
    'regenerateMessage',
  ]) {
    vm.runInContext(extractFunction(name), sandbox);
  }
  return {
    sandbox,
    plans,
    sessionCalls,
    get saveCount() { return saveCount; },
    get confirmCount() { return confirmCount; },
    get syncCount() { return syncCount; },
  };
}

test('latest assistant actions replace backtrack with free and Air regeneration', () => {
  const render = extractFunction('renderMessages');
  const latestStart = render.indexOf('if (i === state.messages.length - 1)');
  const latestEnd = render.indexOf('if (state.memoryRequestTraces', latestStart);
  const latestBlock = render.slice(latestStart, latestEnd);
  const olderBlock = render.slice(
    render.indexOf('if (i < state.messages.length - 1)'),
    latestStart,
  );

  assert.match(olderBlock, /textContent\s*=\s*'回溯'/);
  assert.doesNotMatch(olderBlock, /重新回复|重新深度思考|编辑/);
  assert.match(latestBlock, /textContent\s*=\s*'编辑'/);
  assert.match(latestBlock, /textContent\s*=\s*'重新回复'/);
  assert.match(latestBlock, /regenerateMessage\('free'\)/);
  assert.match(latestBlock, /textContent\s*=\s*'重新深度思考'/);
  assert.match(latestBlock, /regenerateMessage\('air'\)/);
  assert.doesNotMatch(latestBlock, /textContent\s*=\s*'回溯'/);
});

test('message actions can wrap when four latest-reply buttons do not fit on mobile', () => {
  const rule = html.match(/\.msg-actions\{[^}]+\}/)?.[0] || '';
  assert.match(rule, /flex-wrap\s*:\s*wrap/);
});

test('backtracking re-renders the retained assistant as the latest message', () => {
  const backtrack = extractFunction('backtrackMessage');
  assert.match(backtrack, /state\.messages\.slice\(0, idx \+ 1\)/);
  assert.match(backtrack, /renderMessages\(\)/);
  assert.match(extractFunction('renderMessages'), /i === state\.messages\.length - 1/);
});

test('free regenerate explicitly forces GLM and uses the free session path', async () => {
  const harness = createRegenerateHarness();
  await harness.sandbox.regenerateMessage('free');

  assert.deepEqual(harness.plans[0], { task: 'chat', options: { provider: 'glm' } });
  assert.deepEqual(harness.sessionCalls.slice(0, 2), ['cancelPending', 'beginSend']);
  assert.deepEqual(harness.sandbox.state.messages.map(message => message.id), ['u1', 'a1', 'u2', 'message_replacement']);
  assert.deepEqual(harness.sandbox.state.memoryCandidates, []);
  assert.deepEqual(harness.sandbox.state.memoryAnalysis.analyzedTurnKeys, ['u1::a1']);
  assert.equal(harness.sandbox.state.memoryAnalysis.lastFailure, null);
  assert.equal(harness.sandbox.state.memoryAnalysis.activeCharacter, null);
  assert.deepEqual(Object.keys(harness.sandbox.state.memoryRequestTraces), ['a1', 'message_replacement']);
  assert.equal(harness.sandbox.state.messages.at(-1).generation.provider, 'glm');
  assert.equal(harness.sandbox.state.messages.at(-1).generation.tier, 'free');
});

test('Air regenerate remains explicitly paid and uses the Air session path', async () => {
  const harness = createRegenerateHarness();
  await harness.sandbox.regenerateMessage('air');

  assert.deepEqual(harness.plans[0], { task: 'chat', options: { tier: 'air' } });
  assert.equal(harness.sessionCalls[0], 'beginAirRegenerate');
  assert.equal(harness.sandbox.state.messages.at(-1).generation.tier, 'air');
});

test('backtrack is blocked while a reply replacement is in progress', () => {
  const harness = createRegenerateHarness();
  const before = JSON.parse(JSON.stringify(harness.sandbox.state));
  harness.sandbox.state.isStreaming = true;

  harness.sandbox.backtrackMessage(1);

  assert.deepEqual(JSON.parse(JSON.stringify(harness.sandbox.state)), { ...before, isStreaming: true });
  assert.equal(harness.confirmCount, 0);
  assert.equal(harness.saveCount, 0);
});

test('editing is blocked while a reply replacement is in progress', () => {
  const harness = createRegenerateHarness();
  const before = JSON.parse(JSON.stringify(harness.sandbox.state));
  harness.sandbox.state.isStreaming = true;

  assert.doesNotThrow(() => harness.sandbox.startEdit(3));
  assert.equal(harness.sandbox.commitMessageEdit(3, '不得覆盖'), false);

  assert.deepEqual(JSON.parse(JSON.stringify(harness.sandbox.state)), { ...before, isStreaming: true });
  assert.equal(harness.saveCount, 0);
});

test('free regenerate restores the complete prior conversation when saving fails', async () => {
  const harness = createRegenerateHarness({ saveResult: { ok: false, rolledBack: true } });
  const before = JSON.parse(JSON.stringify(harness.sandbox.state));

  await harness.sandbox.regenerateMessage('free');

  assert.deepEqual(JSON.parse(JSON.stringify(harness.sandbox.state)), before);
  assert.equal(harness.sandbox.state.isStreaming, false);
  assert.equal(harness.sandbox.sendBtn.disabled, false);
  assert.equal(harness.saveCount, 1);
  assert.equal(harness.syncCount, 1);
});

test('free regenerate keeps the original reply and artifacts when the request fails', async () => {
  const harness = createRegenerateHarness({ requestError: true });
  const before = JSON.parse(JSON.stringify(harness.sandbox.state));

  await harness.sandbox.regenerateMessage('free');

  assert.deepEqual(JSON.parse(JSON.stringify(harness.sandbox.state)), before);
  assert.equal(harness.sandbox.state.isStreaming, false);
  assert.equal(harness.sandbox.sendBtn.disabled, false);
  assert.equal(harness.saveCount, 0);
});

test('real gateway keeps free regenerate on GLM when DeepSeek is the global default', () => {
  const sandbox = { globalThis: null };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync('js/model/model-config.js', 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync('js/model/model-gateway.js', 'utf8'), sandbox);
  const config = sandbox.FonlingModels.Config.normalizeConfig({
    defaultProvider: 'deepseek',
    glmApiKey: 'glm-test',
    deepseekApiKey: 'deepseek-test',
  });

  const free = sandbox.FonlingModels.Gateway.createPlan({ task: 'chat', provider: 'glm', config });
  const air = sandbox.FonlingModels.Gateway.createPlan({ task: 'chat', tier: 'air', config });

  assert.deepEqual([free.provider, free.tier, free.model], ['glm', 'free', 'glm-4.7-flash']);
  assert.deepEqual([air.provider, air.tier, air.model], ['glm', 'air', 'glm-4.5-air']);
});

test('Air send and regenerate wire transient reasoning without persisting it in messages', () => {
  const send = extractFunction('sendMessage');
  const regenerate = extractFunction('regenerateMessage');
  const save = extractFunction('saveCurrentCharacter');
  assert.match(html, /js\/model\/reasoning-ui\.js/);
  assert.match(send, /reasoningUI\.begin/);
  assert.match(send, /reasoningUI\.update/);
  assert.match(send, /streamSnapshot\.content/);
  assert.match(regenerate, /reasoningUI\.begin/);
  assert.match(regenerate, /reasoningUI\.update/);
  assert.match(regenerate, /streamSnapshot\.content/);
  assert.doesNotMatch(save, /reasoning_content|reasoningText|_reasoning/);
});
