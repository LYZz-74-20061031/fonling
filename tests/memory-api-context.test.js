const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');

function extractFunction(name) {
  const pattern = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const match = pattern.exec(html);
  assert.ok(match, `${name} must exist`);
  const start = match.index;
  const braceStart = html.indexOf('{', start);
  let depth = 0;
  for (let index = braceStart; index < html.length; index += 1) {
    if (html[index] === '{') depth += 1;
    if (html[index] === '}') depth -= 1;
    if (depth === 0) return html.slice(start, index + 1);
  }
  throw new Error(`unterminated function ${name}`);
}

function optionalFunction(name) {
  return new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).test(html) ? extractFunction(name) : '';
}

function baseScene(overrides) {
  return {
    time: '', location: '', presentCharacters: [], currentGoal: '', currentConflict: '',
    characterStates: '', environment: '', notes: '', updatedAt: '',
    ...overrides,
  };
}

function loadBuildApiMessages(overrides) {
  const sandbox = { console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync('js/memory/memory-context.js', 'utf8'), sandbox);
  Object.assign(sandbox, {
    RECENT_KEEP: 14,
    state: {
      systemPrompt: '世界规则',
      userIdentity: '旅人',
      currentRole: null,
      style: '克制叙述',
      summary: '此前众人已经结盟',
      messages: [
        { id: 'u1', role: 'user', content: '我们去钟楼找银钥匙' },
        { id: 'a_placeholder', role: 'assistant', content: '', _streaming: true },
      ],
      currentScene: baseScene({
        time: '深夜', location: '旧城', presentCharacters: ['阿宁'],
        updatedAt: '2026-08-14T00:00:00.000Z',
      }),
      memories: [
        { id: 'pinned', type: 'key_info', content: '阿宁不会说谎', status: 'active', pinned: true, updatedAt: '2026-08-10T00:00:00.000Z' },
        { id: 'key', type: 'key_info', content: '银钥匙藏在钟楼', status: 'active', pinned: false, updatedAt: '2026-08-11T00:00:00.000Z' },
        { id: 'history', type: 'history_event', content: '众人在旧城结盟', status: 'active', pinned: false, updatedAt: '2026-08-12T00:00:00.000Z' },
        { id: 'inactive', type: 'key_info', content: '银钥匙已经损坏', status: 'invalidated', pinned: false, updatedAt: '2026-08-13T00:00:00.000Z' },
      ],
      ...(overrides || {}),
    },
    getRoleSystemMsg() { return '当前身份：阿宁'; },
  });
  vm.runInContext(`${extractFunction('buildApiMessages')}; this.buildApiMessages = buildApiMessages;`, sandbox);
  return sandbox;
}

test('builds API messages in the exact persona, identity, style, memory, summary, raw order', () => {
  const sandbox = loadBuildApiMessages();
  const built = sandbox.buildApiMessages();
  const contents = Array.from(built.messages, message => message.content);

  assert.equal(contents[0], '世界规则');
  assert.match(contents[1], /^用户身份：旅人$/);
  assert.match(contents[2], /^回复时请遵循以下风格要求：克制叙述$/);
  assert.match(contents[3], /^当前场景：/);
  assert.match(contents[4], /^固定记忆：/);
  assert.match(contents[5], /^相关关键信息：/);
  assert.match(contents[6], /^相关及近期历史事件：/);
  assert.match(contents[7], /^以下是之前的对话摘要/);
  assert.equal(contents[8], '我们去钟楼找银钥匙');
  assert.equal(contents.includes(''), false, 'empty assistant placeholders must not reach the API');
  assert.equal(contents.some(content => content.includes('银钥匙已经损坏')), false);
  assert.equal(built.memoryTrace.usedSummary, true);
  assert.deepEqual(Array.from(built.memoryTrace.pinnedMemoryIds), ['pinned']);
});

test('uses the selected role instead of user identity and honors an explicit userText', () => {
  const sandbox = loadBuildApiMessages({
    currentRole: '阿宁',
    messages: [{ id: 'u1', role: 'user', content: '保持安静' }],
  });
  const built = sandbox.buildApiMessages({ userText: '只问旧城' });
  assert.equal(built.messages[1].content, '当前身份：阿宁');
  assert.equal(built.memoryTrace.relatedMemoryIds.includes('key'), false);
});

function loadRequestHarness(options) {
  const config = options || {};
  const ids = (config.ids || ['message_user_new', 'message_assistant_new']).slice();
  const state = config.state || {
    apiKey: 'test-key', currentCharacter: '测试角色', currentRole: null,
    messages: [], summary: '摘要', memoryCandidates: [],
    memoryAnalysis: { analyzedTurnKeys: [], lastFailure: null, activeCharacter: null },
    memoryRequestTraces: {}, isStreaming: false,
  };
  const requests = [];
  const buildCalls = [];
  const storageWarnings = [];
  const systemMessages = [];
  const sandbox = {
    console,
    state,
    messageInput: { value: config.inputText || '继续故事', style: {}, focus() {} },
    sendBtn: { disabled: false },
    MAX_MSG_BEFORE_SUMMARY: Object.hasOwn(config, 'maxMessagesBeforeSummary')
      ? config.maxMessagesBeforeSummary
      : 30,
    DEEPSEEK_API: 'https://example.test/chat',
    MODEL: 'test-model',
    FonlingMemory: {
      Model: {
        createId() { return ids.shift() || `generated_${Date.now()}`; },
        ensureMessageIds(messages) {
          messages.forEach(message => { if (!message.id) message.id = ids.shift() || `assigned_${Math.random()}`; });
          return messages;
        },
        removeArtifactsAfterMessageIds(snapshot, retainedIds) {
          const retained = new Set(retainedIds);
          const traces = {};
          Object.keys(snapshot.memoryRequestTraces || {}).forEach(id => { if (retained.has(id)) traces[id] = snapshot.memoryRequestTraces[id]; });
          return { ...snapshot, memoryRequestTraces: traces };
        },
      },
    },
    buildApiMessages(buildOptions) {
      buildCalls.push(buildOptions);
      if (config.buildError) {
        const error = new Error('context rejected');
        error.code = config.buildError;
        throw error;
      }
      return {
        messages: [{ role: 'user', content: buildOptions.userText }],
        memoryTrace: { pinnedMemoryIds: ['p1'], relatedMemoryIds: ['r1'], sceneUpdatedAt: 'scene-time', usedSummary: true },
      };
    },
    async fetch(_url, request) {
      requests.push(JSON.parse(request.body));
      if (config.fetchGate) await config.fetchGate;
      if (config.throwFetch) throw new Error('network');
      return { ok: config.responseOk !== false, status: 500, body: {} };
    },
    async readSseContent(_body, onDelta) {
      if (config.throwNetwork) throw new Error('network');
      const content = Object.hasOwn(config, 'sseContent') ? config.sseContent : '完成';
      if (content) onDelta(content, content);
      return content;
    },
    createModelRequestPlan(_task, options) {
      const tier = options && options.tier === 'air' ? 'air' : 'free';
      return { task: 'chat', provider: 'glm', model: tier === 'air' ? 'glm-4.5-air' : 'test-model', tier, apiKey: 'test-key' };
    },
    async requestModel(plan, messages, onDelta) {
      const response = await sandbox.fetch('https://example.test/chat', {
        body: JSON.stringify({ model: plan.model, messages, stream: true, max_tokens: 4096 }),
      });
      if (!response.ok) throw new Error(`request failed (${response.status})`);
      const content = await sandbox.readSseContent(response.body, typeof onDelta === 'function' ? onDelta : function() {});
      return { content, attempts: 1, plan };
    },
    modelSession: {
      snapshot() { return { armed: false, busy: false, activeTier: 'free' }; },
      beginSend() { return { id: 'send', tier: 'free', method: 'send' }; },
      beginAirRegenerate() { return { id: 'regenerate', tier: 'air', method: 'regenerate' }; },
      finish() { return true; },
    },
    modelSessionApi: {
      createGenerationMetadata(plan, method) { return { provider: plan.provider, model: plan.model, tier: plan.tier, method, generatedAt: '2026-08-23T00:00:00.000Z' }; },
    },
    saveCurrentCharacter() {
      const index = sandbox.saveCount++;
      if (config.throwSaveAt === index) throw new Error('storage');
      if (config.failSaveAt === index) {
        return { ok: false, rolledBack: config.saveRollbackFailed !== true, quotaExceeded: config.quotaExceeded === true };
      }
      return { ok: true, rolledBack: true };
    },
    saveCount: 0,
    renderMessages() {
      const index = sandbox.renderCount++;
      if (config.throwRenderAt === index) throw new Error('render failed');
    },
    renderCount: 0,
    updateStreamingBubble() {}, finishStreamingBubble() {},
    addSystemMsg(message) { systemMessages.push(message); },
    autoSummarize() {
      sandbox.autoSummarizeCount += 1;
      if (config.throwAutoSummarize) throw new Error('summary scheduling failed');
      if (config.rejectAutoSummarize) return Promise.reject(new Error('summary processing failed'));
      return Promise.resolve();
    },
    autoSummarizeCount: 0,
    memoryUI: { showStorageWarning(message) { storageWarnings.push(message); } },
    memoryController: {
      sync() {
        sandbox.syncCount += 1;
        if (config.throwSync) throw new Error('sync failed');
      },
    },
    syncCount: 0,
    conversationRequestEpoch: 0,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const names = [
    'beginConversationRequest', 'conversationRequestIsCurrent', 'finishConversationRequest',
    'captureConversationState', 'applyConversationState', 'conversationStateForMessages',
    'recordMemoryRequestTrace', 'persistFailedSend', 'sendMessage', 'regenerateMessage',
  ];
  const functions = [optionalFunction('reportSaveFailure'), ...names.map(extractFunction)].join('\n');
  vm.runInContext(`${functions}; this.sendMessage = sendMessage; this.regenerateMessage = regenerateMessage; this.recordMemoryRequestTrace = recordMemoryRequestTrace;`, sandbox);
  return { sandbox, state, requests, buildCalls, storageWarnings, systemMessages };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('quota during the final assistant save reaches the blocking backup warning as structured details', async () => {
  const harness = loadRequestHarness({ failSaveAt: 0, quotaExceeded: true });
  await harness.sandbox.sendMessage();
  assert.equal(harness.storageWarnings.length, 1);
  assert.equal(harness.storageWarnings[0].quotaExceeded, true);
  assert.equal(harness.storageWarnings[0].message, '存储空间不足，请立即导出备份');
});

test('quota while preserving the user after HTTP or network failure is never reduced to a string', async t => {
  for (const scenario of [{ responseOk: false }, { throwFetch: true }]) {
    await t.test(Object.keys(scenario)[0], async () => {
      const harness = loadRequestHarness({ ...scenario, failSaveAt: 0, quotaExceeded: true });
      await harness.sandbox.sendMessage();
      assert.equal(harness.storageWarnings.length, 1);
      assert.equal(harness.storageWarnings[0].quotaExceeded, true);
      assert.equal(harness.storageWarnings[0].message, '存储空间不足，请立即导出备份');
    });
  }
});

test('late send completion cannot mutate or save a newly forced character snapshot', async t => {
  for (const scenario of [
    { name: 'success' },
    { name: 'http failure', responseOk: false },
    { name: 'network failure', throwFetch: true },
    { name: 'configured save failure', failSaveAt: 0 },
  ]) {
    await t.test(scenario.name, async () => {
      const gate = deferred();
      const state = {
        apiKey: 'test-key', currentCharacter: 'A', currentRole: null,
        messages: [], summary: '', memoryCandidates: [], memoryAnalysis: {}, memoryRequestTraces: {}, isStreaming: false,
      };
      const harness = loadRequestHarness({ ...scenario, state, fetchGate: gate.promise });
      const task = harness.sandbox.sendMessage();
      await Promise.resolve();
      state.currentCharacter = 'B';
      state.messages = [{ id: 'b1', role: 'user', content: 'B独立对话' }];
      state.summary = 'B摘要';
      state.memoryRequestTraces = {};
      gate.resolve();
      await task;
      assert.deepEqual(state.messages, [{ id: 'b1', role: 'user', content: 'B独立对话' }]);
      assert.equal(state.summary, 'B摘要');
      assert.equal(harness.sandbox.saveCount, 0);
    });
  }
});

test('late regenerate completion cannot pop or save a newly forced character snapshot', async () => {
  const gate = deferred();
  const state = {
    apiKey: 'test-key', currentCharacter: 'A', currentRole: null,
    messages: [{ id: 'uA', role: 'user', content: 'A问题' }, { id: 'aA', role: 'assistant', content: 'A回答' }],
    summary: '', memoryCandidates: [], memoryAnalysis: {}, memoryRequestTraces: {}, isStreaming: false,
  };
  const harness = loadRequestHarness({ state, fetchGate: gate.promise, ids: ['aA-new'] });
  const task = harness.sandbox.regenerateMessage();
  await Promise.resolve();
  state.currentCharacter = 'B';
  state.messages = [{ id: 'b1', role: 'assistant', content: 'B回答' }];
  state.summary = 'B摘要';
  gate.resolve();
  await task;
  assert.deepEqual(state.messages, [{ id: 'b1', role: 'assistant', content: 'B回答' }]);
  assert.equal(state.summary, 'B摘要');
  assert.equal(harness.sandbox.saveCount, 0);
});

function stateWithConversationArtifacts() {
  return {
    apiKey: 'test-key', currentCharacter: '测试角色', currentRole: null,
    messages: [
      { id: 'u_existing', role: 'user', content: '旧问题' },
      { id: 'a_existing', role: 'assistant', content: '旧回答' },
    ],
    summary: '旧摘要',
    memoryCandidates: [{ id: 'candidate_existing', sourceMessageIds: ['a_existing'] }],
    memoryAnalysis: {
      analyzedTurnKeys: ['u_existing|a_existing'],
      lastFailure: { message: '旧分析失败' },
      activeCharacter: '阿宁',
    },
    memoryRequestTraces: { a_existing: { relatedMemoryIds: ['memory_existing'] } },
    isStreaming: false,
  };
}

test('successful send assigns stable IDs, omits the placeholder, and records the trace after success', async () => {
  const harness = loadRequestHarness();
  await harness.sandbox.sendMessage();

  assert.deepEqual(harness.state.messages.map(message => message.id), ['message_user_new', 'message_assistant_new']);
  assert.equal(harness.requests.length, 1);
  assert.equal(harness.requests[0].messages.some(message => !message.content), false);
  assert.equal(harness.buildCalls.length, 1);
  assert.equal(harness.buildCalls[0].userText, '继续故事');
  assert.ok(harness.state.memoryRequestTraces.message_assistant_new);
  assert.equal(harness.state.memoryRequestTraces.message_assistant_new.usedSummary, true);
});

test('send keeps the committed reply when post-save message rendering fails', async () => {
  const harness = loadRequestHarness({ throwRenderAt: 1 });

  await assert.doesNotReject(harness.sandbox.sendMessage());

  assert.deepEqual(harness.state.messages.map(message => message.id), ['message_user_new', 'message_assistant_new']);
  assert.equal(harness.state.messages.at(-1).content, '完成');
  assert.deepEqual(Object.keys(harness.state.memoryRequestTraces), ['message_assistant_new']);
  assert.equal(harness.sandbox.saveCount, 1);
  assert.deepEqual(harness.systemMessages, ['回复已保存但界面或后处理失败，请重新打开页面']);
  assert.equal(harness.systemMessages.some(message => /网络错误/.test(message)), false);
});

test('send keeps the committed reply when post-save summary scheduling throws', async () => {
  const harness = loadRequestHarness({ maxMessagesBeforeSummary: 0, throwAutoSummarize: true });

  await assert.doesNotReject(harness.sandbox.sendMessage());

  assert.deepEqual(harness.state.messages.map(message => message.id), ['message_user_new', 'message_assistant_new']);
  assert.equal(harness.state.messages.at(-1).content, '完成');
  assert.deepEqual(Object.keys(harness.state.memoryRequestTraces), ['message_assistant_new']);
  assert.equal(harness.sandbox.saveCount, 1);
  assert.equal(harness.sandbox.autoSummarizeCount, 1);
  assert.deepEqual(harness.systemMessages, ['回复已保存但界面或后处理失败，请重新打开页面']);
  assert.equal(harness.systemMessages.some(message => /网络错误/.test(message)), false);
});

test('send keeps the committed reply and reports an asynchronous post-save summary failure', async () => {
  const harness = loadRequestHarness({ maxMessagesBeforeSummary: 0, rejectAutoSummarize: true });

  await harness.sandbox.sendMessage();
  await Promise.resolve();

  assert.deepEqual(harness.state.messages.map(message => message.id), ['message_user_new', 'message_assistant_new']);
  assert.deepEqual(Object.keys(harness.state.memoryRequestTraces), ['message_assistant_new']);
  assert.equal(harness.sandbox.saveCount, 1);
  assert.deepEqual(harness.systemMessages, ['回复已保存但界面或后处理失败，请重新打开页面']);
});

test('failed send never records a trace and removes only the assistant placeholder', async () => {
  const harness = loadRequestHarness({ responseOk: false });
  await harness.sandbox.sendMessage();
  assert.deepEqual(harness.state.messages.map(message => message.role), ['user']);
  assert.deepEqual(harness.state.memoryRequestTraces, {});
});

test('HTTP failure restores the complete pre-send conversation when preserving the user message cannot be saved', async () => {
  const state = stateWithConversationArtifacts();
  const before = structuredClone(state);
  const harness = loadRequestHarness({ state, responseOk: false, failSaveAt: 0 });

  await harness.sandbox.sendMessage();

  assert.deepEqual(state, before);
  assert.equal(harness.sandbox.saveCount, 1);
  assert.equal(harness.storageWarnings.length, 1);
});

test('HTTP failure restores the complete pre-send conversation when the preservation save throws', async () => {
  const state = stateWithConversationArtifacts();
  const before = structuredClone(state);
  const harness = loadRequestHarness({ state, responseOk: false, throwSaveAt: 0 });

  await assert.doesNotReject(harness.sandbox.sendMessage());

  assert.deepEqual(state, before);
  assert.equal(harness.sandbox.saveCount, 1);
  assert.equal(harness.storageWarnings.length, 1);
});

test('network failure restores the complete pre-send conversation when preservation rollback is incomplete', async () => {
  const state = stateWithConversationArtifacts();
  const before = structuredClone(state);
  const harness = loadRequestHarness({ state, throwNetwork: true, failSaveAt: 0, saveRollbackFailed: true });

  await harness.sandbox.sendMessage();

  assert.deepEqual(state, before);
  assert.equal(harness.sandbox.saveCount, 1);
  assert.equal(harness.storageWarnings.length, 1);
  assert.match(harness.storageWarnings[0].message, /本地存储可能不完整/);
});

test('network failure restores the complete pre-send conversation when the preservation save throws', async () => {
  const state = stateWithConversationArtifacts();
  const before = structuredClone(state);
  const harness = loadRequestHarness({ state, throwFetch: true, throwSaveAt: 0 });

  await assert.doesNotReject(harness.sandbox.sendMessage());

  assert.deepEqual(state, before);
  assert.equal(harness.sandbox.saveCount, 1);
  assert.equal(harness.storageWarnings.length, 1);
});

test('blank SSE send is a failed reply: it keeps only the user message and never records a trace', async () => {
  const harness = loadRequestHarness({ sseContent: '   \n\t' });

  await harness.sandbox.sendMessage();

  assert.deepEqual(harness.state.messages.map(message => message.role), ['user']);
  assert.deepEqual(harness.state.memoryRequestTraces, {});
  assert.equal(harness.sandbox.saveCount, 1);
});

test('blank SSE send restores the complete pre-send conversation when preserving the user message cannot be saved', async () => {
  const state = stateWithConversationArtifacts();
  const before = structuredClone(state);
  const harness = loadRequestHarness({ state, sseContent: '', failSaveAt: 0 });

  await harness.sandbox.sendMessage();

  assert.deepEqual(state, before);
  assert.deepEqual(state.memoryRequestTraces, before.memoryRequestTraces);
  assert.equal(harness.storageWarnings.length, 1);
  assert.ok(harness.systemMessages.some(message => /有效回复|空白/.test(message)));
});

test('context budget rejection restores the pre-send state without leaving streaming stuck', async () => {
  const harness = loadRequestHarness({ buildError: 'PINNED_BUDGET_EXCEEDED' });
  await harness.sandbox.sendMessage();
  assert.deepEqual(harness.state.messages, []);
  assert.deepEqual(harness.state.memoryRequestTraces, {});
  assert.equal(harness.state.isStreaming, false);
  assert.equal(harness.sandbox.sendBtn.disabled, false);
  assert.equal(harness.requests.length, 0);
});

test('regenerate records the trace under the new assistant ID and removes the superseded trace', async () => {
  const harness = loadRequestHarness({
    ids: ['message_assistant_regenerated'],
    state: {
      apiKey: 'test-key', currentCharacter: '测试角色', currentRole: null,
      messages: [
        { id: 'u_old', role: 'user', content: '再试一次' },
        { id: 'a_old', role: 'assistant', content: '旧回答' },
      ],
      summary: '', memoryCandidates: [],
      memoryAnalysis: { analyzedTurnKeys: [], lastFailure: null, activeCharacter: null },
      memoryRequestTraces: { a_old: { relatedMemoryIds: ['old'] } }, isStreaming: false,
    },
  });
  await harness.sandbox.regenerateMessage();

  assert.deepEqual(harness.state.messages.map(message => message.id), ['u_old', 'message_assistant_regenerated']);
  assert.equal(Object.hasOwn(harness.state.memoryRequestTraces, 'a_old'), false);
  assert.ok(harness.state.memoryRequestTraces.message_assistant_regenerated);
});

test('blank SSE regenerate restores the old answer and every prior derived artifact without a new trace', async () => {
  const state = stateWithConversationArtifacts();
  const before = structuredClone(state);
  const harness = loadRequestHarness({
    ids: ['message_assistant_regenerated'],
    state,
    sseContent: '\n  \t',
  });

  await harness.sandbox.regenerateMessage();

  assert.deepEqual(state, before);
  assert.deepEqual(Object.keys(state.memoryRequestTraces), ['a_existing']);
  assert.equal(harness.sandbox.saveCount, 0);
});

test('regenerate keeps the committed reply when post-save message rendering fails', async () => {
  const state = stateWithConversationArtifacts();
  const harness = loadRequestHarness({
    ids: ['message_assistant_regenerated'],
    state,
    throwRenderAt: 0,
  });

  await assert.doesNotReject(harness.sandbox.regenerateMessage());

  assert.deepEqual(state.messages.map(message => message.id), ['u_existing', 'message_assistant_regenerated']);
  assert.equal(state.messages.at(-1).content, '完成');
  assert.deepEqual(Object.keys(state.memoryRequestTraces), ['message_assistant_regenerated']);
  assert.equal(harness.sandbox.saveCount, 1);
  assert.deepEqual(harness.systemMessages, ['回复已保存但界面刷新失败，请重新打开页面']);
  assert.equal(harness.systemMessages.some(message => /网络错误/.test(message)), false);
});

test('regenerate keeps the committed reply when post-save memory UI synchronization fails', async () => {
  const state = stateWithConversationArtifacts();
  const harness = loadRequestHarness({
    ids: ['message_assistant_regenerated'],
    state,
    throwSync: true,
  });

  await assert.doesNotReject(harness.sandbox.regenerateMessage());

  assert.deepEqual(state.messages.map(message => message.id), ['u_existing', 'message_assistant_regenerated']);
  assert.equal(state.messages.at(-1).content, '完成');
  assert.deepEqual(Object.keys(state.memoryRequestTraces), ['message_assistant_regenerated']);
  assert.equal(harness.sandbox.saveCount, 1);
  assert.equal(harness.sandbox.syncCount, 1);
  assert.deepEqual(harness.systemMessages, ['回复已保存但界面刷新失败，请重新打开页面']);
  assert.equal(harness.systemMessages.some(message => /网络错误/.test(message)), false);
});

test('keeps traces for only the newest fifty assistant messages', () => {
  const harness = loadRequestHarness();
  const messages = [];
  let traces = {};
  for (let index = 0; index < 51; index += 1) {
    const id = `a_${index}`;
    messages.push({ id, role: 'assistant', content: String(index) });
    traces = harness.sandbox.recordMemoryRequestTrace(traces, id, { usedSummary: false }, messages);
  }
  assert.equal(Object.keys(traces).length, 50);
  assert.equal(Object.hasOwn(traces, 'a_0'), false);
  assert.equal(Object.hasOwn(traces, 'a_50'), true);
});
