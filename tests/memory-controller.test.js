const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadController() {
  const context = { crypto: { randomUUID: () => 'new-id' }, Date, Math };
  vm.runInNewContext(fs.readFileSync('js/memory/memory-model.js', 'utf8'), context);
  vm.runInNewContext(fs.readFileSync('js/memory/memory-controller.js', 'utf8'), context);
  return context.FonlingMemory;
}

function setup(saveResult = { ok: true, rolledBack: true }) {
  const memory = loadController();
  const state = { ...JSON.parse(JSON.stringify({ currentCharacter: 'Mira', ...{
    memorySchemaVersion: 2, memories: [], currentScene: memory.Model.EMPTY_SCENE,
    memoryCandidates: [], memoryAnalysis: {}, memoryRequestTraces: {},
  } })) };
  const renders = [];
  const warnings = [];
  let saves = 0;
  const ui = { render: snapshot => renders.push(JSON.parse(JSON.stringify(snapshot))), showStorageWarning: msg => warnings.push(msg) };
  const controller = memory.Controller.createMemoryController({
    getState: () => state,
    save: () => { saves += 1; return saveResult; },
    getCharacterName: () => state.currentCharacter,
    ui,
    now: () => '2026-08-13T15:00:00.000Z',
  });
  return { controller, state, renders, warnings, get saves() { return saves; } };
}

function pendingCandidate(memory, input) {
  return memory.Model.createCandidate(input, '2026-08-13T14:00:00.000Z');
}

test('controller commits successful memory operations and renders snapshots', () => {
  const app = setup();
  assert.equal(app.controller.addMemory({ type: 'key_info', content: 'Known.' }).ok, true);
  assert.equal(app.state.memories.length, 1);
  assert.equal(app.saves, 1);
  assert.equal(app.renders.at(-1).characterName, 'Mira');
  assert.equal(app.controller.togglePinned(app.state.memories[0].id).ok, true);
  assert.equal(app.state.memories[0].pinned, true);
  assert.equal(app.controller.deleteMemory(app.state.memories[0].id).ok, true);
  assert.equal(app.state.memories.length, 0);
});

test('controller rolls state back and warns when storage save fails', () => {
  const app = setup({ ok: false, rolledBack: true });
  const before = app.state.memories;
  const result = app.controller.addMemory({ type: 'history_event', content: 'Event.' });
  assert.equal(result.ok, false);
  assert.equal(app.state.memories, before);
  assert.equal(app.state.memories.length, 0);
  assert.equal(app.warnings.length, 1);
});

test('controller applies and clears scene while invalid or over-budget operations do not save', () => {
  const app = setup();
  assert.equal(app.controller.patchScene({ location: ' Vault ', presentCharacters: ['Mira'] }).ok, true);
  assert.equal(app.state.currentScene.location, 'Vault');
  assert.equal(app.controller.clearScene().ok, true);
  assert.equal(app.state.currentScene.location, '');
  const saves = app.saves;
  app.state.memories = [{ id: 'full', type: 'key_info', content: 'x'.repeat(4000), status: 'active', pinned: true,
    createdAt: 'now', updatedAt: 'now' }, { id: 'other', type: 'key_info', content: 'x', status: 'active', pinned: false,
    createdAt: 'now', updatedAt: 'now' }];
  const failure = app.controller.togglePinned('other');
  assert.equal(failure.error, 'PINNED_BUDGET_EXCEEDED');
  assert.equal(app.saves, saves);
  assert.equal(app.warnings.at(-1), '常驻记忆超过4000字，请精简');
  assert.equal(app.renders.at(-1).memories[1].pinned, false);
});

test('controller renders current state and warns safely for invalid model operations without saving', () => {
  const app = setup();
  const result = app.controller.addMemory({ type: 'key_info', content: '   ' });

  assert.equal(result.ok, false);
  assert.equal(app.saves, 0);
  assert.equal(app.warnings.at(-1), '记忆内容无效，未保存');
  assert.deepEqual(app.renders.at(-1).memories, []);
});

test('controller confirms an edited candidate and persists formal data plus removal atomically', () => {
  const app = setup();
  app.state.memoryCandidates = [pendingCandidate(loadController(), {
    id: 'candidate-add', operation: 'add', memoryType: 'history_event', content: '旧内容',
    sourceMessageIds: ['assistant-1'],
  })];

  const result = app.controller.confirmCandidate('candidate-add', {
    memoryType: 'key_info', content: '修改后的事实', pinned: true,
  });

  assert.equal(result.ok, true);
  assert.equal(app.saves, 1);
  assert.equal(app.state.memoryCandidates.length, 0);
  assert.equal(app.state.memories[0].type, 'key_info');
  assert.equal(app.state.memories[0].content, '修改后的事实');
  assert.equal(app.state.memories[0].pinned, true);
});

test('candidate confirmation save failure restores all snapshot branches and keeps candidate pending', () => {
  const app = setup({ ok: false, rolledBack: true });
  const memory = loadController();
  const candidate = pendingCandidate(memory, {
    id: 'scene-change', operation: 'scene_patch', scenePatch: { location: '车站' }, sourceMessageIds: ['assistant-1'],
  });
  app.state.currentScene = memory.Model.normalizeScene({ location: '码头' });
  app.state.memoryCandidates = [candidate];
  const beforeMemories = app.state.memories;
  const beforeScene = app.state.currentScene;
  const beforeCandidates = app.state.memoryCandidates;

  const result = app.controller.confirmCandidate('scene-change');

  assert.equal(result.ok, false);
  assert.equal(result.error, 'STORAGE_SAVE_FAILED');
  assert.equal(app.state.memories, beforeMemories);
  assert.equal(app.state.currentScene, beforeScene);
  assert.equal(app.state.memoryCandidates, beforeCandidates);
  assert.equal(app.state.memoryCandidates[0].id, 'scene-change');
  assert.equal(app.warnings.length, 1);
});

test('controller dismisses one or all pending candidates and never saves on invalid decisions', () => {
  const app = setup();
  const memory = loadController();
  app.state.memoryCandidates = ['a', 'b', 'c'].map(id => pendingCandidate(memory, {
    id, operation: 'add', memoryType: 'key_info', content: id,
  }));
  assert.equal(app.controller.dismissCandidate('b').ok, true);
  assert.deepEqual(app.state.memoryCandidates.map(item => item.id), ['a', 'c']);
  assert.equal(app.controller.dismissAllCandidates().ok, true);
  assert.deepEqual(app.state.memoryCandidates, []);
  assert.equal(app.saves, 2);

  const saves = app.saves;
  const invalid = app.controller.confirmCandidate('missing');
  assert.equal(invalid.ok, false);
  assert.equal(app.saves, saves);
  assert.equal(app.warnings.length, 1);
});

test('stale candidate actions cannot affect a newly selected character even when candidate ids collide', () => {
  const memory = loadController();
  const states = {
    Mira: {
      currentCharacter: 'Mira', memorySnapshotIdentity: 'mira-snapshot', memories: [],
      currentScene: memory.Model.EMPTY_SCENE,
      memoryCandidates: [pendingCandidate(memory, { id: 'same-id', operation: 'add', memoryType: 'key_info', content: 'Mira fact' })],
    },
    Ning: {
      currentCharacter: 'Ning', memorySnapshotIdentity: 'ning-snapshot', memories: [],
      currentScene: memory.Model.EMPTY_SCENE,
      memoryCandidates: [pendingCandidate(memory, { id: 'same-id', operation: 'add', memoryType: 'key_info', content: 'Ning fact' })],
    },
  };
  let selected = 'Ning';
  let saves = 0;
  const renders = [];
  const controller = memory.Controller.createMemoryController({
    getState: () => states[selected],
    getCharacterName: () => selected,
    save: () => { saves += 1; return { ok: true, rolledBack: true }; },
    ui: { render: value => renders.push(value), showStorageWarning() {} },
    now: () => '2026-08-13T15:00:00.000Z',
  });

  const staleContext = { characterName: 'Mira', snapshotIdentity: 'mira-snapshot' };
  assert.equal(controller.confirmCandidate('same-id', undefined, staleContext).error, 'STALE_CHARACTER');
  assert.equal(controller.dismissCandidate('same-id', staleContext).error, 'STALE_CHARACTER');
  assert.equal(controller.dismissAllCandidates(['same-id'], staleContext).error, 'STALE_CHARACTER');
  assert.equal(saves, 0);
  assert.equal(states.Ning.memoryCandidates.length, 1);
  assert.equal(states.Ning.memories.length, 0);
  assert.equal(renders.at(-1).characterName, 'Ning');
});
