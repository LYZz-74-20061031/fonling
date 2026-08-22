const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function plain(value) { return JSON.parse(JSON.stringify(value)); }

function extractFunction(html, name) {
  const source = html.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`))?.[0];
  assert.ok(source, `${name} must exist in index.html`);
  return source;
}

function loadStorage(overrides = {}) {
  const context = { console, Date, Math, JSON, TextEncoder, ...overrides };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('js/memory/memory-model.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('js/memory/memory-storage.js', 'utf8'), context);
  return context.FonlingMemory.Storage;
}

function baseState() {
  return {
    currentCharacter: 'Ari',
    apiKey: 'old-key', systemPrompt: 'old-prompt', style: 'old-style', userIdentity: 'old-user',
    bgImage: 'old-image', summary: 'old-summary', historyEvents: ['old-event'], keyInfo: ['old-fact'],
    roles: [{ name: 'Old', color: '#000000', bio: 'old' }], currentRole: 'Old', currentState: 'old-state',
    messages: [{ id: 'old-message', role: 'user', content: 'old' }],
    memorySchemaVersion: 2, memories: [],
    currentScene: { time: '', location: '', presentCharacters: [], currentGoal: '', currentConflict: '', characterStates: '', environment: '', notes: 'old-scene', updatedAt: '' },
    memoryCandidates: [], memoryAnalysis: { analyzedTurnKeys: [], lastFailure: null, activeCharacter: null },
    memoryRequestTraces: {}, isStreaming: false, summarising: false,
  };
}

function loadHarness(options = {}) {
  const html = fs.readFileSync('index.html', 'utf8');
  const entries = new Map(Object.entries(options.entries || {
    ai_char_ari_data: 'before-settings-bytes', ai_char_ari_msg: 'before-messages-bytes', untouched: 'keep-verbatim',
  }));
  const writes = [], uiCalls = [], messages = [], warnings = [];
  let setItemAttempts = 0;
  const state = plain(options.state || baseState());
  const storageApi = options.storage || loadStorage();
  class FakeFileReader { readAsText(file) { this.onload({ target: { result: file.contents } }); } }
  const context = {
    state, JSON, Date, FileReader: FakeFileReader, FonlingMemory: { Storage: storageApi },
    LS: { CHAR_PREFIX: 'ai_char_', CHAR_LIST: 'ai_char_list', CURRENT_CHAR: 'ai_current_char' },
    localStorage: {
      getItem(key) { return entries.has(key) ? entries.get(key) : null; },
      setItem(key, value) {
        setItemAttempts += 1;
        const failedAttempts = Array.isArray(options.failSetItemAt) ? options.failSetItemAt : [options.failSetItemAt];
        if (failedAttempts.includes(setItemAttempts)) throw new Error('injected storage failure');
        entries.set(key, String(value)); writes.push([key, String(value)]);
      },
      removeItem(key) { entries.delete(key); },
    },
    syncSettingsUI() {
      uiCalls.push('sync');
      if (options.throwUiAt === 'sync') throw new Error('injected UI failure');
    }, updateIdentityBar() { uiCalls.push('identity'); },
    applyBackground() { uiCalls.push('background'); }, renderMessages() { uiCalls.push('render'); },
    settingsOverlay: { classList: { remove(value) { uiCalls.push(`close:${value}`); } } },
    addSystemMsg(text, isError) { messages.push({ text, isError }); },
    memoryUI: { showStorageWarning(details) { warnings.push(details); } },
    characterMutationIsBlocked() { return false; },
    characterSelectionEpoch: 0, conversationRequestEpoch: 0, summaryRequestEpoch: 0, backgroundOperationEpoch: 0,
  };
  const declarations = html.match(/(?:var|let) loadedCharacterSettings[^;]*;/)?.[0] || '';
  const functions = ['getCharDataKey', 'getCharMsgKey', 'saveCurrentCharacter', 'reportSaveFailure', 'buildExportData', 'normalizeImportedCharacter', 'importData']
    .map(name => extractFunction(html, name)).join('\n');
  vm.runInNewContext(`${declarations}\n${functions}\nthis.api = {
    buildExportData, normalizeImportedCharacter, importData, realSave: saveCurrentCharacter,
    getSnapshot: function() { return loadedCharacterSettings; }, setSnapshot: function(value) { loadedCharacterSettings = value; }
  };`, context);
  let saveCount = 0;
  context.saveCurrentCharacter = function() { saveCount += 1; return context.api.realSave(); };
  context.api.setSnapshot(plain(options.snapshot || { oldOnly: { owner: 'old-character' } }));
  return { context, state, entries, writes, uiCalls, messages, warnings, api: context.api, getSaveCount: () => saveCount };
}

function version2Backup() {
  return {
    schemaVersion: 2, export_version: 2, exported_at: '2026-08-13T08:00:00.000Z',
    settings: {
      apiKey: 'new-key', systemPrompt: 'new-prompt', style: 'new-style', userIdentity: 'new-user', bgImage: 'new-image',
      summary: 'new-summary', historyEvents: ['new-event'], keyInfo: ['new-fact'],
      roles: [{ name: 'Hero', color: '#FF6B6B', bio: 'lead' }], currentRole: 'Hero', currentState: 'new-state',
      memorySchemaVersion: 2,
      memories: [{ id: 'memory-1', type: 'key_info', content: 'Keepsake', status: 'active', pinned: true, createdAt: 't1', updatedAt: 't2' }],
      currentScene: { time: 'dawn', location: 'gate', presentCharacters: ['Hero'], currentGoal: 'enter', currentConflict: '', characterStates: 'ready', environment: 'fog', notes: 'wait', updatedAt: 't3' },
      memoryCandidates: [{ id: 'candidate-1', operation: 'add', memoryType: 'history_event', content: 'Arrived', targetMemoryIds: [], status: 'pending', sourceMessageIds: ['message-1'], conflict: false, possibleConflict: false, createdAt: 't4', updatedAt: 't4' }],
      memoryAnalysis: { analyzedTurnKeys: ['turn-1'], lastFailure: { reason: 'retry' }, activeCharacter: 'Hero' },
      memoryRequestTraces: { request1: { phase: 'analysis' } }, importedOnly: { nested: true },
    },
    messages: [{ id: 'message-1', role: 'user', content: 'Open the gate', meta: { trace: true } }],
  };
}

function loadExportHarness() {
  const html = fs.readFileSync('index.html', 'utf8');
  const calls = [];
  const anchors = [];
  const helperResult = {
    schemaVersion: 2,
    export_version: 2,
    exported_at: '2026-08-13T12:34:56.000Z',
    settings: { currentCharacterOnly: true },
    messages: [{ id: 'only-current-message' }],
  };
  class FakeBlob {
    constructor(parts, options) { this.parts = parts; this.options = options; }
  }
  const context = {
    state: { currentCharacter: 'Ari', forbiddenOtherCharacters: ['Bob'] },
    Date,
    JSON,
    Blob: FakeBlob,
    URL: {
      createObjectURL(blob) { calls.push(['create-url', blob]); return 'blob:export'; },
      revokeObjectURL(url) { calls.push(['revoke-url', url]); },
    },
    document: {
      createElement(tag) {
        assert.equal(tag, 'a');
        const anchor = { click() { calls.push(['click']); } };
        anchors.push(anchor);
        return anchor;
      },
      body: {
        appendChild(anchor) { calls.push(['append', anchor]); },
        removeChild(anchor) { calls.push(['remove', anchor]); },
      },
    },
    buildExportData(source, now) {
      calls.push(['build', source, now]);
      return helperResult;
    },
  };
  vm.runInNewContext(`${extractFunction(html, 'exportAllData')}; this.exportAllData = exportAllData;`, context);
  return { context, calls, anchors, helperResult };
}

test('exportAllData uses buildExportData once and downloads only its single-character payload', () => {
  const harness = loadExportHarness();

  harness.context.exportAllData();

  const buildCalls = harness.calls.filter(call => call[0] === 'build');
  assert.equal(buildCalls.length, 1);
  assert.equal(buildCalls[0][1], harness.context.state);
  assert.ok(buildCalls[0][2] instanceof Date);
  const blob = harness.calls.find(call => call[0] === 'create-url')[1];
  assert.deepEqual(JSON.parse(blob.parts[0]), harness.helperResult);
  assert.equal(blob.options.type, 'application/json');
  assert.equal(harness.anchors[0].download, 'ai-chat-backup-2026-08-13.json');
  assert.equal(JSON.stringify(blob.parts).includes('Bob'), false);
  assert.deepEqual(harness.calls.map(call => call[0]), ['build', 'create-url', 'append', 'click', 'remove', 'revoke-url']);
});

test('buildExportData creates a version 2 single-character snapshot that round-trips structured memory', () => {
  const harness = loadHarness();
  Object.assign(harness.state, plain(version2Backup().settings), { messages: plain(version2Backup().messages) });
  const exported = harness.api.buildExportData(harness.state, () => '2026-08-13T09:30:00.000Z');
  const normalized = harness.api.normalizeImportedCharacter(exported);
  assert.equal(exported.schemaVersion, 2); assert.equal(exported.export_version, 2);
  assert.equal(exported.exported_at, '2026-08-13T09:30:00.000Z');
  assert.equal(Object.prototype.hasOwnProperty.call(exported, 'characters'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(exported.settings, 'currentCharacter'), false);
  assert.deepEqual(plain(normalized.settings.memories), plain(harness.state.memories));
  assert.deepEqual(plain(normalized.settings.currentScene), plain(harness.state.currentScene));
  assert.deepEqual(plain(normalized.settings.memoryCandidates), plain(harness.state.memoryCandidates));
  assert.deepEqual(plain(normalized.settings.memoryAnalysis), plain(harness.state.memoryAnalysis));
  assert.deepEqual(plain(normalized.settings.memoryRequestTraces), plain(harness.state.memoryRequestTraces));
  assert.deepEqual(plain(normalized.messages), plain(harness.state.messages));
  assert.equal(exported.settings.apiKey, harness.state.apiKey); assert.equal(exported.settings.currentRole, harness.state.currentRole);
});

test('buildExportData deeply copies settings, memory data, and messages', () => {
  const harness = loadHarness();
  const exported = harness.api.buildExportData(harness.state, '2026-08-13T09:30:00.000Z');
  exported.settings.roles[0].name = 'Changed'; exported.settings.currentScene.notes = 'Changed'; exported.messages[0].content = 'Changed';
  assert.equal(harness.state.roles[0].name, 'Old'); assert.equal(harness.state.currentScene.notes, 'old-scene');
  assert.equal(harness.state.messages[0].content, 'old');
});

test('saveCurrentCharacter restores both raw storage values when the second write fails', () => {
  const harness = loadHarness({ failSetItemAt: 2 });
  const beforeEntries = JSON.stringify([...harness.entries]);
  const beforeSnapshot = JSON.stringify(harness.api.getSnapshot());
  harness.state.apiKey = 'changed-key';
  harness.state.messages = [{ id: 'changed-message', role: 'user', content: 'changed' }];

  const saved = harness.api.realSave();

  assert.deepEqual(plain(saved), { ok: false, rolledBack: true });
  assert.equal(JSON.stringify([...harness.entries]), beforeEntries);
  assert.equal(JSON.stringify(harness.api.getSnapshot()), beforeSnapshot);
  assert.equal(harness.messages.at(-1).isError, true);
  assert.equal(harness.messages.some(message => /成功/.test(message.text)), false);
});

test('saveCurrentCharacter leaves both raw storage values unchanged when the first write fails', () => {
  const harness = loadHarness({ failSetItemAt: 1 });
  const beforeEntries = JSON.stringify([...harness.entries]);
  const beforeSnapshot = JSON.stringify(harness.api.getSnapshot());
  harness.state.apiKey = 'changed-key';

  const saved = harness.api.realSave();

  assert.deepEqual(plain(saved), { ok: false, rolledBack: true });
  assert.equal(JSON.stringify([...harness.entries]), beforeEntries);
  assert.equal(JSON.stringify(harness.api.getSnapshot()), beforeSnapshot);
});

test('saveCurrentCharacter removes newly-created keys when an originally empty save fails', () => {
  const harness = loadHarness({ entries: {}, failSetItemAt: 2 });

  const saved = harness.api.realSave();

  assert.deepEqual(plain(saved), { ok: false, rolledBack: true });
  assert.deepEqual([...harness.entries], []);
});

test('saveCurrentCharacter reports rollback failure and asks for a backup when restoration fails', () => {
  const harness = loadHarness({ failSetItemAt: [2, 3] });

  const saved = harness.api.realSave();

  assert.deepEqual(plain(saved), { ok: false, rolledBack: false });
  assert.equal(harness.messages.some(message => /备份/.test(message.text) && message.isError === true), true);
  assert.equal(harness.messages.some(message => /成功/.test(message.text)), false);
});

test('saveCurrentCharacter reports success only after updating both keys and the settings snapshot', () => {
  const harness = loadHarness();
  harness.state.apiKey = 'saved-key';
  harness.state.messages = [{ id: 'saved-message', role: 'assistant', content: 'saved' }];

  const saved = harness.api.realSave();

  assert.deepEqual(plain(saved), { ok: true, rolledBack: true });
  assert.equal(JSON.parse(harness.entries.get('ai_char_ari_data')).apiKey, 'saved-key');
  assert.deepEqual(JSON.parse(harness.entries.get('ai_char_ari_msg')), harness.state.messages);
  assert.equal(harness.api.getSnapshot().apiKey, 'saved-key');
  assert.deepEqual(plain(harness.api.getSnapshot().oldOnly), { owner: 'old-character' });
});

test('normalizeImportedCharacter migrates a legacy backup without mutating it', () => {
  const harness = loadHarness();
  const backup = { settings: {
    keyInfo: ['Gate opens at dawn'], historyEvents: ['Met the guard'], currentState: 'At the gate',
    roles: [{ name: 'Ari', color: '#FF6B6B' }], currentRole: 'Ari', legacyUnknown: { kept: true },
  }, messages: [{ role: 'user', content: 'Hello' }] };
  const before = JSON.stringify(backup);
  const normalized = harness.api.normalizeImportedCharacter(backup);
  assert.equal(JSON.stringify(backup), before); assert.equal(normalized.settings.memorySchemaVersion, 2);
  assert.deepEqual(plain(normalized.settings.memories.map(item => item.content)), ['Met the guard', 'Gate opens at dawn']);
  assert.equal(normalized.settings.currentScene.notes, 'At the gate'); assert.match(normalized.messages[0].id, /^message_/);
  assert.deepEqual(plain(normalized.settings.legacyUnknown), { kept: true });
});

test('normalizeImportedCharacter passes a defensive clone to migration', () => {
  const realStorage = loadStorage();
  const backup = version2Backup();
  const before = JSON.stringify(backup);
  const harness = loadHarness({
    storage: {
      ...realStorage,
      migrateCharacterData(settings, messages) {
        settings.importedOnly.nested = false;
        messages[0].content = 'mutated by migration';
        return realStorage.migrateCharacterData(settings, messages);
      },
    },
  });
  harness.api.normalizeImportedCharacter(backup);
  assert.equal(JSON.stringify(backup), before);
});

test('normalizeImportedCharacter rejects invalid input and hides migration internals', () => {
  const realStorage = loadStorage();
  const harness = loadHarness({
    storage: { ...realStorage, migrateCharacterData() { throw new Error('secret migration internals'); } },
  });

  assert.throws(() => harness.api.normalizeImportedCharacter(null), /无效/);
  assert.throws(() => harness.api.normalizeImportedCharacter({ settings: {}, messages: {} }), /消息/);
  assert.throws(() => harness.api.normalizeImportedCharacter({ schemaVersion: 3, settings: {}, messages: [] }), /不支持/);
  assert.throws(
    () => harness.api.normalizeImportedCharacter(version2Backup()),
    error => error && /导入/.test(error.message) && !error.message.includes('secret migration internals'),
  );
});

test('importData replaces the complete character snapshot, saves once, and advances UI after success', () => {
  const harness = loadHarness(); const backup = version2Backup();
  harness.api.importData({ contents: JSON.stringify(backup) });
  assert.equal(harness.getSaveCount(), 1); assert.equal(harness.state.currentCharacter, 'Ari');
  assert.equal(harness.state.apiKey, 'new-key'); assert.equal(harness.state.currentRole, 'Hero');
  assert.deepEqual(plain(harness.state.memories), backup.settings.memories);
  assert.deepEqual(plain(harness.state.memoryCandidates), backup.settings.memoryCandidates);
  assert.deepEqual(plain(harness.state.messages), backup.messages);
  assert.deepEqual(harness.uiCalls, ['sync', 'identity', 'background', 'render', 'close:active']);
  const savedSettings = JSON.parse(harness.entries.get('ai_char_ari_data'));
  assert.deepEqual(savedSettings.importedOnly, { nested: true });
  assert.equal(Object.prototype.hasOwnProperty.call(savedSettings, 'oldOnly'), false);
  assert.deepEqual(JSON.parse(harness.entries.get('ai_char_ari_msg')), backup.messages);
  assert.deepEqual(plain(harness.api.getSnapshot().importedOnly), { nested: true });
  assert.equal(Object.prototype.hasOwnProperty.call(harness.api.getSnapshot(), 'oldOnly'), false);
  assert.match(harness.messages.at(-1).text, /成功/);
});

test('importData rolls back memory and both storage keys when the second persistence write fails', () => {
  const harness = loadHarness({ failSetItemAt: 2 });
  const beforeState = JSON.stringify(harness.state);
  const beforeEntries = JSON.stringify([...harness.entries]);
  const beforeSnapshot = JSON.stringify(harness.api.getSnapshot());

  harness.api.importData({ contents: JSON.stringify(version2Backup()) });

  assert.equal(harness.getSaveCount(), 1);
  assert.equal(JSON.stringify(harness.state), beforeState);
  assert.equal(JSON.stringify([...harness.entries]), beforeEntries);
  assert.equal(JSON.stringify(harness.api.getSnapshot()), beforeSnapshot);
  assert.deepEqual(harness.uiCalls, []);
  assert.equal(harness.messages.some(message => /成功/.test(message.text)), false);
  assert.equal(harness.messages.at(-1).isError, true);
});

test('importData warns that storage may be partial when save rollback itself fails', () => {
  const harness = loadHarness({ failSetItemAt: [2, 3] });
  const beforeState = JSON.stringify(harness.state);
  const beforeSnapshot = JSON.stringify(harness.api.getSnapshot());

  harness.api.importData({ contents: JSON.stringify(version2Backup()) });

  assert.equal(JSON.stringify(harness.state), beforeState);
  assert.equal(JSON.stringify(harness.api.getSnapshot()), beforeSnapshot);
  assert.deepEqual(harness.uiCalls, []);
  assert.equal(harness.messages.some(message => /原数据已恢复/.test(message.text)), false);
  assert.equal(harness.warnings.some(details => /本地存储可能部分更新/.test(details.message) && /备份/.test(details.message)), true);
  assert.equal(harness.messages.some(message => /成功/.test(message.text)), false);
});

test('importData keeps committed data and reports a refresh warning when UI rendering fails', () => {
  const harness = loadHarness({ throwUiAt: 'sync' });
  const beforeEntries = JSON.stringify([...harness.entries]);

  harness.api.importData({ contents: JSON.stringify(version2Backup()) });

  assert.equal(harness.getSaveCount(), 1);
  assert.equal(harness.state.apiKey, 'new-key');
  assert.deepEqual(plain(harness.state.messages), version2Backup().messages);
  assert.notEqual(JSON.stringify([...harness.entries]), beforeEntries);
  assert.equal(JSON.parse(harness.entries.get('ai_char_ari_data')).apiKey, 'new-key');
  assert.deepEqual(JSON.parse(harness.entries.get('ai_char_ari_msg')), version2Backup().messages);
  assert.deepEqual(plain(harness.api.getSnapshot().importedOnly), { nested: true });
  assert.deepEqual(harness.uiCalls, ['sync']);
  assert.equal(harness.messages.some(message => message.text === '导入成功但界面刷新失败，请重新打开页面'), true);
  assert.equal(harness.messages.some(message => message.text === '✅ 配置已成功导入'), false);
});

test('invalid imports leave state, settings snapshot, and localStorage byte-for-byte unchanged', () => {
  const cases = [
    ['invalid JSON', '{'], ['missing settings', JSON.stringify({ messages: [] })],
    ['messages not an array', JSON.stringify({ settings: {}, messages: {} })],
    ['future export schema', JSON.stringify({ schemaVersion: 3, export_version: 3, settings: {}, messages: [] })],
    ['future memory schema', JSON.stringify({ schemaVersion: 2, settings: { memorySchemaVersion: 3 }, messages: [] })],
  ];
  for (const [name, contents] of cases) {
    const harness = loadHarness(); const beforeState = JSON.stringify(harness.state);
    const beforeEntries = JSON.stringify([...harness.entries]); const beforeSnapshot = JSON.stringify(harness.api.getSnapshot());
    harness.api.importData({ contents });
    assert.equal(JSON.stringify(harness.state), beforeState, name);
    assert.equal(JSON.stringify([...harness.entries]), beforeEntries, name);
    assert.equal(JSON.stringify(harness.api.getSnapshot()), beforeSnapshot, name);
    assert.equal(harness.getSaveCount(), 0, name); assert.deepEqual(harness.uiCalls, [], name);
    assert.equal(harness.messages.length, 1, name); assert.equal(harness.messages[0].isError, true, name);
  }
});

test('migration exceptions leave state and localStorage unchanged', () => {
  const realStorage = loadStorage();
  const harness = loadHarness({ storage: { ...realStorage, migrateCharacterData() { throw new Error('migration exploded'); } } });
  const beforeState = JSON.stringify(harness.state); const beforeEntries = JSON.stringify([...harness.entries]);
  const beforeSnapshot = JSON.stringify(harness.api.getSnapshot());
  harness.api.importData({ contents: JSON.stringify(version2Backup()) });
  assert.equal(JSON.stringify(harness.state), beforeState); assert.equal(JSON.stringify([...harness.entries]), beforeEntries);
  assert.equal(JSON.stringify(harness.api.getSnapshot()), beforeSnapshot); assert.equal(harness.getSaveCount(), 0);
  assert.deepEqual(harness.uiCalls, []); assert.equal(harness.messages[0].isError, true);
  assert.equal(harness.messages[0].text.includes('migration exploded'), false);
});
