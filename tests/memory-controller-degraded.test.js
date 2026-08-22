const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(value) { this.values.add(value); }
  remove(value) { this.values.delete(value); }
  contains(value) { return this.values.has(value); }
}

class FakeNode {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.style = {};
    this.classList = new FakeClassList();
    this.listeners = {};
    this.children = [];
    this.dataset = {};
    this.value = '';
    this.textContent = '';
    this.innerHTML = '';
    this.hidden = false;
    this.disabled = false;
    this.files = [];
  }
  addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
  appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
  removeChild(child) { this.children = this.children.filter(item => item !== child); }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  setAttribute(name, value) { this[name] = String(value); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  focus() {}
  click() { (this.listeners.click || []).forEach(handler => handler({ target: this, preventDefault() {} })); }
}

function createSandboxWithoutController() {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, new FakeNode(id === 'messageInput' ? 'textarea' : 'div'));
    return nodes.get(id);
  };
  const documentListeners = {};
  const document = {
    body: new FakeNode('body'),
    getElementById: node,
    querySelector(selector) { return node(`query:${selector}`); },
    querySelectorAll() { return []; },
    createElement(tag) { return new FakeNode(tag); },
    addEventListener(type, handler) { (documentListeners[type] ||= []).push(handler); },
  };
  const storage = new Map();
  const localStorage = {
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) { storage.set(key, String(value)); },
    removeItem(key) { storage.delete(key); },
  };
  const emptyMemoryState = () => ({
    memorySchemaVersion: 2, memories: [],
    currentScene: { time: '', location: '', presentCharacters: [], currentGoal: '', currentConflict: '', characterStates: '', environment: '', notes: '', updatedAt: '' },
    memoryCandidates: [], memoryAnalysis: { analyzedTurnKeys: [], lastFailure: null, activeCharacter: null }, memoryRequestTraces: {},
  });
  const memoryUI = {
    on() {}, render() {}, openCenter() {}, closeCenter() {}, openCandidateSheet() {}, closeCandidateSheet() {},
    showAnalysisFailure() {}, showStorageWarning() {},
  };
  let id = 0;
  const sandbox = {
    console,
    document,
    localStorage,
    navigator: {},
    location: {},
    confirm: () => true,
    setTimeout,
    clearTimeout,
    requestAnimationFrame(callback) { callback(); },
    fetch: async () => ({ ok: false, status: 500 }),
    TextDecoder,
    Blob,
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    FileReader: class {},
    Image: class {},
    FonlingMemory: {
      Model: {
        createId(prefix) { return `${prefix}_${++id}`; },
        ensureMessageIds(messages) { return messages; },
        clearConversationMemoryArtifacts(value) { return value; },
        removeArtifactsAfterMessageIds(value) { return value; },
      },
      Storage: {
        createEmptyMemoryState: emptyMemoryState,
        migrateCharacterData(settings, messages) { return { supported: true, changed: false, settings: { ...settings, ...emptyMemoryState() }, messages }; },
        serializeMemoryState(value) {
          return {
            memorySchemaVersion: value.memorySchemaVersion, memories: value.memories, currentScene: value.currentScene,
            memoryCandidates: value.memoryCandidates, memoryAnalysis: value.memoryAnalysis, memoryRequestTraces: value.memoryRequestTraces,
          };
        },
      },
      Context: { buildMemoryContextMessages: () => ({ messages: [], trace: { usedSummary: false } }) },
      Analyzer: {},
      UI: { createMemoryUI: () => memoryUI },
      // Controller is deliberately absent.
    },
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  return { sandbox, nodes, documentListeners };
}

test('missing Controller degrades memory only while login and send initialization continue', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const inline = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(inline);
  const app = createSandboxWithoutController();
  vm.createContext(app.sandbox);
  assert.doesNotThrow(() => vm.runInContext(inline, app.sandbox, { filename: 'index.html' }));

  assert.equal((app.nodes.get('sendBtn').listeners.click || []).length, 1);
  assert.equal((app.nodes.get('loginCharBtn').listeners.click || []).length, 1);
  assert.equal((app.nodes.get('createCharBtn').listeners.click || []).length, 1);
  assert.equal((app.documentListeners.DOMContentLoaded || []).length, 1);
  assert.equal(app.nodes.get('memoryCenterBtn').hidden, true);
  assert.equal(app.nodes.get('memoryCenterBtn').disabled, true);
});

test('entering a character with Controller missing emits one safe notice only', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const inline = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  const app = createSandboxWithoutController();
  vm.createContext(app.sandbox);
  vm.runInContext(inline, app.sandbox, { filename: 'index.html' });
  app.sandbox.createCharacter('测试角色');
  app.sandbox.notifyMemoryUnavailableOnce();
  const chat = app.nodes.get('chatArea');
  const messages = chat.children.map(wrap => wrap.children[0] && wrap.children[0].textContent).filter(Boolean);
  assert.equal(messages.filter(message => message === '记忆功能暂不可用').length, 1);
  assert.ok(messages.some(message => /创建成功/.test(message)));
});
