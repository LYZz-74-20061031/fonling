const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadStorage(overrides = {}) {
  const context = {
    console,
    Date,
    Math,
    JSON,
    TextEncoder,
    ...overrides,
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('js/memory/memory-model.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('js/memory/memory-storage.js', 'utf8'), context);
  return context.FonlingMemory.Storage;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function extractFunction(html, name) {
  const source = html.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`))?.[0];
  assert.ok(source, `${name} must exist in index.html`);
  return source;
}

function loadPersistenceHarness(initialEntries = {}, storageOverride) {
  const html = fs.readFileSync('index.html', 'utf8');
  const storage = new Map(Object.entries(initialEntries));
  const writes = [];
  const state = {
    currentCharacter: '',
    apiKey: '', systemPrompt: '', style: '', userIdentity: '', bgImage: '', summary: '',
    historyEvents: [], keyInfo: [], roles: [], currentRole: null, currentState: '', messages: [],
    ...plain(loadStorage().createEmptyMemoryState()),
  };
  const Storage = storageOverride || loadStorage();
  const context = {
    state,
    FonlingMemory: { Storage },
    LS: { CHAR_PREFIX: 'ai_char_', CHAR_LIST: 'ai_char_list', CURRENT_CHAR: 'ai_current_char' },
    localStorage: {
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
      setItem(key, value) { storage.set(key, String(value)); writes.push({ key, value: String(value) }); },
      removeItem(key) { storage.delete(key); },
    },
    addSystemMsg() {},
    getCharacterList() { return []; }, saveCharacterList() { return { ok: true, rolledBack: true }; },
    conversationRequestEpoch: 0, summaryRequestEpoch: 0, backgroundOperationEpoch: 0, characterSelectionEpoch: 0,
    hideLoginScreen() {}, syncSettingsUI() {}, applyBackground() {}, renderMessages() {}, showLoginScreen() {},
    document: {
      getElementById() { return { textContent: '' }; },
      querySelector() { return { textContent: '' }; },
    },
  };
  const declarations = html.match(/(?:var|let) loadedCharacterSettings[^;]*;/)?.[0] || '';
  const functions = [
    'getCharDataKey', 'getCharMsgKey', 'loadCharacterData', 'saveCurrentCharacter', 'reportSaveFailure',
    'storageMutationResult', 'updateCurrentCharacterSelection', 'characterMutationIsBlocked',
    'loginCharacter', 'createCharacter', 'switchCharacter', 'init',
  ].map(name => extractFunction(html, name)).join('\n');
  vm.runInNewContext(`${declarations}\n${functions}\nthis.api = { loadCharacterData, saveCurrentCharacter, loginCharacter, createCharacter, switchCharacter, init, getSnapshot: function() { return loadedCharacterSettings; } };`, context);
  return { context, state, storage, writes, api: context.api };
}

test('migrates a legacy character without losing settings or message content', () => {
  const Storage = loadStorage();
  const settings = {
    apiKey: 'sk-secret',
    systemPrompt: 'Character prompt',
    style: 'concise',
    userIdentity: 'traveler',
    bgImage: 'data:image/png;base64,abc',
    summary: 'Earlier story',
    roles: [{ name: 'Ari', bio: 'guide', color: '#123456' }],
    currentRole: 'Ari',
    historyEvents: ['Met at the harbor', 'Found the map'],
    keyInfo: ['The gate opens at dawn'],
    currentState: 'Waiting beside the north gate',
    customSetting: { retained: true },
  };
  const messages = [
    { role: 'user', content: 'Hello', custom: { untouched: true } },
    { id: 'existing-message', role: 'assistant', content: 'Welcome' },
  ];
  let sequence = 0;

  const result = Storage.migrateCharacterData(settings, messages, {
    createId(prefix) { sequence += 1; return `${prefix}-${sequence}`; },
    now: '2026-08-13T09:00:00.000Z',
  });

  assert.equal(result.changed, true);
  const { historyEvents, keyInfo, currentState, ...retainedSettings } = settings;
  assert.deepEqual(plain(result.settings), {
    ...retainedSettings,
    memorySchemaVersion: 2,
    memories: [
      {
        id: 'memory-1', type: 'history_event', content: 'Met at the harbor', status: 'active',
        pinned: false, createdAt: '2026-08-13T09:00:00.000Z', updatedAt: '2026-08-13T09:00:00.000Z', source: 'migration',
      },
      {
        id: 'memory-2', type: 'history_event', content: 'Found the map', status: 'active',
        pinned: false, createdAt: '2026-08-13T09:00:00.000Z', updatedAt: '2026-08-13T09:00:00.000Z', source: 'migration',
      },
      {
        id: 'memory-3', type: 'key_info', content: 'The gate opens at dawn', status: 'active',
        pinned: false, createdAt: '2026-08-13T09:00:00.000Z', updatedAt: '2026-08-13T09:00:00.000Z', source: 'migration',
      },
    ],
    currentScene: {
      time: '', location: '', presentCharacters: [], currentGoal: '', currentConflict: '',
      characterStates: '', environment: '', notes: 'Waiting beside the north gate',
      updatedAt: '2026-08-13T09:00:00.000Z',
    },
    memoryCandidates: [],
    memoryAnalysis: { analyzedTurnKeys: [], lastFailure: null, activeCharacter: null },
    memoryRequestTraces: {},
  });
  assert.deepEqual(plain(result.messages), [
    { id: 'message-4', role: 'user', content: 'Hello', custom: { untouched: true } },
    { id: 'existing-message', role: 'assistant', content: 'Welcome' },
  ]);
  assert.deepEqual(plain(result.diagnostics), []);
});

test('legacy inputs migrate without retaining retired fields in version 2 settings', () => {
  const storage = loadStorage();
  const result = storage.migrateCharacterData({
    historyEvents: ['Met at the harbor'],
    keyInfo: ['Gate opens at dawn'],
    currentState: 'At the gate',
    roles: [{ name: 'Ari' }],
  }, []);

  assert.equal(Object.prototype.hasOwnProperty.call(result.settings, 'historyEvents'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result.settings, 'keyInfo'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result.settings, 'currentState'), false);
  assert.deepEqual(plain(result.settings.roles), [{ name: 'Ari' }]);
  assert.deepEqual(plain(result.settings.memories.map(memory => memory.content)), ['Met at the harbor', 'Gate opens at dawn']);
  assert.equal(result.settings.currentScene.notes, 'At the gate');
});

test('migration diagnoses imported pinned memories over the character budget', () => {
  const storage = loadStorage();
  const result = storage.migrateCharacterData({
    memorySchemaVersion: 2,
    memories: [
      { id: 'a', type: 'key_info', content: 'a'.repeat(3000), status: 'active', pinned: true },
      { id: 'b', type: 'key_info', content: 'b'.repeat(2000), status: 'active', pinned: true },
    ],
  }, []);

  assert.ok(result.diagnostics.some(item => item.code === 'pinned_budget_exceeded'));
  assert.equal(result.settings.memories.length, 2);
});

test('normalizes valid version 2 data idempotently without migrating legacy fields again', () => {
  const Storage = loadStorage();
  const settings = {
    memorySchemaVersion: 2,
    historyEvents: ['must not be duplicated'],
    keyInfo: ['must not be duplicated'],
    currentState: 'must not replace the scene',
    memories: [{
      id: 'memory-1', type: 'history_event', content: 'Already migrated', status: 'active', pinned: false,
      createdAt: '2026-08-12T00:00:00.000Z', updatedAt: '2026-08-12T00:00:00.000Z', source: 'migration',
    }],
    currentScene: {
      time: '', location: '', presentCharacters: [], currentGoal: '', currentConflict: '', characterStates: '',
      environment: '', notes: 'Canonical scene', updatedAt: '2026-08-12T00:00:00.000Z',
    },
    memoryCandidates: [],
    memoryAnalysis: { analyzedTurnKeys: ['user-1|assistant-1'], lastFailure: null, activeCharacter: 'Ari' },
    memoryRequestTraces: { request1: { status: 'ok' } },
  };
  const messages = [{ id: 'message-1', role: 'user', content: 'Hi' }];

  const first = Storage.migrateCharacterData(settings, messages, { createId() { throw new Error('must not create IDs'); } });
  const second = Storage.migrateCharacterData(first.settings, first.messages, { createId() { throw new Error('must not create IDs'); } });

  assert.equal(first.changed, false);
  assert.equal(second.changed, false);
  assert.deepEqual(plain(second), plain(first));
  assert.equal(first.settings.memories.length, 1);
  assert.equal(first.settings.currentScene.notes, 'Canonical scene');
});

test('uses injected ID and time providers when version 2 records need defaults', () => {
  const Storage = loadStorage();
  let sequence = 0;
  const result = Storage.migrateCharacterData({
    memorySchemaVersion: 2,
    memories: [{ type: 'key_info', content: 'A fact' }],
    memoryCandidates: [{ operation: 'add', memoryType: 'key_info', content: 'A candidate' }],
  }, [], {
    createId(prefix) { sequence += 1; return `${prefix}-injected-${sequence}`; },
    now() { return '2026-08-13T10:00:00.000Z'; },
  });

  assert.equal(result.settings.memories[0].id, 'memory-injected-1');
  assert.equal(result.settings.memories[0].createdAt, '2026-08-13T10:00:00.000Z');
  assert.equal(result.settings.memoryCandidates[0].id, 'candidate-injected-2');
  assert.equal(result.settings.memoryCandidates[0].createdAt, '2026-08-13T10:00:00.000Z');
});

test('disambiguates duplicate memory and candidate IDs despite generator collisions, then stays idempotent', () => {
  const Storage = loadStorage();
  const scene = plain(Storage.createEmptyMemoryState().currentScene);
  const settings = {
    memorySchemaVersion: 2,
    currentScene: scene,
    memories: [
      { id: 'duplicate', type: 'key_info', content: 'first', status: 'active', pinned: false, createdAt: 't', updatedAt: 't' },
      { id: 'duplicate', type: 'key_info', content: 'second', status: 'active', pinned: false, createdAt: 't', updatedAt: 't' },
      { id: 'memory-generated', type: 'key_info', content: 'reserved', status: 'active', pinned: false, createdAt: 't', updatedAt: 't' },
    ],
    memoryCandidates: [
      { id: 'candidate-duplicate', operation: 'add', memoryType: 'key_info', content: 'first', status: 'pending', sourceMessageIds: [], conflict: false, possibleConflict: false, createdAt: 't', updatedAt: 't' },
      { id: 'candidate-duplicate', operation: 'add', memoryType: 'key_info', content: 'second', status: 'pending', sourceMessageIds: [], conflict: false, possibleConflict: false, createdAt: 't', updatedAt: 't' },
      { id: 'candidate-generated', operation: 'add', memoryType: 'key_info', content: 'reserved', status: 'pending', sourceMessageIds: [], conflict: false, possibleConflict: false, createdAt: 't', updatedAt: 't' },
    ],
  };
  const generated = { memory: ['memory-generated', 'memory-unique'], candidate: ['candidate-generated', 'candidate-unique'] };
  const first = Storage.migrateCharacterData(settings, [], {
    createId(prefix) { return generated[prefix].shift(); },
  });

  assert.deepEqual(plain(first.settings.memories.map(item => item.id)), ['duplicate', 'memory-unique', 'memory-generated']);
  assert.deepEqual(plain(first.settings.memoryCandidates.map(item => item.id)), ['candidate-duplicate', 'candidate-unique', 'candidate-generated']);
  assert.ok(first.diagnostics.some(item => item.code === 'duplicate_id' && item.path === 'memories[1].id'));
  assert.ok(first.diagnostics.some(item => item.code === 'duplicate_id' && item.path === 'memoryCandidates[1].id'));

  const second = Storage.migrateCharacterData(first.settings, first.messages, {
    createId() { throw new Error('idempotent migration must not create IDs'); },
  });
  assert.equal(second.changed, false);
  assert.deepEqual(plain(second.settings), plain(first.settings));
  assert.deepEqual(plain(second.messages), plain(first.messages));
  assert.deepEqual(plain(second.diagnostics), []);
});

test('does not downgrade unsupported future schema data', () => {
  const Storage = loadStorage();
  const settings = { memorySchemaVersion: 3, customSetting: { future: true }, memories: [{ futureShape: true }] };
  const messages = [{ id: 'future-message', role: 'user', content: 'future' }];

  const result = Storage.migrateCharacterData(settings, messages);

  assert.equal(result.supported, false);
  assert.equal(result.changed, false);
  assert.deepEqual(plain(result.settings), settings);
  assert.deepEqual(plain(result.messages), messages);
  assert.ok(result.diagnostics.some(item => item.code === 'unsupported_future_schema'));
  result.settings.customSetting.future = false;
  assert.equal(settings.customSetting.future, true);
});

test('skips invalid legacy entries with diagnostics while retaining valid siblings', () => {
  const Storage = loadStorage();
  let sequence = 0;
  const result = Storage.migrateCharacterData({
    historyEvents: [' valid event ', null, '', { content: 'invalid' }, 'second event'],
    keyInfo: [42, ' valid fact '],
    currentState: 99,
  }, [{ role: 'user', content: 'kept' }, null, 'bad message'], {
    createId(prefix) { sequence += 1; return `${prefix}-${sequence}`; },
    now: '2026-08-13T09:00:00.000Z',
  });

  assert.deepEqual(plain(result.settings.memories.map(item => item.content)), ['valid event', 'second event', 'valid fact']);
  assert.deepEqual(plain(result.messages), [{ id: 'message-4', role: 'user', content: 'kept' }]);
  assert.ok(result.diagnostics.length >= 6);
  assert.ok(result.diagnostics.some(item => item.path === 'historyEvents[1]'));
  assert.ok(result.diagnostics.some(item => item.path === 'keyInfo[0]'));
  assert.ok(result.diagnostics.some(item => item.path === 'currentState'));
  assert.ok(result.diagnostics.some(item => item.path === 'messages[1]'));
});

test('never mutates settings, messages, or their nested values', () => {
  const Storage = loadStorage();
  const settings = { memorySchemaVersion: 2, roles: [{ name: 'Ari' }], memories: [], memoryRequestTraces: { x: { nested: true } } };
  const messages = [{ id: 'm1', role: 'user', content: 'hi', meta: { nested: true } }];
  const beforeSettings = JSON.stringify(settings);
  const beforeMessages = JSON.stringify(messages);

  const result = Storage.migrateCharacterData(settings, messages);
  result.settings.roles[0].name = 'changed';
  result.settings.memoryRequestTraces.x.nested = false;
  result.messages[0].meta.nested = false;

  assert.equal(JSON.stringify(settings), beforeSettings);
  assert.equal(JSON.stringify(messages), beforeMessages);
});

test('creates independent empty/default memory state', () => {
  const Storage = loadStorage();
  const first = Storage.createEmptyMemoryState();
  const second = Storage.createEmptyMemoryState();

  assert.deepEqual(plain(first), {
    memorySchemaVersion: 2,
    memories: [],
    currentScene: {
      time: '', location: '', presentCharacters: [], currentGoal: '', currentConflict: '', characterStates: '',
      environment: '', notes: '', updatedAt: '',
    },
    memoryCandidates: [],
    memoryAnalysis: { analyzedTurnKeys: [], lastFailure: null, activeCharacter: null },
    memoryRequestTraces: {},
  });
  first.memories.push({});
  first.currentScene.presentCharacters.push('Ari');
  assert.deepEqual(plain(second.memories), []);
  assert.deepEqual(plain(second.currentScene.presentCharacters), []);
});

test('serializeMemoryState returns only cloned structured-memory fields', () => {
  const Storage = loadStorage();
  const state = {
    apiKey: 'omit',
    ...Storage.createEmptyMemoryState(),
    memories: [{ id: 'm1', nested: { value: true } }],
    memoryRequestTraces: { r1: { request: ['x'] } },
  };
  const serialized = Storage.serializeMemoryState(state);

  assert.deepEqual(Object.keys(serialized).sort(), [
    'currentScene', 'memories', 'memoryAnalysis', 'memoryCandidates', 'memoryRequestTraces', 'memorySchemaVersion',
  ]);
  serialized.memories[0].nested.value = false;
  serialized.memoryRequestTraces.r1.request.push('changed');
  assert.equal(state.memories[0].nested.value, true);
  assert.deepEqual(state.memoryRequestTraces.r1.request, ['x']);
});

test('estimateSerializedBytes counts UTF-8 bytes and supports the documented fallback', () => {
  assert.equal(loadStorage().estimateSerializedBytes('😀'), 6); // JSON string includes two quote bytes.
  const fallback = loadStorage({ TextEncoder: undefined });
  assert.equal(fallback.estimateSerializedBytes({ text: 'ab' }), JSON.stringify({ text: 'ab' }).length * 2);
});

test('isQuotaExceededError recognizes common browser quota names and codes', () => {
  const Storage = loadStorage();
  assert.equal(Storage.isQuotaExceededError({ name: 'QuotaExceededError' }), true);
  assert.equal(Storage.isQuotaExceededError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' }), true);
  assert.equal(Storage.isQuotaExceededError({ code: 22 }), true);
  assert.equal(Storage.isQuotaExceededError({ code: 1014 }), true);
  assert.equal(Storage.isQuotaExceededError(new Error('disk failed')), false);
  assert.equal(Storage.isQuotaExceededError(null), false);
});

test('index loads memory scripts before the inline app', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const modelIndex = html.indexOf('<script src="js/memory/memory-model.js"></script>');
  const storageIndex = html.indexOf('<script src="js/memory/memory-storage.js"></script>');
  const appIndex = html.indexOf('<script>');
  assert.ok(modelIndex >= 0 && modelIndex < storageIndex && storageIndex < appIndex);

});

test('load migration executes one data write and preserves unknown nested settings and messages', () => {
  const oldSettings = {
    apiKey: 'legacy-key', systemPrompt: 'prompt', style: 'style', userIdentity: 'identity',
    bgImage: 'image', summary: 'summary', roles: [{ name: 'Ari' }], currentRole: 'Ari',
    historyEvents: ['Met at the harbor'], keyInfo: ['Gate opens at dawn'], currentState: 'At the gate',
    customSetting: { nested: { retained: true } },
  };
  const harness = loadPersistenceHarness({
    ai_char_ari_data: JSON.stringify(oldSettings),
    ai_char_ari_msg: JSON.stringify([{ role: 'user', content: 'Hello' }]),
  });
  harness.state.currentCharacter = 'Ari';

  harness.api.loadCharacterData('Ari');

  const dataWrites = harness.writes.filter(write => write.key === 'ai_char_ari_data');
  const messageWrites = harness.writes.filter(write => write.key === 'ai_char_ari_msg');
  assert.equal(dataWrites.length, 1);
  assert.equal(messageWrites.length, 1);
  const saved = JSON.parse(dataWrites[0].value);
  const savedMessages = JSON.parse(messageWrites[0].value);
  assert.deepEqual(saved.customSetting, oldSettings.customSetting);
  assert.equal(saved.apiKey, oldSettings.apiKey);
  assert.deepEqual(saved.roles, oldSettings.roles);
  assert.equal(saved.memorySchemaVersion, 2);
  assert.deepEqual(saved.memories.map(memory => memory.content), ['Met at the harbor', 'Gate opens at dawn']);
  assert.equal(saved.currentScene.notes, 'At the gate');
  assert.equal(savedMessages[0].content, 'Hello');
  assert.match(savedMessages[0].id, /^message_/);
});

test('loaded settings snapshots do not leak across switched or newly created characters', () => {
  const emptyMemory = plain(loadStorage().createEmptyMemoryState());
  const harness = loadPersistenceHarness({
    ai_char_ari_data: JSON.stringify({ customSetting: { owner: 'Ari' } }),
    ai_char_ari_msg: '[]',
    ai_char_bob_data: JSON.stringify({ memorySchemaVersion: 2, customSetting: { owner: 'Bob' }, ...emptyMemory }),
    ai_char_bob_msg: '[]',
  });

  harness.state.currentCharacter = 'Ari';
  harness.api.loadCharacterData('Ari');
  harness.api.switchCharacter();
  harness.state.currentCharacter = 'Bob';
  harness.api.loadCharacterData('Bob');
  harness.state.style = 'updated';
  harness.api.saveCurrentCharacter();

  const bobSaved = JSON.parse(harness.storage.get('ai_char_bob_data'));
  assert.deepEqual(bobSaved.customSetting, { owner: 'Bob' });
  assert.equal(bobSaved.style, 'updated');
  assert.equal(JSON.stringify(bobSaved).includes('Ari'), false);

  harness.api.createCharacter('Cara');
  const caraSaved = JSON.parse(harness.storage.get('ai_char_cara_data'));
  assert.equal(Object.prototype.hasOwnProperty.call(caraSaved, 'customSetting'), false);
  assert.deepEqual(caraSaved.memories, []);
});

test('failed character loads are atomic for invalid JSON and migration failures', () => {
  const cases = [
    { name: 'broken settings JSON', entries: { ai_char_target_data: '{', ai_char_target_msg: '[]' } },
    { name: 'broken messages JSON', entries: { ai_char_target_data: '{}', ai_char_target_msg: '[' } },
    { name: 'migration throws', entries: { ai_char_target_data: '{}', ai_char_target_msg: '[]' }, throwMigration: true },
  ];

  for (const item of cases) {
    const realStorage = loadStorage();
    const storageApi = item.throwMigration
      ? { ...realStorage, migrateCharacterData() { throw new Error('migration failed'); } }
      : realStorage;
    const harness = loadPersistenceHarness(item.entries, storageApi);
    Object.assign(harness.state, {
      currentCharacter: 'Current', apiKey: 'keep-key', messages: [{ id: 'keep', content: 'keep' }],
      memories: [{ id: 'keep-memory' }], currentScene: { notes: 'keep-scene' },
    });
    const beforeState = JSON.stringify(harness.state);
    const beforeStorage = JSON.stringify([...harness.storage.entries()]);
    const beforeSnapshot = JSON.stringify(harness.api.getSnapshot());

    assert.equal(harness.api.loadCharacterData('Target'), false, item.name);
    assert.equal(JSON.stringify(harness.state), beforeState, item.name);
    assert.equal(JSON.stringify([...harness.storage.entries()]), beforeStorage, item.name);
    assert.equal(JSON.stringify(harness.api.getSnapshot()), beforeSnapshot, item.name);
    assert.equal(harness.writes.filter(write => write.key.startsWith('ai_char_target_')).length, 0, item.name);
  }
});

test('future schema load is rejected atomically without writing it back', () => {
  const harness = loadPersistenceHarness({
    ai_char_future_data: JSON.stringify({ memorySchemaVersion: 3, customSetting: { future: true } }),
    ai_char_future_msg: JSON.stringify([{ id: 'future-message', content: 'future' }]),
  });
  Object.assign(harness.state, { currentCharacter: 'Current', apiKey: 'keep', messages: [{ id: 'keep' }] });
  const beforeState = JSON.stringify(harness.state);
  const beforeStorage = JSON.stringify([...harness.storage.entries()]);

  assert.equal(harness.api.loadCharacterData('Future'), false);
  assert.equal(JSON.stringify(harness.state), beforeState);
  assert.equal(JSON.stringify([...harness.storage.entries()]), beforeStorage);
  assert.equal(harness.writes.length, 0);
});

test('login and startup do not select a character or advance UI when loading fails', () => {
  const harness = loadPersistenceHarness({
    ai_char_list: JSON.stringify(['Target']),
    ai_current_char: 'Target',
    ai_char_target_data: '{',
    ai_char_target_msg: '[]',
  });
  const uiCalls = [];
  harness.context.getCharacterList = () => ['Target'];
  harness.context.hideLoginScreen = () => uiCalls.push('hide');
  harness.context.syncSettingsUI = () => uiCalls.push('sync');
  harness.context.applyBackground = () => uiCalls.push('background');
  harness.context.renderMessages = () => uiCalls.push('render');
  harness.context.updateIdentityBar = () => uiCalls.push('identity');
  harness.context.showLoginScreen = () => uiCalls.push('show');

  harness.api.loginCharacter('Target');
  assert.equal(harness.state.currentCharacter, '');
  assert.equal(harness.writes.filter(write => write.key === 'ai_current_char').length, 0);
  assert.deepEqual(uiCalls, []);

  harness.api.init();
  assert.equal(harness.state.currentCharacter, '');
  assert.deepEqual(uiCalls, ['show']);
});
