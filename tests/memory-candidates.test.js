const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadModel() {
  let nextId = 0;
  const context = {
    crypto: { randomUUID: () => `generated-${++nextId}` },
    Date,
    Math,
  };
  vm.runInNewContext(fs.readFileSync('js/memory/memory-model.js', 'utf8'), context);
  return context.FonlingMemory.Model;
}

function plain(value) { return JSON.parse(JSON.stringify(value)); }

function memory(Model, id, type, content, extra = {}) {
  return Model.createMemory({ id, type, content, ...extra }, '2026-08-13T00:00:00.000Z');
}

function candidate(Model, input) {
  return Model.createCandidate({ id: input.id || 'candidate-1', ...input }, '2026-08-13T01:00:00.000Z');
}

test('confirms add and edited add candidates into formal memory with source history', () => {
  const Model = loadModel();
  const pending = candidate(Model, {
    operation: 'add', memoryType: 'history_event', content: '旧建议',
    sourceMessageIds: ['user-1', 'assistant-1'],
  });
  const original = { memories: [], currentScene: Model.normalizeScene({}), memoryCandidates: [pending] };
  const result = Model.confirmCandidate(original, pending.id, {
    memoryType: 'key_info', content: '确认后的秘密', pinned: true,
  }, { now: '2026-08-13T02:00:00.000Z', createId: () => 'memory-added' });

  assert.equal(result.ok, true);
  assert.notEqual(result.snapshot, original);
  assert.deepEqual(plain(result.snapshot.memoryCandidates), []);
  assert.deepEqual(plain(result.snapshot.memories[0]), {
    id: 'memory-added', type: 'key_info', content: '确认后的秘密', status: 'active', pinned: true,
    createdAt: '2026-08-13T02:00:00.000Z', updatedAt: '2026-08-13T02:00:00.000Z',
    sourceMessageIds: ['user-1', 'assistant-1'],
  });
  assert.deepEqual(plain(original.memoryCandidates), [plain(pending)]);
});

test('update preserves target identity, creation metadata and accumulates source history', () => {
  const Model = loadModel();
  const target = memory(Model, 'memory-old', 'key_info', '旧身份', {
    source: 'manual', sourceMessageIds: ['earlier'], createdAt: 'created', updatedAt: 'updated',
  });
  const pending = candidate(Model, {
    operation: 'update', memoryType: 'key_info', content: '新身份', targetMemoryIds: ['memory-old'],
    sourceMessageIds: ['assistant-2'],
  });
  const original = { memories: [target], currentScene: Model.normalizeScene({}), memoryCandidates: [pending] };
  const result = Model.confirmCandidate(original, pending.id, null, { now: 'later' });

  assert.equal(result.ok, true);
  assert.equal(result.snapshot.memories[0].id, 'memory-old');
  assert.equal(result.snapshot.memories[0].createdAt, 'created');
  assert.equal(result.snapshot.memories[0].content, '新身份');
  assert.equal(result.snapshot.memories[0].source, 'manual');
  assert.deepEqual(Array.from(result.snapshot.memories[0].sourceMessageIds), ['earlier', 'assistant-2']);
});

test('merge removes every target and creates one replacement with combined sources', () => {
  const Model = loadModel();
  const a = memory(Model, 'a', 'history_event', '抵达码头', { sourceMessageIds: ['m1'] });
  const b = memory(Model, 'b', 'history_event', '发现追兵', { sourceMessageIds: ['m2'] });
  const untouched = memory(Model, 'keep', 'key_info', '钥匙在阿宁手中');
  const pending = candidate(Model, {
    operation: 'merge', memoryType: 'history_event', content: '抵达码头后发现追兵',
    targetMemoryIds: ['a', 'b'], source: 'ai_suggestion', sourceMessageIds: ['m3'],
  });
  const original = { memories: [a, untouched, b], currentScene: Model.normalizeScene({}), memoryCandidates: [pending] };
  const result = Model.confirmCandidate(original, pending.id, null, {
    now: 'merged-at', createId: () => 'merged',
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.snapshot.memories.map(item => item.id), ['keep', 'merged']);
  assert.equal(result.snapshot.memories[1].source, 'ai_suggestion');
  assert.deepEqual(Array.from(result.snapshot.memories[1].sourceMessageIds), ['m1', 'm2', 'm3']);
});

test('merge retries IDs that collide with retained memories and fails atomically after bounded collisions', () => {
  const Model = loadModel();
  const a = memory(Model, 'a', 'history_event', '事件A');
  const b = memory(Model, 'b', 'history_event', '事件B');
  const retained = memory(Model, 'keep', 'key_info', '不参与合并');
  const pending = candidate(Model, {
    operation: 'merge', memoryType: 'history_event', content: '合并事件', targetMemoryIds: ['a', 'b'],
  });
  const original = { memories: [a, retained, b], currentScene: Model.normalizeScene({}), memoryCandidates: [pending] };
  const generated = ['keep', 'unique'];
  const success = Model.confirmCandidate(original, pending.id, null, { createId: () => generated.shift() });

  assert.equal(success.ok, true);
  assert.deepEqual(success.snapshot.memories.map(item => item.id), ['keep', 'unique']);

  let attempts = 0;
  const failure = Model.confirmCandidate(original, pending.id, null, { createId: () => { attempts += 1; return 'keep'; } });
  assert.equal(failure.ok, false);
  assert.equal(failure.error, 'MEMORY_ID_GENERATION_FAILED');
  assert.equal(failure.snapshot, original);
  assert.ok(attempts > 1 && attempts <= 100, `expected bounded retries, got ${attempts}`);
});

test('resolve updates compatible target statuses and rejects incompatible edits atomically', () => {
  const Model = loadModel();
  const a = memory(Model, 'a', 'key_info', '门仍锁着', { sourceMessageIds: ['m0'] });
  const b = memory(Model, 'b', 'key_info', '守卫仍警觉');
  const candidateSourceIds = ['m1', '', 'm1'];
  const pending = candidate(Model, {
    operation: 'resolve', memoryType: 'key_info', content: '', targetMemoryIds: ['a', 'b'],
    resultStatus: 'resolved', sourceMessageIds: candidateSourceIds,
  });
  const pendingBefore = plain(pending);
  const original = { memories: [a, b], currentScene: Model.normalizeScene({}), memoryCandidates: [pending] };
  const success = Model.confirmCandidate(original, pending.id, null, { now: 'resolved-at' });
  assert.equal(success.ok, true);
  assert.deepEqual(success.snapshot.memories.map(item => item.status), ['resolved', 'resolved']);
  assert.deepEqual(Array.from(success.snapshot.memories[0].sourceMessageIds), ['m0', 'm1']);
  assert.deepEqual(Array.from(success.snapshot.memories[1].sourceMessageIds), ['m1']);
  assert.deepEqual(plain(pending), pendingBefore);
  assert.deepEqual(candidateSourceIds, ['m1', '', 'm1']);

  const failure = Model.confirmCandidate(original, pending.id, { resultStatus: 'archived' }, { now: 'later' });
  assert.equal(failure.ok, false);
  assert.equal(failure.error, 'INVALID_CANDIDATE');
  assert.equal(failure.snapshot, original);
  assert.equal(original.memories[0].status, 'active');
});

test('scene patch preserves omitted fields and permits an explicit clear', () => {
  const Model = loadModel();
  const pending = candidate(Model, {
    operation: 'scene_patch', scenePatch: { location: '车站', currentConflict: '' },
    sourceMessageIds: ['assistant-3'],
  });
  const original = {
    memories: [],
    currentScene: Model.normalizeScene({ time: '深夜', location: '码头', currentGoal: '逃离', currentConflict: '追兵逼近' }),
    memoryCandidates: [pending],
  };
  const result = Model.confirmCandidate(original, pending.id, null, { now: 'scene-at' });
  assert.equal(result.ok, true);
  assert.equal(result.snapshot.currentScene.time, '深夜');
  assert.equal(result.snapshot.currentScene.location, '车站');
  assert.equal(result.snapshot.currentScene.currentGoal, '逃离');
  assert.equal(result.snapshot.currentScene.currentConflict, '');
});

test('dismiss one or a batch removes only selected candidates', () => {
  const Model = loadModel();
  const candidates = ['a', 'b', 'c'].map(id => candidate(Model, {
    id, operation: 'add', memoryType: 'key_info', content: id,
  }));
  const original = { memories: [], currentScene: Model.normalizeScene({}), memoryCandidates: candidates };
  const one = Model.dismissCandidate(original, 'b');
  assert.equal(one.ok, true);
  assert.deepEqual(one.snapshot.memoryCandidates.map(item => item.id), ['a', 'c']);
  assert.equal(one.snapshot.memories, original.memories);
  assert.equal(one.snapshot.currentScene, original.currentScene);
  const batch = Model.dismissCandidateBatch(original, ['a', 'c']);
  assert.equal(batch.ok, true);
  assert.deepEqual(batch.snapshot.memoryCandidates.map(item => item.id), ['b']);
});

test('missing targets and pinned budget failures preserve the exact original snapshot reference', () => {
  const Model = loadModel();
  const full = memory(Model, 'full', 'key_info', 'x'.repeat(4000), { pinned: true });
  const add = candidate(Model, { id: 'add', operation: 'add', memoryType: 'key_info', content: 'y', sourceMessageIds: [] });
  const updateMissing = candidate(Model, {
    id: 'missing', operation: 'update', memoryType: 'key_info', content: 'new', targetMemoryIds: ['absent'],
  });
  const original = { memories: [full], currentScene: Model.normalizeScene({}), memoryCandidates: [add, updateMissing] };

  const budget = Model.confirmCandidate(original, 'add', { pinned: true });
  assert.equal(budget.ok, false);
  assert.equal(budget.error, 'PINNED_BUDGET_EXCEEDED');
  assert.equal(budget.snapshot, original);
  const target = Model.confirmCandidate(original, 'missing');
  assert.equal(target.ok, false);
  assert.equal(target.error, 'MEMORY_NOT_FOUND');
  assert.equal(target.snapshot, original);
});
