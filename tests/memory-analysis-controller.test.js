const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function loadMemory() {
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    crypto: { randomUUID: (() => { let id = 0; return () => `uuid-${++id}`; })() },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const file of ['memory-model.js', 'memory-analyzer.js', 'memory-controller.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, 'js', 'memory', file), 'utf8'), sandbox, { filename: file });
  }
  return sandbox.FonlingMemory;
}

function storySnapshot(name = '阿宁') {
  return {
    currentCharacter: name,
    apiKey: 'sk-test',
    messages: [
      { id: 'u1', role: 'user', content: '我们去旧港。' },
      { id: 'a1', role: 'assistant', content: '阿宁抵达旧港，陆衡随后离开。' },
    ],
    summary: '两人正在追查赤铜钥匙。',
    memories: [{ id: 'k1', type: 'key_info', status: 'active', pinned: false, content: '阿宁持有地图' }],
    currentScene: { time: '深夜', location: '城门', presentCharacters: ['阿宁'], currentGoal: '', currentConflict: '', characterStates: '', environment: '', notes: '', updatedAt: '' },
    memoryCandidates: [],
    memoryAnalysis: { analyzedTurnKeys: [], lastFailure: null, activeCharacter: null },
    memoryRequestTraces: {},
  };
}

function createHarness(overrides = {}) {
  const memory = loadMemory();
  const stores = new Map(Object.entries(overrides.stores || { '阿宁': storySnapshot('阿宁') }).map(([name, value]) => [name, clone(value)]));
  let activeCharacter = overrides.activeCharacter || '阿宁';
  const saves = [];
  const renders = [];
  const warnings = [];
  const analyzer = overrides.useRealAnalyzer ? memory.Analyzer : (overrides.analyzer || {
    shouldAnalyzeTurn(input) { return /抵达|离开/.test(input.assistantText); },
    async analyzeTurn() { return { ok: true, candidates: [] }; },
    deduplicateCandidates(input) { return input.candidates; },
  });
  const ui = {
    render(value) { renders.push(clone(value)); },
    showStorageWarning(message) { warnings.push(message); },
    showAnalysisFailure(message) { warnings.push(message); },
  };
  const controller = memory.Controller.createMemoryController({
    getState() { return stores.get(activeCharacter); },
    save() { return { ok: true, rolledBack: true }; },
    getCharacterName() { return activeCharacter; },
    loadCharacterSnapshot(name) { return clone(stores.get(name)); },
    saveCharacterSnapshot(name, snapshot) {
      saves.push({ name, snapshot: clone(snapshot) });
      if (overrides.saveResult && overrides.saveResult.ok !== true) return clone(overrides.saveResult);
      stores.set(name, clone(snapshot));
      return { ok: true, rolledBack: true };
    },
    getAnalysisConfig(snapshot) {
      if (typeof overrides.getAnalysisConfig === 'function') return overrides.getAnalysisConfig(snapshot);
      return { apiUrl: 'https://example.test/chat', apiKey: snapshot.apiKey, model: 'test-model', fetchImpl: async () => { throw new Error('not used'); } };
    },
    analyzer,
    ui,
    now: () => '2026-08-20T00:00:00.000Z',
  });
  return {
    memory, controller, stores, saves, renders, warnings,
    setActiveCharacter(name) { activeCharacter = name; },
  };
}

test('getTurnKey is stable and a greeting never starts analysis', async () => {
  let calls = 0;
  const snapshot = storySnapshot();
  snapshot.messages = [{ id: 'u0', role: 'user', content: '你好' }, { id: 'a0', role: 'assistant', content: '你好呀。' }];
  const harness = createHarness({
    stores: { '阿宁': snapshot },
    analyzer: {
      shouldAnalyzeTurn: () => false,
      async analyzeTurn() { calls += 1; return { ok: true, candidates: [] }; },
      deduplicateCandidates(input) { return input.candidates; },
    },
  });
  assert.equal(harness.controller.getTurnKey('u0', 'a0'), 'u0::a0');
  const result = await harness.controller.considerTurn({ characterName: '阿宁', userMessageId: 'u0', assistantMessageId: 'a0' });
  assert.equal(result.ok, true);
  assert.equal(result.skipped, 'TRIGGER_NOT_MET');
  assert.equal(calls, 0);
  assert.equal(harness.saves.length, 0);
});

test('a story-changing turn is analyzed once and a refresh does not repeat it', async () => {
  let calls = 0;
  const harness = createHarness({
    analyzer: {
      shouldAnalyzeTurn: () => true,
      async analyzeTurn() {
        calls += 1;
        return { ok: true, candidates: [{
          id: 'c1', operation: 'add', memoryType: 'history_event', content: '阿宁抵达旧港',
          sourceMessageIds: ['u1', 'a1'], status: 'pending', conflict: false, possibleConflict: false,
          createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z'
        }] };
      },
      deduplicateCandidates(input) { return input.candidates; },
    },
  });
  const turn = { characterName: '阿宁', userMessageId: 'u1', assistantMessageId: 'a1' };
  const first = await harness.controller.considerTurn(turn);
  const second = await harness.controller.considerTurn(turn);
  assert.equal(first.ok, true);
  assert.equal(second.skipped, 'ALREADY_ANALYZED');
  assert.equal(calls, 1);
  assert.deepEqual(Array.from(harness.stores.get('阿宁').memoryAnalysis.analyzedTurnKeys), ['u1::a1']);
  assert.equal(harness.stores.get('阿宁').memoryCandidates.length, 1);
});

test('failed analysis records a safe failure, remains retryable, and manual force bypasses trigger', async () => {
  let calls = 0;
  const harness = createHarness({
    analyzer: {
      shouldAnalyzeTurn: () => false,
      async analyzeTurn() {
        calls += 1;
        return calls === 1
          ? { ok: false, candidates: [], error: 'raw secret details must not leak' }
          : { ok: true, candidates: [] };
      },
      deduplicateCandidates(input) { return input.candidates; },
    },
  });
  const failed = await harness.controller.analyzeRecent({ force: true });
  const afterFailure = harness.stores.get('阿宁');
  assert.equal(failed.ok, false);
  assert.deepEqual(Array.from(afterFailure.memoryAnalysis.analyzedTurnKeys), []);
  assert.equal(afterFailure.memoryAnalysis.lastFailure.turnKey, 'u1::a1');
  assert.equal(afterFailure.memoryAnalysis.lastFailure.time, '2026-08-20T00:00:00.000Z');
  assert.doesNotMatch(afterFailure.memoryAnalysis.lastFailure.message, /secret details/);

  const retried = await harness.controller.analyzeRecent({ force: true });
  assert.equal(retried.ok, true);
  assert.equal(calls, 2);
  assert.equal(harness.stores.get('阿宁').memoryAnalysis.lastFailure, null);
  assert.deepEqual(Array.from(harness.stores.get('阿宁').memoryAnalysis.analyzedTurnKeys), ['u1::a1']);
});

test('automatic and manual analysis for one character run serially', async () => {
  const snapshot = storySnapshot();
  snapshot.messages.push(
    { id: 'u2', role: 'user', content: '继续' },
    { id: 'a2', role: 'assistant', content: '三天后阿宁进入钟楼。' }
  );
  const starts = [];
  const resolvers = [];
  const harness = createHarness({
    stores: { '阿宁': snapshot },
    analyzer: {
      shouldAnalyzeTurn: () => true,
      analyzeTurn(input) {
        starts.push(input.recentMessages.at(-1).id);
        return new Promise(resolve => resolvers.push(resolve));
      },
      deduplicateCandidates(input) { return input.candidates; },
    },
  });
  const first = harness.controller.considerTurn({ characterName: '阿宁', userMessageId: 'u1', assistantMessageId: 'a1' });
  const second = harness.controller.considerTurn({ characterName: '阿宁', userMessageId: 'u2', assistantMessageId: 'a2', force: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(starts, ['a1']);
  resolvers.shift()({ ok: true, candidates: [] });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(starts, ['a1', 'a2']);
  resolvers.shift()({ ok: true, candidates: [] });
  await Promise.all([first, second]);
});

test('switching to character B while A analyzes only persists and renders safely for A', async () => {
  let resolveAnalysis;
  const stores = { '甲': storySnapshot('甲'), '乙': storySnapshot('乙') };
  stores['乙'].messages = [{ id: 'ub', role: 'user', content: '你好' }, { id: 'ab', role: 'assistant', content: '你好。' }];
  const harness = createHarness({
    stores,
    activeCharacter: '甲',
    analyzer: {
      shouldAnalyzeTurn: () => true,
      analyzeTurn() { return new Promise(resolve => { resolveAnalysis = resolve; }); },
      deduplicateCandidates(input) { return input.candidates; },
    },
  });
  const work = harness.controller.considerTurn({ characterName: '甲', userMessageId: 'u1', assistantMessageId: 'a1' });
  await new Promise(resolve => setImmediate(resolve));
  harness.setActiveCharacter('乙');
  resolveAnalysis({ ok: true, candidates: [{
    id: 'ca', operation: 'add', memoryType: 'history_event', content: '甲抵达旧港', sourceMessageIds: ['u1', 'a1'],
    status: 'pending', conflict: false, possibleConflict: false, createdAt: 'x', updatedAt: 'x'
  }] });
  await work;
  assert.equal(harness.stores.get('甲').memoryCandidates.length, 1);
  assert.equal(harness.stores.get('乙').memoryCandidates.length, 0);
  assert.deepEqual(Array.from(new Set(harness.saves.map(item => item.name))), ['甲']);
  assert.equal(harness.renders.some(render => render.characterName === '甲'), false);
});

test('invalid analysis changes only failure metadata, never story or candidate data', async () => {
  const original = storySnapshot();
  original.memoryCandidates = [{ id: 'existing', operation: 'add', memoryType: 'key_info', content: '旧候选' }];
  const harness = createHarness({
    stores: { '阿宁': original },
    analyzer: {
      shouldAnalyzeTurn: () => true,
      async analyzeTurn() { return { ok: false, candidates: [], error: 'INVALID_ANALYSIS_JSON' }; },
      deduplicateCandidates(input) { return input.candidates; },
    },
  });
  const before = clone(harness.stores.get('阿宁'));
  await harness.controller.considerTurn({ characterName: '阿宁', userMessageId: 'u1', assistantMessageId: 'a1' });
  const after = harness.stores.get('阿宁');
  for (const field of ['messages', 'memories', 'currentScene', 'memoryCandidates']) {
    assert.deepEqual(after[field], before[field], field);
  }
  assert.deepEqual(Array.from(after.memoryAnalysis.analyzedTurnKeys), []);
  assert.ok(after.memoryAnalysis.lastFailure);
});

test('controller rejects AI candidates with missing, empty, or nonexistent sources but accepts legal sources', async t => {
  const sourceCases = [
    ['missing', undefined, false],
    ['empty', [], false],
    ['nonexistent', ['u1', 'missing'], false],
    ['legal', ['u1', 'a1'], true],
  ];
  for (const [label, sourceMessageIds, accepted] of sourceCases) {
    await t.test(label, async () => {
      const rawCandidate = {
        id: `candidate-${label}`, operation: 'add', memoryType: 'history_event', content: `${label} candidate`,
        sourceMessageIds, status: 'pending', conflict: false, possibleConflict: false,
        createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z',
      };
      const harness = createHarness({
        analyzer: {
          shouldAnalyzeTurn: () => true,
          async analyzeTurn() { return { ok: true, candidates: [rawCandidate] }; },
          deduplicateCandidates(input) { return input.candidates; },
        },
      });
      const result = await harness.controller.considerTurn({ characterName: '阿宁', userMessageId: 'u1', assistantMessageId: 'a1' });
      assert.equal(result.ok, accepted);
      assert.equal(harness.stores.get('阿宁').memoryCandidates.length, accepted ? 1 : 0);
      assert.equal(harness.stores.get('阿宁').memoryAnalysis.analyzedTurnKeys.length, accepted ? 1 : 0);
    });
  }
});

test('unexpected post-request analyzer errors are swallowed, recorded, and remain retryable', async () => {
  const harness = createHarness({
    analyzer: {
      shouldAnalyzeTurn: () => true,
      async analyzeTurn() { return { ok: true, candidates: [] }; },
      deduplicateCandidates() { throw new Error('dedup exploded'); },
    },
  });
  await assert.doesNotReject(() => harness.controller.considerTurn({
    characterName: '阿宁', userMessageId: 'u1', assistantMessageId: 'a1'
  }));
  const analysis = harness.stores.get('阿宁').memoryAnalysis;
  assert.deepEqual(Array.from(analysis.analyzedTurnKeys), []);
  assert.equal(analysis.lastFailure.turnKey, 'u1::a1');
  assert.doesNotMatch(analysis.lastFailure.message, /dedup exploded/);
});

test('analysis save failure leaves persisted candidates and analyzed keys unchanged', async () => {
  const harness = createHarness({
    saveResult: { ok: false, rolledBack: true },
    analyzer: {
      shouldAnalyzeTurn: () => true,
      async analyzeTurn() { return { ok: true, candidates: [] }; },
      deduplicateCandidates(input) { return input.candidates; },
    },
  });
  const result = await harness.controller.considerTurn({ characterName: '阿宁', userMessageId: 'u1', assistantMessageId: 'a1' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'ANALYSIS_SAVE_FAILED');
  assert.deepEqual(Array.from(harness.stores.get('阿宁').memoryAnalysis.analyzedTurnKeys), []);
  assert.equal(harness.stores.get('阿宁').memoryCandidates.length, 0);
});

test('analysis timeout releases the character queue, records failure, and allows a successful manual retry', async () => {
  let mode = 'timeout';
  const harness = createHarness({
    useRealAnalyzer: true,
    getAnalysisConfig() {
      return {
        apiUrl: 'https://example.test/chat', apiKey: 'sk-test', model: 'test-model', timeoutMs: 10,
        fetchImpl: mode === 'timeout'
          ? async () => ({ ok: true, json: () => new Promise(() => {}) })
          : async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"shouldSuggest":false,"candidates":[]}' } }] }) }),
      };
    },
  });
  const timedOut = await harness.controller.considerTurn({ characterName: '阿宁', userMessageId: 'u1', assistantMessageId: 'a1' });
  assert.equal(timedOut.ok, false);
  assert.equal(timedOut.error, 'ANALYSIS_TIMEOUT');
  assert.equal(harness.stores.get('阿宁').memoryAnalysis.lastFailure.turnKey, 'u1::a1');
  assert.deepEqual(Array.from(harness.stores.get('阿宁').memoryAnalysis.analyzedTurnKeys), []);

  mode = 'success';
  const retried = await harness.controller.analyzeRecent({ force: true });
  assert.equal(retried.ok, true);
  assert.equal(harness.stores.get('阿宁').memoryAnalysis.lastFailure, null);
  assert.deepEqual(Array.from(harness.stores.get('阿宁').memoryAnalysis.analyzedTurnKeys), ['u1::a1']);
});

test('invalidating a character epoch prevents in-flight and already queued turns from committing anything', async () => {
  const snapshot = storySnapshot();
  snapshot.messages.push(
    { id: 'u2', role: 'user', content: '继续' },
    { id: 'a2', role: 'assistant', content: '陆衡随后离开旧港。' }
  );
  const starts = [];
  const resolvers = [];
  const harness = createHarness({
    stores: { '阿宁': snapshot },
    analyzer: {
      shouldAnalyzeTurn: () => true,
      analyzeTurn(input) {
        starts.push(input.recentMessages.at(-1).id);
        return new Promise(resolve => resolvers.push(resolve));
      },
      deduplicateCandidates(input) { return input.candidates; },
    },
  });
  const first = harness.controller.considerTurn({ characterName: '阿宁', userMessageId: 'u1', assistantMessageId: 'a1' });
  const queued = harness.controller.considerTurn({ characterName: '阿宁', userMessageId: 'u2', assistantMessageId: 'a2' });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(starts, ['a1']);

  harness.controller.invalidateAnalysis('阿宁');
  resolvers.shift()({ ok: false, error: 'late failure must also be ignored' });
  const [firstResult, queuedResult] = await Promise.all([first, queued]);
  assert.equal(firstResult.skipped, 'STALE_ANALYSIS_EPOCH');
  assert.equal(queuedResult.skipped, 'STALE_ANALYSIS_EPOCH');
  assert.deepEqual(starts, ['a1'], 'queued old-epoch work must not start a request');
  assert.equal(harness.saves.length, 0);
  assert.deepEqual(Array.from(harness.stores.get('阿宁').memoryAnalysis.analyzedTurnKeys), []);
  assert.equal(harness.stores.get('阿宁').memoryAnalysis.lastFailure, null);
  assert.equal(harness.stores.get('阿宁').memoryCandidates.length, 0);
  assert.equal(harness.renders.length, 0);
});

test('index loads Analyzer in order and wires non-blocking send, regenerate, and manual analysis', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const uiSource = fs.readFileSync(path.join(root, 'js', 'memory', 'memory-ui.js'), 'utf8');
  const order = [
    'js/memory/memory-model.js',
    'js/memory/memory-storage.js',
    'js/memory/memory-context.js',
    'js/memory/memory-analyzer.js',
    'js/memory/memory-ui.js',
    'js/memory/memory-controller.js',
  ].map(name => html.indexOf(name));
  assert.ok(order.every(index => index >= 0));
  assert.deepEqual(order, order.slice().sort((a, b) => a - b));
  assert.match(html, /loadCharacterSnapshot\s*:/);
  assert.match(html, /saveCharacterSnapshot\s*:/);
  assert.match(html, /getAnalysisConfig\s*:/);
  assert.match(html, /memoryUI\.on\(['"]manual-analyze['"]/);
  assert.match(uiSource, /el\.analyzeButton\.addEventListener\(['"]click['"]/);
  assert.match(uiSource, /emit\(['"]manual-analyze['"]\s*,\s*\{\s*force:\s*true\s*\}\)/);
  assert.doesNotMatch(uiSource, /整理记忆功能尚未接入/);
  assert.doesNotMatch(html, /id="memoryAnalyzeBtn"[^>]*disabled/);
  const considerCalls = html.match(/memoryController\.considerTurn\s*\(/g) || [];
  assert.equal(considerCalls.length, 2);
  assert.doesNotMatch(html, /await\s+memoryController\.considerTurn/);
});
