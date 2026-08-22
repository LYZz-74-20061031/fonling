const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ModelConfig = require('../js/model/model-config.js');

function loadImportData() {
  const html = fs.readFileSync('index.html', 'utf8');
  const normalize = html.match(/function normalizeImportedCharacter\(data\) \{[\s\S]*?\n\}/)?.[0];
  const fn = html.match(/function importData\(file\) \{[\s\S]*?\n\}/)?.[0];
  const sanitize = html.match(/function sanitizeCharacterSettings\([^)]*\) \{[\s\S]*?\n\}/)?.[0];
  const migrateModel = html.match(/function migrateLegacyModelConfig\([^)]*\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(normalize, 'normalizeImportedCharacter must exist in index.html');
  assert.ok(fn, 'importData must exist in index.html');

  const state = {
    currentCharacter: 'legacy',
    apiKey: '',
    systemPrompt: '',
    style: '',
    bgImage: '',
    summary: '',
    userIdentity: '',
    messages: [],
    memorySchemaVersion: 2,
    memories: [],
    currentScene: { time: '', location: '', presentCharacters: [], currentGoal: '', currentConflict: '', characterStates: '', environment: '', notes: '', updatedAt: '' },
    memoryCandidates: [],
    memoryAnalysis: { analyzedTurnKeys: [], lastFailure: null, activeCharacter: null },
    memoryRequestTraces: {},
    roles: [{ name: '旧身份', bio: '不应保留', color: '#000000' }],
    currentRole: '旧身份',
  };

  class FakeFileReader {
    readAsText(file) {
      this.onload({ target: { result: file.contents } });
    }
  }

  const context = {
    state,
    modelConfigApi: ModelConfig,
    modelConfig: ModelConfig.createDefaultConfig(),
    loadedCharacterSettings: {},
    JSON,
    FileReader: FakeFileReader,
    FonlingMemory: {},
    getCharDataKey(name) { return `data:${name}`; },
    getCharMsgKey(name) { return `messages:${name}`; },
    localStorage: {
      getItem() { return null; },
      setItem() {},
      removeItem() {},
    },
    saveCurrentCharacter() { return { ok: true, rolledBack: true }; },
    syncSettingsUI() {},
    updateIdentityBar() {},
    applyBackground() {},
    renderMessages() {},
    settingsOverlay: { classList: { remove() {} } },
    addSystemMsg() {},
    characterMutationIsBlocked() { return false; },
    characterSelectionEpoch: 0, conversationRequestEpoch: 0, summaryRequestEpoch: 0, backgroundOperationEpoch: 0,
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('js/memory/memory-model.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('js/memory/memory-storage.js', 'utf8'), context);
  vm.runInContext(`${sanitize}; ${migrateModel}; ${normalize}; ${fn}; this.importData = importData;`, context);
  return context;
}

test('restores key information and role identity data from an exported backup', () => {
  const context = loadImportData();
  const backup = {
    settings: {
      apiKey: 'backup-key',
      systemPrompt: '备份人设',
      style: '备份风格',
      bgImage: '',
      summary: '备份摘要',
      historyEvents: ['备份历史事件'],
      currentState: '备份当下状态',
      userIdentity: '备份用户身份',
      keyInfo: ['阿宁知道密道的位置'],
      roles: [{ name: '阿宁', bio: '主角的盟友', color: '#FF6B6B' }],
      currentRole: '阿宁',
    },
    messages: [{ role: 'user', content: '测试消息' }],
  };

  context.importData({ contents: JSON.stringify(backup) });

  assert.deepEqual(
    JSON.parse(JSON.stringify(context.state.memories.map(memory => ({ type: memory.type, content: memory.content })))),
    [
      { type: 'history_event', content: backup.settings.historyEvents[0] },
      { type: 'key_info', content: backup.settings.keyInfo[0] },
    ],
  );
  assert.equal(context.state.currentScene.notes, backup.settings.currentState);
  assert.equal(JSON.stringify(context.state.roles), JSON.stringify(backup.settings.roles));
  assert.equal(context.state.currentRole, '阿宁');
});
