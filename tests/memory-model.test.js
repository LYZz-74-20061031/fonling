const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadModel(overrides = {}) {
  const source = fs.readFileSync('js/memory/memory-model.js', 'utf8');
  const context = {
    crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000001' },
    Date,
    Math,
    ...overrides,
  };

  vm.runInNewContext(source, context);
  return context.FonlingMemory.Model;
}

test('exports the versioned model and an immutable empty scene', () => {
  const model = loadModel();

  assert.equal(model.MEMORY_SCHEMA_VERSION, 2);
  assert.equal(Object.isFrozen(model.EMPTY_SCENE), true);
  assert.deepEqual(Object.keys(model.EMPTY_SCENE), [
    'time',
    'location',
    'presentCharacters',
    'currentGoal',
    'currentConflict',
    'characterStates',
    'environment',
    'notes',
    'updatedAt',
  ]);
});

test('ensureMessageIds adds unique IDs once and preserves existing IDs', () => {
  const { ensureMessageIds } = loadModel();
  const generated = ['msg-one', 'msg-two'];
  let calls = 0;
  const messages = [
    { role: 'user', content: 'one' },
    { id: 'kept-id', role: 'assistant', content: 'two' },
    { role: 'user', content: 'three' },
  ];

  const first = ensureMessageIds(messages, () => generated[calls++]);
  assert.equal(first, messages);
  assert.deepEqual(messages.map(message => message.id), ['msg-one', 'kept-id', 'msg-two']);
  assert.equal(new Set(messages.map(message => message.id)).size, 3);

  ensureMessageIds(messages, () => {
    calls += 1;
    throw new Error('generator must not run for existing IDs');
  });
  assert.equal(calls, 2);
  assert.deepEqual(messages.map(message => message.id), ['msg-one', 'kept-id', 'msg-two']);
});

test('ensureMessageIds disambiguates duplicate existing IDs once', () => {
  const { ensureMessageIds } = loadModel();
  const messages = [{ id: 'same-id' }, { id: 'same-id' }];
  let calls = 0;

  ensureMessageIds(messages, () => {
    calls += 1;
    return 'replacement-id';
  });
  assert.deepEqual(messages.map(message => message.id), ['same-id', 'replacement-id']);
  assert.equal(calls, 1);

  ensureMessageIds(messages, () => {
    throw new Error('generator must not run after duplicates are resolved');
  });
  assert.deepEqual(messages.map(message => message.id), ['same-id', 'replacement-id']);
});

test('ensureMessageIds avoids IDs already used by later messages', () => {
  const { ensureMessageIds } = loadModel();
  const messages = [{ content: 'missing ID' }, { id: 'reserved-id' }];

  ensureMessageIds(messages, () => 'reserved-id');

  assert.notEqual(messages[0].id, 'reserved-id');
  assert.equal(messages[1].id, 'reserved-id');
  assert.equal(new Set(messages.map(message => message.id)).size, 2);
});

test('createId uses crypto.randomUUID when available', () => {
  const { createId } = loadModel({
    crypto: { randomUUID: () => '12345678-1234-4234-8234-123456789abc' },
  });

  assert.equal(createId('memory'), 'memory_12345678-1234-4234-8234-123456789abc');
});

test('createId falls back to time and randomness when randomUUID is unavailable', () => {
  class FixedDate extends Date {
    static now() {
      return 1723456789000;
    }
  }
  const randomValues = [0.123456789, 0.987654321];
  const { createId } = loadModel({
    crypto: {},
    Date: FixedDate,
    Math: { random: () => randomValues.shift() },
  });

  const first = createId('candidate');
  const second = createId('candidate');

  assert.match(first, /^candidate_[^-]+-.+$/);
  assert.ok(first.includes(FixedDate.now().toString(36)), 'fallback ID must contain a time component');
  assert.notEqual(first, second, 'randomness must keep IDs unique within the same millisecond');
});

test('createMemory trims content and applies active unpinned defaults', () => {
  const { createMemory } = loadModel();
  const created = createMemory({
    id: 'memory-existing',
    type: 'history_event',
    content: '  Met the archivist.  ',
  }, '2026-08-13T10:00:00.000Z');

  assert.deepEqual({ ...created }, {
    id: 'memory-existing',
    type: 'history_event',
    content: 'Met the archivist.',
    status: 'active',
    pinned: false,
    createdAt: '2026-08-13T10:00:00.000Z',
    updatedAt: '2026-08-13T10:00:00.000Z',
  });

  assert.equal(createMemory({ type: 'key_info', content: '  The seal is broken.  ' }, 100).type, 'key_info');
});

test('normalizers preserve valid IDs and timestamps and copy arrays', () => {
  const { normalizeMemory, normalizeCandidate, normalizeScene } = loadModel();
  const memory = normalizeMemory({
    id: 'memory-1',
    type: 'key_info',
    content: '  known fact  ',
    status: 'resolved',
    pinned: true,
    createdAt: 'created-value',
    updatedAt: 'updated-value',
  });
  assert.equal(memory.id, 'memory-1');
  assert.equal(memory.createdAt, 'created-value');
  assert.equal(memory.updatedAt, 'updated-value');

  const targets = [' memory-1 ', 'memory-2'];
  const candidate = normalizeCandidate({
    id: 'candidate-1',
    operation: 'merge',
    memoryType: 'key_info',
    content: '  combined  ',
    targetMemoryIds: targets,
    createdAt: 'candidate-created',
    updatedAt: 'candidate-updated',
  });
  assert.notEqual(candidate.targetMemoryIds, targets);
  assert.deepEqual(Array.from(candidate.targetMemoryIds), ['memory-1', 'memory-2']);
  assert.equal(candidate.createdAt, 'candidate-created');
  assert.equal(candidate.updatedAt, 'candidate-updated');

  const characters = [' Mira ', 'Jon'];
  const scene = normalizeScene({ presentCharacters: characters });
  assert.notEqual(scene.presentCharacters, characters);
  assert.deepEqual(Array.from(scene.presentCharacters), ['Mira', 'Jon']);
  assert.deepEqual(characters, [' Mira ', 'Jon']);
});

test('memory metadata is normalized without mutating input and survives round trips', () => {
  const { createMemory, normalizeMemory } = loadModel();
  const sourceMessageIds = [' message-1 ', '', 'message-2', 'message-1'];
  const input = {
    id: 'memory-metadata',
    type: 'key_info',
    content: '  The seal is broken.  ',
    source: '  extraction  ',
    sourceMessageIds,
    unknownField: 'must not leak',
  };
  const snapshot = JSON.parse(JSON.stringify(input));

  const created = createMemory(input, '2026-08-13T13:00:00.000Z');
  const normalizedAgain = normalizeMemory(created);

  assert.equal(created.source, 'extraction');
  assert.deepEqual(Array.from(created.sourceMessageIds), ['message-1', 'message-2']);
  assert.notEqual(created.sourceMessageIds, sourceMessageIds);
  assert.equal(Object.hasOwn(created, 'unknownField'), false);
  assert.deepEqual(input, snapshot);
  assert.deepEqual({ ...normalizedAgain, sourceMessageIds: Array.from(normalizedAgain.sourceMessageIds) }, {
    ...created,
    sourceMessageIds: Array.from(created.sourceMessageIds),
  });
});

test('candidate metadata and memoryType survive normalization without mutating input', () => {
  const { createCandidate, normalizeCandidate } = loadModel();
  const sourceMessageIds = [' message-1 ', 'message-2', 'message-1', ''];
  const input = {
    id: 'candidate-metadata',
    operation: 'update',
    memoryType: 'key_info',
    content: '  The seal is intact.  ',
    targetMemoryIds: [' memory-1 '],
    reason: '  Later evidence contradicted it.  ',
    status: 'pending',
    sourceMessageIds,
    conflict: true,
    possibleConflict: true,
    oldContent: '  The seal is broken.  ',
    unknownField: 'must not leak',
  };
  const snapshot = JSON.parse(JSON.stringify(input));

  const created = createCandidate(input, '2026-08-13T13:00:00.000Z');
  const normalizedAgain = normalizeCandidate(created);

  assert.equal(created.memoryType, 'key_info');
  assert.equal(Object.hasOwn(created, 'type'), false);
  assert.equal(created.reason, 'Later evidence contradicted it.');
  assert.equal(created.status, 'pending');
  assert.deepEqual(Array.from(created.sourceMessageIds), ['message-1', 'message-2']);
  assert.notEqual(created.sourceMessageIds, sourceMessageIds);
  assert.equal(created.conflict, true);
  assert.equal(created.possibleConflict, true);
  assert.equal(created.oldContent, 'The seal is broken.');
  assert.equal(Object.hasOwn(created, 'unknownField'), false);
  assert.deepEqual(input, snapshot);
  assert.deepEqual({
    ...normalizedAgain,
    targetMemoryIds: Array.from(normalizedAgain.targetMemoryIds),
    sourceMessageIds: Array.from(normalizedAgain.sourceMessageIds),
  }, {
    ...created,
    targetMemoryIds: Array.from(created.targetMemoryIds),
    sourceMessageIds: Array.from(created.sourceMessageIds),
  });
});

test('candidate schema defaults metadata and only accepts pending status', () => {
  const { createCandidate, normalizeCandidate } = loadModel();
  const candidate = createCandidate({
    operation: 'add',
    memoryType: 'history_event',
    content: 'The gate opened.',
  });

  assert.equal(candidate.status, 'pending');
  assert.equal(candidate.conflict, false);
  assert.equal(candidate.possibleConflict, false);
  assert.deepEqual(Array.from(candidate.sourceMessageIds), []);
  assert.equal(normalizeCandidate({ ...candidate, status: 'accepted' }), null);

  const legacy = createCandidate({ operation: 'add', type: 'key_info', content: 'Legacy input' });
  assert.equal(legacy.memoryType, 'key_info');
  assert.equal(Object.hasOwn(legacy, 'type'), false);
});

test('normalizers reject invalid metadata types without throwing', () => {
  const { normalizeMemory, normalizeCandidate } = loadModel();

  assert.equal(normalizeMemory({
    type: 'key_info',
    content: 'Known fact',
    sourceMessageIds: ['message-1', 2],
  }), null);
  assert.equal(normalizeCandidate({
    operation: 'update',
    memoryType: 'key_info',
    content: 'Correction',
    targetMemoryIds: [2],
  }), null);
  assert.equal(normalizeCandidate({
    operation: 'add',
    memoryType: 'key_info',
    content: 'Fact',
    conflict: 'yes',
  }), null);
});

test('applyScenePatch only changes supplied fields', () => {
  const { applyScenePatch } = loadModel();
  const scene = {
    time: 'Evening',
    location: 'Old library',
    presentCharacters: ['Mira'],
    currentGoal: 'Find the ledger',
    currentConflict: 'The doors are locked',
    characterStates: 'Mira is alert',
    environment: 'Dusty and quiet',
    notes: 'A bell rang once',
    updatedAt: 'before',
  };

  const updated = applyScenePatch(scene, {
    location: '  Archive vault  ',
    presentCharacters: [' Mira ', ' Archivist '],
  }, '2026-08-13T11:00:00.000Z');

  assert.notEqual(updated, scene);
  assert.equal(updated.location, 'Archive vault');
  assert.deepEqual(Array.from(updated.presentCharacters), ['Mira', 'Archivist']);
  assert.equal(updated.time, 'Evening');
  assert.equal(updated.currentGoal, 'Find the ledger');
  assert.equal(updated.currentConflict, 'The doors are locked');
  assert.equal(updated.characterStates, 'Mira is alert');
  assert.equal(updated.environment, 'Dusty and quiet');
  assert.equal(updated.notes, 'A bell rang once');
  assert.equal(updated.updatedAt, '2026-08-13T11:00:00.000Z');
});

test('an applied scene patch can be normalized again without losing updatedAt', () => {
  const { applyScenePatch, normalizeScene } = loadModel();
  const updated = applyScenePatch({ currentGoal: 'Find the ledger' }, {
    location: 'Archive vault',
  }, '2026-08-13T11:00:00.000Z');

  const normalizedAgain = normalizeScene(updated);

  assert.ok(normalizedAgain);
  assert.equal(normalizedAgain.currentGoal, 'Find the ledger');
  assert.equal(normalizedAgain.location, 'Archive vault');
  assert.equal(normalizedAgain.updatedAt, '2026-08-13T11:00:00.000Z');
  assert.equal(applyScenePatch(updated, { updatedAt: 'forged' }), null);
});

test('scene patches accept characterStates text and copy presentCharacters arrays', () => {
  const { applyScenePatch, createCandidate } = loadModel();
  const presentCharacters = [' Mira ', ' Archivist '];
  const patch = {
    characterStates: '  Mira is alert; the Archivist is guarded.  ',
    presentCharacters,
  };

  const updated = applyScenePatch({}, patch, '2026-08-13T12:00:00.000Z');
  const candidate = createCandidate({ operation: 'scene_patch', scenePatch: patch });

  assert.equal(updated.characterStates, 'Mira is alert; the Archivist is guarded.');
  assert.deepEqual(Array.from(updated.presentCharacters), ['Mira', 'Archivist']);
  assert.notEqual(updated.presentCharacters, presentCharacters);
  assert.equal(candidate.scenePatch.characterStates, 'Mira is alert; the Archivist is guarded.');
  assert.deepEqual(Array.from(candidate.scenePatch.presentCharacters), ['Mira', 'Archivist']);
  assert.deepEqual(patch, {
    characterStates: '  Mira is alert; the Archivist is guarded.  ',
    presentCharacters: [' Mira ', ' Archivist '],
  });
});

test('rejects empty memory content and invalid memory types', () => {
  const { createMemory, normalizeMemory } = loadModel();

  assert.equal(createMemory({ type: 'history_event', content: '   ' }), null);
  assert.equal(createMemory({ type: 'rumor', content: 'Something happened' }), null);
  assert.equal(normalizeMemory({ type: 'key_info', content: '' }), null);
});

test('validates candidate operations and their operation-specific fields', () => {
  const { createCandidate } = loadModel();

  assert.equal(createCandidate({ operation: 'delete', memoryType: 'key_info', content: 'x' }), null);
  assert.equal(createCandidate({ operation: 'add', memoryType: 'key_info', content: '   ' }), null);
  assert.equal(createCandidate({ operation: 'update', memoryType: 'key_info', content: 'x' }), null);
  assert.equal(createCandidate({ operation: 'merge', memoryType: 'key_info', content: 'x', targetMemoryIds: ['one'] }), null);
  assert.equal(createCandidate({ operation: 'resolve', memoryType: 'key_info', targetMemoryIds: [] }), null);
  assert.equal(createCandidate({ operation: 'scene_patch', scenePatch: {} }), null);

  assert.ok(createCandidate({ operation: 'add', memoryType: 'key_info', content: 'New fact' }));
  assert.ok(createCandidate({ operation: 'update', memoryType: 'key_info', content: 'Correction', targetMemoryIds: ['one'] }));
  assert.ok(createCandidate({ operation: 'merge', memoryType: 'key_info', content: 'Combined', targetMemoryIds: ['one', 'two'] }));
  assert.ok(createCandidate({ operation: 'scene_patch', scenePatch: { currentGoal: 'Escape' } }));
});

test('rejects unknown scene keys', () => {
  const { normalizeScene, applyScenePatch, createCandidate } = loadModel();

  assert.equal(normalizeScene({ weather: 'rain' }), null);
  assert.equal(applyScenePatch({}, { weather: 'rain' }), null);
  assert.equal(createCandidate({ operation: 'scene_patch', scenePatch: { weather: 'rain' } }), null);
});

test('rejects scene values with incompatible types', () => {
  const { normalizeScene, applyScenePatch, createCandidate } = loadModel();

  assert.equal(normalizeScene({ currentGoal: 42 }), null);
  assert.equal(applyScenePatch({}, { presentCharacters: 'Mira' }), null);
  assert.equal(applyScenePatch({}, { characterStates: ['Mira is alert'] }), null);
  assert.equal(createCandidate({ operation: 'scene_patch', scenePatch: { notes: false } }), null);
});

test('resolve candidates only accept type-compatible result statuses', () => {
  const { createCandidate } = loadModel();
  const base = { operation: 'resolve', targetMemoryIds: ['memory-1'] };

  assert.ok(createCandidate({ ...base, memoryType: 'history_event', resultStatus: 'archived' }));
  assert.equal(createCandidate({ ...base, memoryType: 'history_event', resultStatus: 'resolved' }), null);
  assert.ok(createCandidate({ ...base, memoryType: 'key_info', resultStatus: 'resolved' }));
  assert.ok(createCandidate({ ...base, memoryType: 'key_info', resultStatus: 'invalidated' }));
  assert.equal(createCandidate({ ...base, memoryType: 'key_info', resultStatus: 'archived' }), null);
});

test('formal memory operations add, update, remove, and count pinned content', () => {
  const model = loadModel();
  const initial = [];
  const added = model.addMemory(initial, {
    id: 'memory-one',
    type: 'key_info',
    content: '  Mira knows the route.  ',
    pinned: true,
    source: 'manual',
  }, '2026-08-13T13:00:00.000Z');

  assert.equal(model.PINNED_MEMORY_CHAR_BUDGET, 4000);
  assert.equal(added.ok, true);
  assert.notEqual(added.memories, initial);
  assert.equal(model.getPinnedCharacterCount(added.memories), 21);

  const updated = model.updateMemory(added.memories, 'memory-one', {
    content: 'Mira knows two safe routes.',
    pinned: false,
    source: 'must not replace provenance',
    id: 'must-not-change',
    createdAt: 'must-not-change',
  }, '2026-08-13T14:00:00.000Z');

  assert.equal(updated.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(updated.memories[0])), {
    id: 'memory-one',
    type: 'key_info',
    content: 'Mira knows two safe routes.',
    status: 'active',
    pinned: false,
    createdAt: '2026-08-13T13:00:00.000Z',
    updatedAt: '2026-08-13T14:00:00.000Z',
    source: 'manual',
  });
  assert.equal(model.getPinnedCharacterCount(updated.memories), 0);

  const removed = model.removeMemory(updated.memories, 'memory-one');
  assert.equal(removed.ok, true);
  assert.deepEqual(Array.from(removed.memories), []);
});

test('formal status transitions are type-safe and active restores either memory type', () => {
  const model = loadModel();
  const memories = [
    model.createMemory({ id: 'event', type: 'history_event', content: 'The gate fell.' }, '2026-08-13T10:00:00.000Z'),
    model.createMemory({ id: 'fact', type: 'key_info', content: 'The gate is sealed.' }, '2026-08-13T10:00:00.000Z'),
  ];

  const archived = model.setMemoryStatus(memories, 'event', 'archived', '2026-08-13T11:00:00.000Z');
  assert.equal(archived.ok, true);
  assert.equal(archived.memories[0].status, 'archived');
  const restoredEvent = model.setMemoryStatus(archived.memories, 'event', 'active', '2026-08-13T12:00:00.000Z');
  assert.equal(restoredEvent.memories[0].status, 'active');

  const resolved = model.setMemoryStatus(restoredEvent.memories, 'fact', 'resolved', '2026-08-13T13:00:00.000Z');
  assert.equal(resolved.memories[1].status, 'resolved');
  const invalidated = model.setMemoryStatus(resolved.memories, 'fact', 'invalidated', '2026-08-13T14:00:00.000Z');
  assert.equal(invalidated.memories[1].status, 'invalidated');
  const restoredFact = model.setMemoryStatus(invalidated.memories, 'fact', 'active', '2026-08-13T15:00:00.000Z');
  assert.equal(restoredFact.memories[1].status, 'active');

  const invalid = model.setMemoryStatus(restoredFact.memories, 'event', 'resolved');
  assert.equal(invalid.ok, false);
  assert.equal(invalid.memories, restoredFact.memories);
});

test('failed formal operations preserve the original array reference', () => {
  const model = loadModel();
  const memories = [model.createMemory({ id: 'one', type: 'key_info', content: 'Known.' })];
  const failures = [
    model.addMemory(memories, { type: 'key_info', content: '' }),
    model.addMemory(memories, { id: 'one', type: 'key_info', content: 'Duplicate.' }),
    model.updateMemory(memories, 'missing', { content: 'No.' }),
    model.updateMemory(memories, 'one', { content: '   ' }),
    model.removeMemory(memories, 'missing'),
    model.setMemoryStatus(memories, 'one', 'archived'),
  ];

  failures.forEach(result => {
    assert.equal(result.ok, false);
    assert.equal(result.memories, memories);
    assert.equal(typeof result.error, 'string');
  });
  assert.equal(memories[0].content, 'Known.');
});

test('pinned budget is enforced against final trimmed content before changing arrays', () => {
  const model = loadModel();
  const full = model.addMemory([], {
    id: 'full', type: 'history_event', content: 'x'.repeat(4000), pinned: true,
  });
  assert.equal(full.ok, true);
  assert.equal(model.getPinnedCharacterCount(full.memories), 4000);

  const addFailure = model.addMemory(full.memories, {
    id: 'extra', type: 'key_info', content: 'y', pinned: true,
  });
  assert.equal(addFailure.ok, false);
  assert.equal(addFailure.error, 'PINNED_BUDGET_EXCEEDED');
  assert.equal(addFailure.memories, full.memories);

  const unpinned = model.addMemory(full.memories, {
    id: 'extra', type: 'key_info', content: '  yy  ', pinned: false,
  });
  assert.equal(unpinned.ok, true);
  const updateFailure = model.updateMemory(unpinned.memories, 'extra', { pinned: true });
  assert.equal(updateFailure.ok, false);
  assert.equal(updateFailure.error, 'PINNED_BUDGET_EXCEEDED');
  assert.equal(updateFailure.memories, unpinned.memories);
});

test('over-budget imported memories remain recoverable without allowing pinned growth', () => {
  const model = loadModel();
  const overBudget = [
    model.createMemory({ id: 'a', type: 'key_info', content: 'a'.repeat(3000), pinned: true }),
    model.createMemory({ id: 'b', type: 'key_info', content: 'b'.repeat(2000), pinned: true }),
  ];

  const ordinaryAdd = model.addMemory(overBudget, { id: 'c', type: 'key_info', content: 'ordinary', pinned: false });
  assert.equal(ordinaryAdd.ok, true);
  const unpin = model.updateMemory(overBudget, 'b', { pinned: false });
  assert.equal(unpin.ok, true);
  const shorten = model.updateMemory(overBudget, 'a', { content: 'a'.repeat(2500) });
  assert.equal(shorten.ok, true);
  const remove = model.removeMemory(overBudget, 'a');
  assert.equal(remove.ok, true);

  const grow = model.updateMemory(overBudget, 'a', { content: 'a'.repeat(3100) });
  assert.equal(grow.ok, false);
  assert.equal(grow.error, 'PINNED_BUDGET_EXCEEDED');
  assert.equal(grow.memories, overBudget);
});
