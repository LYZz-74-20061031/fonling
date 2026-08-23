const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');

function extractFunction(name) {
  const match = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(html);
  assert.ok(match, `${name} missing`);
  const open = html.indexOf('{', match.index);
  let depth = 0;
  for (let index = open; index < html.length; index += 1) {
    if (html[index] === '{') depth += 1;
    else if (html[index] === '}' && --depth === 0) return html.slice(match.index, index + 1);
  }
  throw new Error(`unclosed ${name}`);
}

function loadMemoryModules() {
  const sandbox = {
    globalThis: null,
    Date,
    AbortController,
    setTimeout,
    clearTimeout,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const file of [
    'js/memory/memory-model.js',
    'js/memory/memory-analyzer.js',
    'js/memory/memory-controller.js',
  ]) vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox);
  return sandbox.FonlingMemory;
}

test('an important completed turn automatically creates and renders a pending memory candidate', async () => {
  const memory = loadMemoryModules();
  let persisted = {
    currentCharacter: '阿宁',
    memorySnapshotIdentity: 1,
    messages: [
      { id: 'u1', role: 'user', content: '我们现在怎么办？' },
      { id: 'a1', role: 'assistant', content: '阿宁已经答应护送你抵达山门，并会保守你的真实身份。' },
    ],
    summary: '',
    memories: [],
    currentScene: { time: '', location: '', presentCharacters: [], updatedAt: '' },
    memoryCandidates: [],
    memoryAnalysis: { analyzedTurnKeys: [], lastFailure: null, activeCharacter: null },
  };
  const rendered = [];
  const controller = memory.Controller.createMemoryController({
    getState: () => persisted,
    save: () => ({ ok: true }),
    getCharacterName: () => '阿宁',
    loadCharacterSnapshot: () => persisted,
    saveCharacterSnapshot: (_name, next) => {
      persisted = JSON.parse(JSON.stringify(next));
      return { ok: true, rolledBack: true };
    },
    getAnalysisConfig: () => ({
      requestImpl: async () => ({
        content: JSON.stringify({
          shouldSuggest: true,
          candidates: [{
            operation: 'add',
            memoryType: 'history_event',
            content: '阿宁承诺护送主控抵达山门，并保守主控的真实身份。',
            sourceMessageIds: ['u1', 'a1'],
            reason: '这是影响后续剧情的明确承诺。',
          }],
        }),
      }),
    }),
    ui: {
      render: snapshot => rendered.push(snapshot),
      showAnalysisFailure: message => assert.fail(message),
      showStorageWarning: message => assert.fail(String(message)),
    },
    now: () => '2026-08-23T08:00:00.000Z',
  });

  const result = await controller.considerTurn({
    characterName: '阿宁',
    userMessageId: 'u1',
    assistantMessageId: 'a1',
  });

  assert.equal(result.ok, true);
  assert.equal(result.candidates.length, 1);
  assert.equal(persisted.memoryCandidates.length, 1);
  assert.equal(persisted.memoryCandidates[0].content, '阿宁承诺护送主控抵达山门，并保守主控的真实身份。');
  assert.deepEqual(Array.from(persisted.memoryAnalysis.analyzedTurnKeys), ['u1::a1']);
  assert.equal(rendered.at(-1).memoryCandidates.length, 1);
});

test('ordinary small talk is intentionally skipped by automatic memory analysis', async () => {
  const memory = loadMemoryModules();
  const persisted = {
    currentCharacter: '阿宁',
    messages: [
      { id: 'u1', role: 'user', content: '你好呀？' },
      { id: 'a1', role: 'assistant', content: '你好，很高兴见到你。' },
    ],
    memories: [],
    currentScene: {},
    memoryCandidates: [],
    memoryAnalysis: { analyzedTurnKeys: [], lastFailure: null, activeCharacter: null },
  };
  let requested = false;
  const controller = memory.Controller.createMemoryController({
    getState: () => persisted,
    save: () => ({ ok: true }),
    getCharacterName: () => '阿宁',
    loadCharacterSnapshot: () => persisted,
    saveCharacterSnapshot: () => ({ ok: true }),
    getAnalysisConfig: () => ({ requestImpl: async () => { requested = true; return { content: '' }; } }),
    ui: { render() {}, showAnalysisFailure() {}, showStorageWarning() {} },
  });

  const result = await controller.considerTurn({ characterName: '阿宁', userMessageId: 'u1', assistantMessageId: 'a1' });
  assert.equal(result.skipped, 'TRIGGER_NOT_MET');
  assert.equal(requested, false);
});

test('automatic analysis and chapter summaries are routed to the free non-streaming GLM model', () => {
  const sandbox = { globalThis: null };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync('js/model/model-config.js', 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync('js/model/model-gateway.js', 'utf8'), sandbox);
  const config = { defaultProvider: 'deepseek', glmApiKey: 'glm-key', deepseekApiKey: 'deepseek-key' };
  for (const task of ['analysis', 'summary']) {
    const plan = sandbox.FonlingModels.Gateway.createPlan({ task, config });
    assert.equal(plan.provider, 'glm');
    assert.equal(plan.tier, 'free');
    assert.equal(plan.model, 'glm-4.7-flash');
    assert.equal(plan.stream, false);
    assert.equal(plan.apiKey, 'glm-key');
  }
});

test('ending a chapter requests a final summary and persists a ready draft for confirmation', async () => {
  const chapter = {
    id: 'c1',
    name: '雨夜',
    status: 'ended',
    revision: 4,
    summary: { draftStatus: 'generating', draftText: '', confirmedText: '' },
  };
  const snapshot = { chapters: [chapter], activeChapterId: null };
  let mutationResult = null;
  let requestedPlan = null;
  const sandbox = {
    chapterSummaryEpoch: 0,
    chapterSummaryRequestEpochs: {},
    chapterSummaryRequestKey: (characterName, chapterId) => `${characterName}::${chapterId}`,
    loadCharacterSnapshotForAnalysis: () => snapshot,
    createModelRequestPlan: (task, options) => {
      requestedPlan = { task, options };
      return { apiKey: 'glm-key' };
    },
    requestModel: async () => ({ content: '本章中，阿宁在雨夜护送主控抵达山门，并承诺保守其身份。' }),
    applyChapterSummaryMutation: (request, mutation) => {
      mutationResult = mutation(snapshot, chapter);
      return true;
    },
    chapterNamespace: {
      Controller: {
        summaryRequestMatches: (request, current) => current.characterName === request.characterName
          && current.chapter === chapter && current.epoch === request.epoch,
        buildFinalSummaryMessages: value => [{ role: 'user', content: `总结${value.name}` }],
        validateFinalSummary: text => ({ ok: true, text }),
      },
    },
    chapterModel: {
      setSummaryDraft: (_state, chapterId, text) => ({ marker: 'ready', chapterId, text }),
      setSummaryFailure: (_state, chapterId, failure) => ({ marker: 'failed', chapterId, failure }),
    },
    Error,
    Object,
    Date,
  };
  vm.createContext(sandbox);
  vm.runInContext(`${extractFunction('requestChapterSummary')}; this.result = requestChapterSummary('阿宁', 'c1', 4);`, sandbox);

  assert.equal(await sandbox.result, true);
  assert.equal(requestedPlan.task, 'summary');
  assert.equal(requestedPlan.options.provider, 'glm');
  assert.equal(mutationResult.marker, 'ready');
  assert.equal(mutationResult.chapterId, 'c1');
  assert.match(mutationResult.text, /抵达山门/);
  assert.deepEqual(sandbox.chapterSummaryRequestEpochs, {});
});

test('chapter summary failure is persisted as retryable state and the end action starts the request', async () => {
  const endStart = html.indexOf("chapterUI.on('end-active'");
  const endBlock = html.slice(endStart, html.indexOf("chapterUI.on('confirm-summary'", endStart));
  assert.match(endBlock, /requestChapterSummary\(state\.currentCharacter,\s*chapterId,\s*ended\.revision\)/);

  const chapter = { id: 'c1', status: 'ended', revision: 4, summary: { draftStatus: 'generating' } };
  let mutationResult = null;
  const sandbox = {
    chapterSummaryEpoch: 0,
    chapterSummaryRequestEpochs: {},
    chapterSummaryRequestKey: (characterName, chapterId) => `${characterName}::${chapterId}`,
    loadCharacterSnapshotForAnalysis: () => ({ chapters: [chapter] }),
    createModelRequestPlan: () => ({ apiKey: '' }),
    requestModel: async () => assert.fail('missing key must not request'),
    applyChapterSummaryMutation: (_request, mutation) => {
      mutationResult = mutation({ chapters: [chapter] }, chapter);
      return true;
    },
    chapterNamespace: {
      Controller: {
        summaryRequestMatches: () => true,
        buildFinalSummaryMessages: () => [],
        validateFinalSummary: () => assert.fail('missing key must not validate'),
      },
    },
    chapterModel: {
      setSummaryDraft: () => assert.fail('missing key must not create draft'),
      setSummaryFailure: (_state, chapterId, failure) => ({ marker: 'failed', chapterId, failure }),
    },
    Error,
    Object,
    Date,
  };
  vm.createContext(sandbox);
  vm.runInContext(`${extractFunction('requestChapterSummary')}; this.result = requestChapterSummary('阿宁', 'c1', 4);`, sandbox);

  assert.equal(await sandbox.result, false);
  assert.equal(mutationResult.marker, 'failed');
  assert.match(mutationResult.failure.message, /GLM API Key/);
  assert.deepEqual(sandbox.chapterSummaryRequestEpochs, {});
});
