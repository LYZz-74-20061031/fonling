const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadMemoryModules() {
  const context = { Date, Math, TextEncoder, crypto: { randomUUID: () => 'generated-id' } };
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync('js/memory/memory-model.js', 'utf8'), context);
  vm.runInNewContext(fs.readFileSync('js/memory/memory-storage.js', 'utf8'), context);
  vm.runInNewContext(fs.readFileSync('js/memory/memory-controller.js', 'utf8'), context);
  return context.FonlingMemory;
}

test('serialized-size estimation never throws on cyclic or unsupported values', () => {
  const memory = loadMemoryModules();
  const cyclic = {}; cyclic.self = cyclic;
  assert.doesNotThrow(() => memory.Storage.estimateSerializedBytes(cyclic));
  assert.equal(memory.Storage.estimateSerializedBytes(cyclic), 0);
  assert.equal(memory.Storage.estimateSerializedBytes(undefined), 0);
  assert.equal(memory.Storage.estimateSerializedBytes(10n), 0);
});

test('quota failure keeps a confirmed candidate pending and asks for immediate export', () => {
  const memory = loadMemoryModules();
  const candidate = memory.Model.createCandidate({
    id: 'candidate-1', operation: 'add', memoryType: 'key_info', content: '不要丢失', sourceMessageIds: ['a1'],
  });
  const state = {
    currentCharacter: '阿宁', memories: [], currentScene: memory.Model.EMPTY_SCENE,
    memoryCandidates: [candidate], memoryAnalysis: {}, memoryRequestTraces: {},
  };
  const warnings = [];
  const controller = memory.Controller.createMemoryController({
    getState: () => state,
    getCharacterName: () => state.currentCharacter,
    save: () => ({ ok: false, rolledBack: true, quotaExceeded: true }),
    ui: { render() {}, showStorageWarning(details) { warnings.push(details); } },
  });

  const result = controller.confirmCandidate('candidate-1');

  assert.equal(result.ok, false);
  assert.equal(state.memoryCandidates.length, 1);
  assert.equal(state.memoryCandidates[0].id, 'candidate-1');
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].quotaExceeded, true);
  assert.match(warnings[0].message, /存储空间不足，请立即导出备份/);
});

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(value) { this.values.add(value); }
  remove(value) { this.values.delete(value); }
  toggle(value, force) { if (force === false) this.values.delete(value); else this.values.add(value); }
  contains(value) { return this.values.has(value); }
}
class FakeNode {
  constructor(tag, document) { this.tagName = (tag || 'div').toUpperCase(); this.ownerDocument = document; this.children = []; this.listeners = {}; this.attributes = {}; this.dataset = {}; this.classList = new FakeClassList(); this.hidden = false; this.textContent = ''; this.value = ''; }
  appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
  removeChild(child) { this.children.splice(this.children.indexOf(child), 1); }
  get firstChild() { return this.children[0] || null; }
  addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
  dispatch(type, extra = {}) { (this.listeners[type] || []).forEach(handler => handler(Object.assign({ target: this, preventDefault() {}, stopPropagation() {} }, extra))); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name]; }
  focus() { this.ownerDocument.activeElement = this; }
  click() { this.dispatch('click'); }
  closest() { return null; }
  querySelectorAll(selector) { const all = []; const walk = node => node.children.forEach(child => { all.push(child); walk(child); }); walk(this); return selector.includes('button') ? all.filter(node => node.tagName === 'BUTTON') : all; }
}

test('opening memory center shows estimated character size and quota warning blocks with export action', () => {
  const documentListeners = {};
  const document = {
    activeElement: null,
    createElement(tag) { return new FakeNode(tag, this); },
    addEventListener(type, handler) { (documentListeners[type] ||= []).push(handler); },
    dispatch(type, event) { (documentListeners[type] || []).forEach(handler => handler(event)); },
  };
  const context = { document, Date, confirm: () => true, setTimeout, clearTimeout };
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync('js/memory/memory-ui.js', 'utf8'), context);
  const node = tag => new FakeNode(tag, document);
  const overlay = node(), tab = node('button'); tab.dataset.tab = 'history'; overlay.appendChild(tab);
  const panel = node(); panel.dataset.panel = 'history'; overlay.appendChild(panel);
  const storageOverlay = node(); storageOverlay.hidden = true;
  const exportButton = node('button'); let exportClicks = 0; exportButton.addEventListener('click', () => { exportClicks += 1; });
  const elements = {
    overlay, tabs: [tab], panels: [panel], historyList: node(), keyInfoList: node(), pendingList: node(), sceneFields: {},
    promptBar: node(), promptText: node(), toast: node(), storageSize: node(), getStorageBytes: () => 1536,
    storageWarningOverlay: storageOverlay, storageWarningMessage: node(), storageWarningCloseButton: node('button'),
    storageWarningExportButton: node('button'), exportButton,
  };
  const ui = context.FonlingMemory.UI.createMemoryUI(elements);

  ui.openCenter('history');
  assert.match(elements.storageSize.textContent, /1\.5 KB/);

  ui.showStorageWarning({ quotaExceeded: true, message: '存储空间不足，请立即导出备份' });
  assert.equal(storageOverlay.hidden, false);
  assert.equal(elements.storageWarningMessage.textContent, '存储空间不足，请立即导出备份');
  assert.equal(document.activeElement, elements.storageWarningExportButton);
  elements.storageWarningCloseButton.focus();
  const forward = { key: 'Tab', shiftKey: false, preventDefault() { this.prevented = true; } };
  document.dispatch('keydown', forward);
  assert.equal(forward.prevented, true);
  assert.equal(document.activeElement, elements.storageWarningExportButton);
  elements.storageWarningExportButton.dispatch('click');
  assert.equal(exportClicks, 1);
});

function createInlineSandbox(options = {}) {
  const readers = [];
  const images = [];
  const nodes = new Map();
  class DomNode {
    constructor(id, tag = 'div') { this.id = id; this.tagName = tag.toUpperCase(); this.style = {}; this.classList = new FakeClassList(); this.listeners = {}; this.children = []; this.dataset = {}; this.value = ''; this.textContent = ''; this.innerHTML = ''; this.hidden = false; this.disabled = false; this.files = []; }
    addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
    dispatch(type, extra = {}) { (this.listeners[type] || []).forEach(handler => handler.call(this, Object.assign({ target: this, preventDefault() {}, stopPropagation() {} }, extra))); }
    appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
    removeChild(child) { this.children = this.children.filter(item => item !== child); }
    remove() { if (this.parentNode) this.parentNode.removeChild(this); }
    setAttribute(name, value) { this.attributes ||= {}; this.attributes[name] = String(value); }
    querySelector() { return null; }
    querySelectorAll() { return []; }
    focus() {}
    click() { (this.listeners.click || []).forEach(handler => handler({ target: this, preventDefault() {}, stopPropagation() {} })); }
  }
  const node = id => { if (!nodes.has(id)) nodes.set(id, new DomNode(id, id === 'messageInput' ? 'textarea' : 'div')); return nodes.get(id); };
  const documentListeners = {};
  const document = {
    body: new DomNode('body', 'body'),
    getElementById: node,
    querySelector(selector) { return node(`query:${selector}`); },
    querySelectorAll() { return []; },
    createElement(tag) {
      const created = new DomNode('', tag);
      if (tag === 'canvas') {
        created.getContext = () => ({ drawImage() {} });
        created.toDataURL = () => options.generatedBackground || 'generated-background';
      }
      return created;
    },
    addEventListener(type, handler) { (documentListeners[type] ||= []).push(handler); },
  };
  const entries = new Map();
  const quota = Object.assign(new Error('full'), { name: 'QuotaExceededError', code: 22 });
  const localStorage = {
    getItem(key) { return entries.has(key) ? entries.get(key) : null; },
    setItem(key, value) { if (options.quotaFailure || options.failSetItemKey === key) throw quota; entries.set(key, String(value)); },
    removeItem(key) { if (options.failRemoveKey === key) throw quota; entries.delete(key); },
  };
  const emptyMemoryState = () => ({
    memorySchemaVersion: 2, memories: [],
    currentScene: { time: '', location: '', presentCharacters: [], currentGoal: '', currentConflict: '', characterStates: '', environment: '', notes: '', updatedAt: '' },
    memoryCandidates: [], memoryAnalysis: { analyzedTurnKeys: [], lastFailure: null, activeCharacter: null }, memoryRequestTraces: {},
  });
  const warnings = [];
  const memoryUI = { on() {}, render() {}, openCenter() {}, openSource() {}, openTrace() {}, showAnalysisFailure() {}, showStorageWarning(details) { warnings.push(details); } };
  let id = 0;
  const modules = {
    Model: {
      EMPTY_SCENE: emptyMemoryState().currentScene,
      createId(prefix) { return `${prefix}_${++id}`; }, ensureMessageIds(messages) { messages.forEach(message => { if (!message.id) message.id = `message_${++id}`; }); return messages; },
      clearConversationMemoryArtifacts(value) { return { ...value, messages: [], summary: '', memoryCandidates: [], memoryAnalysis: emptyMemoryState().memoryAnalysis, memoryRequestTraces: {} }; },
      removeArtifactsAfterMessageIds(value) { return value; },
    },
    Storage: {
      createEmptyMemoryState: emptyMemoryState,
      migrateCharacterData(settings, messages) { return { supported: true, changed: false, settings: { ...settings, ...emptyMemoryState() }, messages: Array.isArray(messages) ? messages : [] }; },
      serializeMemoryState(value) { return { memorySchemaVersion: value.memorySchemaVersion, memories: value.memories, currentScene: value.currentScene, memoryCandidates: value.memoryCandidates, memoryAnalysis: value.memoryAnalysis, memoryRequestTraces: value.memoryRequestTraces }; },
      estimateSerializedBytes(value) { return JSON.stringify(value).length; },
      isQuotaExceededError(error) { return error && error.name === 'QuotaExceededError'; },
    },
    Context: { buildMemoryContextMessages: () => ({ messages: [], trace: { pinnedMemoryIds: [], relatedMemoryIds: [], sceneUpdatedAt: '', usedSummary: false } }) },
    Analyzer: { shouldAnalyzeTurn: () => false, analyzeTurn: async () => ({ ok: true, candidates: [] }) },
    UI: { createMemoryUI: () => { if (options.uiThrows) throw new Error('UI init failed'); return memoryUI; } },
    Controller: { createMemoryController: () => { if (options.controllerThrows) throw new Error('Controller init failed'); if (options.controllerReturnsNull) return null; return { sync() {}, addMemory() {}, updateMemory() {}, deleteMemory() {}, setMemoryStatus() {}, togglePinned() {}, patchScene() {}, clearScene() {}, confirmCandidate() {}, dismissCandidate() {}, dismissAllCandidates() {}, analyzeRecent() {} }; } },
  };
  if (options.missingModule) delete modules[options.missingModule];
  const sandbox = {
    console, document, localStorage, navigator: {}, location: {}, confirm: () => true,
    __storageFailureOptions: options,
    setTimeout, clearTimeout, requestAnimationFrame(callback) { callback(); }, fetch: async () => ({ ok: false, status: 500 }),
    TextDecoder, TextEncoder, Blob, URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    FileReader: class { constructor() { readers.push(this); } readAsDataURL(file) { this.file = file; } },
    Image: class { constructor() { this.width = 100; this.height = 100; images.push(this); } set src(value) { this._src = value; } },
  };
  if (!options.missingNamespace) sandbox.FonlingMemory = modules;
  sandbox.globalThis = sandbox; sandbox.window = sandbox;
  const inline = fs.readFileSync('index.html', 'utf8').match(/<script>([\s\S]*?)<\/script>/)?.[1];
  vm.createContext(sandbox);
  return { sandbox, nodes, documentListeners, entries, inline, warnings, readers, images };
}

test('every missing memory module and initialization failure leaves base listeners available', () => {
  const cases = [
    { missingNamespace: true },
    ...['Model', 'Storage', 'Context', 'Analyzer', 'UI', 'Controller'].map(missingModule => ({ missingModule })),
    { uiThrows: true }, { controllerThrows: true }, { controllerReturnsNull: true },
  ];
  for (const options of cases) {
    const app = createInlineSandbox(options);
    assert.doesNotThrow(() => vm.runInContext(app.inline, app.sandbox, { filename: 'index.html' }), JSON.stringify(options));
    assert.equal((app.nodes.get('sendBtn').listeners.click || []).length, 1, JSON.stringify(options));
    assert.equal((app.nodes.get('loginCharBtn').listeners.click || []).length, 1, JSON.stringify(options));
    assert.equal((app.nodes.get('createCharBtn').listeners.click || []).length, 1, JSON.stringify(options));
    assert.equal(app.nodes.get('memoryCenterBtn').hidden, true, JSON.stringify(options));
  }
});

test('missing Context still permits base request construction and missing Storage still permits character creation', () => {
  const noContext = createInlineSandbox({ missingModule: 'Context' });
  vm.runInContext(noContext.inline, noContext.sandbox, { filename: 'index.html' });
  const built = vm.runInContext("state.systemPrompt='人设'; state.messages=[{id:'u1',role:'user',content:'继续'}]; buildApiMessages()", noContext.sandbox);
  assert.equal(Array.isArray(built.messages), true);
  assert.ok(built.messages.some(message => message.content === '人设'));

  const noStorage = createInlineSandbox({ missingModule: 'Storage' });
  vm.runInContext(noStorage.inline, noStorage.sandbox, { filename: 'index.html' });
  assert.doesNotThrow(() => noStorage.sandbox.createCharacter('离线角色'));
  assert.equal(noStorage.nodes.get('memoryCenterBtn').hidden, true);
});

test('quota save result preserves the structured contract and exposes quota classification', () => {
  const app = createInlineSandbox({ quotaFailure: true });
  vm.runInContext(app.inline, app.sandbox, { filename: 'index.html' });
  const result = vm.runInContext("state.currentCharacter='阿宁'; saveCurrentCharacter()", app.sandbox);
  assert.deepEqual(Object.keys(result).sort(), ['ok', 'rolledBack']);
  assert.equal(result.ok, false);
  assert.equal(result.rolledBack, true);
  assert.equal(result.quotaExceeded, true);
});

test('settings changes roll back state and controls while preserving quota details', () => {
  const app = createInlineSandbox({ quotaFailure: true });
  vm.runInContext(app.inline, app.sandbox, { filename: 'index.html' });
  vm.runInContext("state.currentCharacter='阿宁'; state.apiKey='old-key'; state.systemPrompt='old-persona'; state.style='old-style'; state.userIdentity='old-user'", app.sandbox);
  const cases = [
    ['apiKeyInput', 'new-key', 'apiKey', 'old-key'],
    ['systemPromptInput', 'new-persona', 'systemPrompt', 'old-persona'],
    ['styleInput', 'new-style', 'style', 'old-style'],
    ['userIdentityInput', 'new-user', 'userIdentity', 'old-user'],
  ];
  for (const [id, next, stateKey, previous] of cases) {
    const input = app.nodes.get(id); input.value = next; input.dispatch('change');
    assert.equal(vm.runInContext(`state.${stateKey}`, app.sandbox), previous);
    assert.equal(input.value, previous);
    assert.equal(app.warnings.at(-1).quotaExceeded, true);
    assert.equal(app.warnings.at(-1).message, '存储空间不足，请立即导出备份');
  }
});

test('background, role, and message edits roll back and surface the quota modal contract', () => {
  const app = createInlineSandbox({ quotaFailure: true });
  vm.runInContext(app.inline, app.sandbox, { filename: 'index.html' });
  vm.runInContext("state.currentCharacter='阿宁'; state.bgImage='old-image'; state.roles=[]; state.messages=[{id:'a1',role:'assistant',content:'old answer'}]", app.sandbox);

  app.nodes.get('bgResetBtn').dispatch('click');
  assert.equal(vm.runInContext('state.bgImage', app.sandbox), 'old-image');
  assert.equal(app.warnings.at(-1).quotaExceeded, true);

  app.sandbox.addRole();
  assert.equal(vm.runInContext('state.roles.length', app.sandbox), 0);
  assert.equal(app.warnings.at(-1).quotaExceeded, true);

  assert.equal(typeof app.sandbox.commitMessageEdit, 'function');
  assert.equal(app.sandbox.commitMessageEdit(0, 'new answer'), false);
  assert.equal(vm.runInContext('state.messages[0].content', app.sandbox), 'old answer');
  assert.equal(app.warnings.at(-1).quotaExceeded, true);
});

test('late or superseded background callbacks cannot overwrite another character or a newer upload', () => {
  const app = createInlineSandbox();
  vm.runInContext(app.inline, app.sandbox, { filename: 'index.html' });
  vm.runInContext("state.currentCharacter='A'; state.bgImage='A-old'", app.sandbox);
  const input = app.nodes.get('bgFileInput');
  input.files = [{ type: 'image/png', name: 'first.png' }];
  input.dispatch('change');
  app.readers[0].onload({ target: { result: 'first-bytes' } });
  vm.runInContext("state.currentCharacter='B'; state.bgImage='B-image'", app.sandbox);
  app.images[0].onload();
  assert.equal(vm.runInContext('state.bgImage', app.sandbox), 'B-image');

  vm.runInContext("state.currentCharacter='A'; state.bgImage='A-old'", app.sandbox);
  input.files = [{ type: 'image/png', name: 'older.png' }]; input.dispatch('change');
  input.files = [{ type: 'image/png', name: 'newer.png' }]; input.dispatch('change');
  app.readers[1].onload({ target: { result: 'older-bytes' } });
  app.readers[2].onload({ target: { result: 'newer-bytes' } });
  assert.equal(app.images.length, 2);
  app.images[1].onload();
  app.images[0].onload();
  assert.equal(vm.runInContext('state.bgImage', app.sandbox), 'generated-background');
});

test('current-character selection failures never advance login or switch UI', () => {
  const app = createInlineSandbox();
  vm.runInContext(app.inline, app.sandbox, { filename: 'index.html' });
  const empty = app.sandbox.FonlingMemory.Storage.createEmptyMemoryState();
  app.entries.set('ai_char_list', JSON.stringify(['B']));
  app.entries.set('ai_char_b_data', JSON.stringify({ ...empty, apiKey: 'b-key' }));
  app.entries.set('ai_char_b_msg', '[]');
  vm.runInContext("state.currentCharacter='A'; state.apiKey='a-key'", app.sandbox);
  app.sandbox.document.getElementById('loginOverlay').style.display = 'flex';
  const options = app.sandbox.__storageFailureOptions;
  options.failSetItemKey = 'ai_current_char';
  app.sandbox.loginCharacter('B');
  assert.equal(vm.runInContext('state.currentCharacter', app.sandbox), 'A');
  assert.equal(vm.runInContext('state.apiKey', app.sandbox), 'a-key');
  assert.notEqual(app.sandbox.document.getElementById('loginOverlay').style.display, 'none');
  assert.equal(app.warnings.at(-1).quotaExceeded, true);

  options.failSetItemKey = undefined;
  options.failRemoveKey = 'ai_current_char';
  app.sandbox.switchCharacter();
  assert.equal(vm.runInContext('state.currentCharacter', app.sandbox), 'A');
  assert.equal(app.warnings.at(-1).quotaExceeded, true);
});

test('create rolls back its new list and character keys when current selection cannot be stored', () => {
  const app = createInlineSandbox();
  vm.runInContext(app.inline, app.sandbox, { filename: 'index.html' });
  vm.runInContext("state.currentCharacter='A'; state.apiKey='a-key'", app.sandbox);
  app.sandbox.__storageFailureOptions.failSetItemKey = 'ai_current_char';
  app.sandbox.createCharacter('C');
  assert.equal(vm.runInContext('state.currentCharacter', app.sandbox), 'A');
  assert.equal(vm.runInContext('state.apiKey', app.sandbox), 'a-key');
  assert.deepEqual(JSON.parse(app.entries.get('ai_char_list')), []);
  assert.equal(app.entries.has('ai_char_c_data'), false);
  assert.equal(app.entries.has('ai_char_c_msg'), false);
  assert.equal(app.warnings.at(-1).quotaExceeded, true);
});

test('partial character deletion restores data messages list and current selection atomically', () => {
  const app = createInlineSandbox();
  vm.runInContext(app.inline, app.sandbox, { filename: 'index.html' });
  const before = new Map([
    ['ai_char_a_data', '{"kept":true}'], ['ai_char_a_msg', '[{"id":"a1"}]'],
    ['ai_char_list', '["A"]'], ['ai_current_char', 'A'],
  ]);
  before.forEach((value, key) => app.entries.set(key, value));
  vm.runInContext("state.currentCharacter='A'", app.sandbox);
  app.sandbox.__storageFailureOptions.failRemoveKey = 'ai_char_a_msg';
  app.sandbox.deleteCharacter();
  assert.deepEqual([...app.entries].sort(), [...before].sort());
  assert.equal(vm.runInContext('state.currentCharacter', app.sandbox), 'A');
  assert.equal(app.warnings.length, 1);
});

test('every character mutation entry refuses a streaming placeholder before storage or file work', () => {
  const app = createInlineSandbox();
  vm.runInContext(app.inline, app.sandbox, { filename: 'index.html' });
  app.entries.set('ai_char_list', JSON.stringify(['A', 'B']));
  app.entries.set('ai_current_char', 'A');
  vm.runInContext("state.currentCharacter='A'; state.isStreaming=true; state.roles=[{name:'身份',bio:'旧'}]; state.currentRole=null; state.messages=[{id:'pending',role:'assistant',content:'',_streaming:true}]", app.sandbox);
  const before = JSON.stringify([...app.entries]);
  app.sandbox.switchCharacter();
  app.sandbox.deleteCharacter();
  app.sandbox.loginCharacter('B');
  app.sandbox.createCharacter('C');
  app.sandbox.importData({ contents: '{}' });
  app.sandbox.switchToRole('身份');
  app.sandbox.deleteRole(0);
  assert.equal(JSON.stringify([...app.entries]), before);
  assert.equal(app.readers.length, 0);
  assert.equal(vm.runInContext('state.currentCharacter', app.sandbox), 'A');
  assert.equal(vm.runInContext('state.messages[0]._streaming', app.sandbox), true);
});
