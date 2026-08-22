const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(value) { this.values.add(value); }
  remove(value) { this.values.delete(value); }
  toggle(value, force) {
    if (force === false) this.values.delete(value);
    else if (force === true || !this.values.has(value)) this.values.add(value);
    else this.values.delete(value);
  }
  contains(value) { return this.values.has(value); }
}

class FakeNode {
  constructor(tag, document) {
    this.tagName = (tag || 'div').toUpperCase();
    this.ownerDocument = document;
    this.children = [];
    this.listeners = {};
    this.attributes = {};
    this.dataset = {};
    this.classList = new FakeClassList();
    this.hidden = false;
    this.disabled = false;
    this.textContent = '';
    this.value = '';
    this.checked = false;
    this.scrollCalls = [];
  }
  appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
  removeChild(child) { this.children.splice(this.children.indexOf(child), 1); }
  get firstChild() { return this.children[0] || null; }
  addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
  dispatch(type, extra = {}) {
    const event = Object.assign({ target: this, stopPropagation() {}, preventDefault() {} }, extra);
    (this.listeners[type] || []).forEach(handler => handler(event));
    return event;
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name]; }
  focus() { this.ownerDocument.activeElement = this; }
  scrollIntoView(options) { this.scrollCalls.push(options); }
  closest(selector) {
    if (selector === '[hidden]') for (let node = this; node; node = node.parentNode) if (node.hidden) return node;
    return null;
  }
  querySelectorAll(selector) {
    const all = [];
    const walk = node => node.children.forEach(child => { all.push(child); walk(child); });
    walk(this);
    if (selector.includes('button')) return all.filter(node => ['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName) && !node.disabled && !node.hidden);
    return all;
  }
}

function setupUI() {
  const messageNodes = new Map();
  const document = {
    activeElement: null,
    listeners: {},
    createElement(tag) { return new FakeNode(tag, this); },
    addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); },
    querySelector(selector) {
      const match = /^\[data-message-id="(.+)"\]$/.exec(selector);
      return match ? messageNodes.get(match[1]) || null : null;
    },
  };
  const timers = [];
  const clearedTimers = [];
  const context = {
    document,
    Date,
    confirm: () => true,
    setTimeout(fn) { timers.push(fn); return timers.length; },
    clearTimeout(id) { clearedTimers.push(id); },
  };
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync('js/memory/memory-ui.js', 'utf8'), context);
  const node = tag => new FakeNode(tag || 'div', document);
  const overlay = node();
  const traceOverlay = node(); traceOverlay.hidden = true;
  const elements = {
    overlay,
    closeButton: node('button'),
    backdrop: node(),
    characterName: node(),
    tabs: [], panels: [],
    historyList: node(), keyInfoList: node(), pendingList: node(), sceneFields: {},
    promptBar: node(), promptText: node(),
    traceOverlay,
    traceBackdrop: node(),
    traceCloseButton: node('button'),
    traceTitle: node(),
    traceContent: node(),
    toast: node(),
  };
  let snapshot = {
    characterName: '阿宁',
    messages: [{ id: 'u1', role: 'user', content: '去码头' }, { id: 'a1', role: 'assistant', content: '抵达码头' }],
    memories: [
      { id: 'p1', type: 'key_info', content: '阿宁持有铜钥匙', status: 'active', pinned: true, sourceMessageIds: ['u1'] },
      { id: 'r1', type: 'history_event', content: '港口已经封锁', status: 'active', pinned: false, sourceMessageIds: ['gone-formal'] },
    ],
    currentScene: { location: '旧港码头', currentGoal: '寻找渡船', presentCharacters: ['阿宁'], updatedAt: 'scene-1' },
    memoryCandidates: [{ id: 'c1', operation: 'add', memoryType: 'key_info', content: '候选', sourceMessageIds: ['gone-candidate'] }],
    memoryRequestTraces: {
      a1: { pinnedMemoryIds: ['p1'], relatedMemoryIds: ['r1'], sceneUpdatedAt: 'scene-1', usedSummary: true },
    },
  };
  elements.getSnapshot = () => snapshot;
  const ui = context.FonlingMemory.UI.createMemoryUI(elements);
  ui.render(snapshot);
  return { context, document, messageNodes, timers, clearedTimers, elements, ui, get snapshot() { return snapshot; }, set snapshot(value) { snapshot = value; } };
}

function flattenText(node) {
  return [node.textContent, ...node.children.flatMap(child => flattenText(child))].join('\n');
}

test('openSource scrolls to an existing message and briefly highlights it', () => {
  const app = setupUI();
  const message = new FakeNode('div', app.document);
  app.messageNodes.set('u1', message);

  assert.equal(app.ui.openSource('u1'), 'message');
  assert.equal(message.scrollCalls.length, 1);
  assert.equal(message.scrollCalls[0].block, 'center');
  assert.equal(message.classList.contains('memory-source-highlight'), true);
  app.timers.at(-1)();
  assert.equal(message.classList.contains('memory-source-highlight'), false);
});

test('missing formal sources are compressed while pending or unknown sources are unavailable', () => {
  const app = setupUI();

  assert.equal(app.ui.openSource('gone-formal'), 'compressed');
  assert.equal(app.elements.toast.textContent, '来源对话已压缩');
  assert.equal(app.ui.openSource('gone-candidate'), 'unavailable');
  assert.equal(app.elements.toast.textContent, '来源不可定位');
  assert.equal(app.ui.openSource('totally-unknown'), 'unavailable');
});

test('source lookup skips missing earlier IDs and opens the first source message that still exists', () => {
  const app = setupUI();
  const surviving = new FakeNode('div', app.document);
  app.messageNodes.set('a1', surviving);

  assert.equal(app.ui.openSource(['missing-first', 'a1'], 'formal'), 'message');
  assert.equal(surviving.scrollCalls.length, 1);
  assert.equal(app.elements.toast.textContent, '');
});

test('only the newest source highlight timer can clear highlight and close clears it immediately', () => {
  const app = setupUI();
  const first = new FakeNode('div', app.document);
  const second = new FakeNode('div', app.document);
  app.messageNodes.set('u1', first);
  app.messageNodes.set('a1', second);

  app.ui.openSource('u1');
  app.ui.openSource('a1');
  assert.deepEqual(app.clearedTimers, [1]);
  app.timers[0]();
  assert.equal(second.classList.contains('memory-source-highlight'), true);
  app.ui.closeCenter();
  assert.equal(second.classList.contains('memory-source-highlight'), false);
  assert.deepEqual(app.clearedTimers, [1, 2]);
});

test('openTrace resolves current formal memory text and reports scene and summary usage', () => {
  const app = setupUI();
  assert.equal(app.ui.openTrace('a1'), true);
  assert.equal(app.elements.traceOverlay.hidden, false);
  const firstText = flattenText(app.elements.traceContent);
  assert.match(firstText, /固定记忆/);
  assert.match(firstText, /阿宁持有铜钥匙/);
  assert.match(firstText, /相关记忆/);
  assert.match(firstText, /港口已经封锁/);
  assert.match(firstText, /旧港码头/);
  assert.match(firstText, /滚动摘要：已使用/);

  app.snapshot.memories[0].content = '阿宁已经交出铜钥匙';
  app.ui.openTrace('a1');
  const updatedText = flattenText(app.elements.traceContent);
  assert.match(updatedText, /阿宁已经交出铜钥匙/);
  assert.doesNotMatch(updatedText, /阿宁持有铜钥匙/);
});

test('trace sheet closes with its button and restores focus', () => {
  const app = setupUI();
  const trigger = new FakeNode('button', app.document); trigger.focus();
  app.ui.openTrace('a1');
  assert.equal(app.document.activeElement, app.elements.traceCloseButton);
  app.elements.traceCloseButton.dispatch('click');
  assert.equal(app.elements.traceOverlay.hidden, true);
  assert.equal(app.document.activeElement, trigger);
});

test('renderMessages adds stable hooks and a trace action only for traced assistant messages', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const functionSource = html.match(/function renderMessages\([\s\S]*?\r?\n}\r?\nfunction startEdit/)?.[0].replace(/\r?\nfunction startEdit$/, '');
  assert.ok(functionSource, 'renderMessages should be extractable');
  const document = { createElement(tag) { return new FakeNode(tag, document); }, querySelectorAll() { return []; } };
  const chatArea = new FakeNode('div', document);
  const opened = [];
  const context = {
    document, chatArea,
    state: {
      messages: [
        { id: 'a-traced', role: 'assistant', content: '一' },
        { id: 'a-plain', role: 'assistant', content: '二' },
      ],
      memoryRequestTraces: { 'a-traced': { relatedMemoryIds: [] } },
      roles: [],
    },
    memoryUI: { openTrace(id) { opened.push(id); } },
    formatMsgText(value) { return value; },
    scrollToBottom() {}, backtrackMessage() {}, startEdit() {}, regenerateMessage() {},
  };
  vm.runInNewContext(`${functionSource}\nrenderMessages(false);`, context);

  assert.equal(chatArea.children[0].dataset.messageId, 'a-traced');
  assert.equal(chatArea.children[1].dataset.messageId, 'a-plain');
  const tracedActions = chatArea.children[0].children[1].children;
  const traceButton = tracedActions.find(child => child.textContent === '查看本次使用的记忆');
  assert.ok(traceButton);
  assert.equal(chatArea.children[1].children[1].children.some(child => child.textContent === '查看本次使用的记忆'), false);
  traceButton.dispatch('click');
  assert.deepEqual(opened, ['a-traced']);
});
