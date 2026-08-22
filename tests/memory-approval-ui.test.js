const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(value) { this.values.add(value); }
  remove(value) { this.values.delete(value); }
  toggle(value, force) { if (force === false) this.remove(value); else if (force === true || !this.values.has(value)) this.add(value); else this.remove(value); }
  contains(value) { return this.values.has(value); }
}
class FakeNode {
  constructor(tag = 'div', document) {
    this.tagName = tag.toUpperCase(); this.ownerDocument = document; this.children = []; this.listeners = {};
    this.attributes = {}; this.classList = new FakeClassList(); this.dataset = {}; this.hidden = false;
    this.value = ''; this.checked = false; this.textContent = ''; this.disabled = false;
  }
  appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
  removeChild(child) { this.children.splice(this.children.indexOf(child), 1); }
  get firstChild() { return this.children[0] || null; }
  addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
  dispatch(type, extra = {}) { const event = { target: this, key: extra.key, shiftKey: extra.shiftKey, preventDefault() { extra.prevented = true; } }; (this.listeners[type] || []).forEach(handler => handler(event)); return extra; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name]; }
  focus() { this.ownerDocument.activeElement = this; }
  closest(selector) { if (selector === '[hidden]') for (let node = this; node; node = node.parentNode) if (node.hidden) return node; return null; }
  querySelectorAll(selector) { const all = []; const walk = node => node.children.forEach(child => { all.push(child); walk(child); }); walk(this); return selector.includes('button') ? all.filter(node => ['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName) && !node.disabled && !node.hidden) : all; }
}

function descendants(node) { const list = []; const walk = item => item.children.forEach(child => { list.push(child); walk(child); }); walk(node); return list; }
function byText(node, text) { return descendants(node).find(child => child.textContent === text); }
function byData(node, key, value) { return descendants(node).find(child => child.dataset[key] === value); }
function plain(value) { return JSON.parse(JSON.stringify(value)); }

function setup(confirmResult = true) {
  const document = {
    activeElement: null, listeners: {}, createElement(tag) { return new FakeNode(tag, this); },
    addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); },
  };
  const context = { document, Date, confirmCalls: [], confirm(message) { this.confirmCalls.push(message); return confirmResult; }, setTimeout() { return 1; }, clearTimeout() {} };
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync('js/memory/memory-ui.js', 'utf8'), context);
  const node = tag => new FakeNode(tag, document);
  const overlay = node(); overlay.classList = new FakeClassList();
  const candidateSheet = node(); candidateSheet.hidden = true;
  const candidateList = node(); candidateSheet.appendChild(candidateList);
  const tabs = ['history', 'key-info', 'scene', 'pending'].map(name => { const tab = node('button'); tab.dataset.tab = name; return tab; });
  const panels = tabs.map(tab => { const panel = node(); panel.dataset.panel = tab.dataset.tab; return panel; });
  const elements = {
    overlay, closeButton: node('button'), backdrop: node(), characterName: node(), tabs, panels,
    historyList: node(), keyInfoList: node(), pendingList: node(), sceneFields: {}, addHistory: node('button'), addKeyInfo: node('button'),
    saveScene: node('button'), clearScene: node('button'), analyzeButton: node('button'), candidateSheet,
    candidateList, candidateCloseButton: node('button'), candidateBackdrop: node(), candidateCenterButton: node('button'),
    promptBar: node(), promptText: node(), manualForms: {}, toast: node(),
  };
  candidateSheet.appendChild(elements.candidateCloseButton); candidateSheet.appendChild(elements.candidateCenterButton);
  const ui = context.FonlingMemory.UI.createMemoryUI(elements);
  return { context, elements, ui };
}

function snapshot() {
  return {
    characterName: '阿宁',
    snapshotIdentity: 'snapshot-a',
    memories: [
      { id: 'old-1', type: 'key_info', content: '旧秘密', status: 'active', pinned: false },
      { id: 'old-2', type: 'key_info', content: '另一条旧秘密', status: 'active', pinned: false },
    ],
    currentScene: { location: '码头', presentCharacters: [] },
    memoryCandidates: [
      { id: 'update-1', operation: 'update', memoryType: 'key_info', content: '新秘密', targetMemoryIds: ['old-1'], conflict: true, sourceMessageIds: [] },
      { id: 'scene-1', operation: 'scene_patch', scenePatch: { location: '车站', currentConflict: '', presentCharacters: [], environment: '雾' }, conflict: false, sourceMessageIds: [] },
    ],
  };
}

test('prompt and cards show exact actions, old/proposed/conflict content and closing preserves candidates', () => {
  const app = setup(); const state = snapshot(); app.ui.render(state);
  assert.equal(app.elements.promptText.textContent, 'TA 发现了 2 条新记忆');
  assert.equal(app.elements.promptBar.hidden, false);
  assert.ok(byText(app.elements.candidateList, '确认记忆'));
  assert.ok(byText(app.elements.candidateList, '修改'));
  assert.ok(byText(app.elements.candidateList, '不计入'));
  assert.ok(byText(app.elements.candidateList, '关键信息 · 建议更新'));
  assert.ok(descendants(app.elements.candidateList).some(node => node.textContent.includes('旧秘密')));
  assert.ok(descendants(app.elements.candidateList).some(node => node.textContent.includes('新秘密')));
  assert.ok(descendants(app.elements.candidateList).some(node => node.textContent.includes('冲突')));
  app.ui.openCandidateSheet(); app.ui.closeCandidateSheet();
  assert.equal(state.memoryCandidates.length, 2);
});

test('confirm and dismiss actions emit only the selected candidate and batch dismissal requires confirmation', () => {
  const app = setup(); const events = [];
  app.ui.on('candidate-confirm', payload => events.push(['confirm', payload]));
  app.ui.on('candidate-dismiss', payload => events.push(['dismiss', payload]));
  app.ui.on('candidate-dismiss-all', payload => events.push(['dismiss-all', payload]));
  app.ui.render(snapshot());
  byText(app.elements.candidateList, '确认记忆').dispatch('click');
  byText(app.elements.candidateList, '不计入').dispatch('click');
  byText(app.elements.candidateList, '全部不计入').dispatch('click');
  assert.deepEqual(plain(events), [
    ['confirm', { id: 'update-1', characterName: '阿宁', snapshotIdentity: 'snapshot-a' }],
    ['dismiss', { id: 'update-1', characterName: '阿宁', snapshotIdentity: 'snapshot-a' }],
    ['dismiss-all', { ids: ['update-1', 'scene-1'], characterName: '阿宁', snapshotIdentity: 'snapshot-a' }],
  ]);
  assert.equal(app.context.confirmCalls.length, 1);

  const cancelled = setup(false); let called = false;
  cancelled.ui.on('candidate-dismiss-all', () => { called = true; }); cancelled.ui.render(snapshot());
  byText(cancelled.elements.candidateList, '全部不计入').dispatch('click');
  assert.equal(called, false);
});

test('memory edit supports type content pinned target IDs resultStatus and save-and-confirm', () => {
  const app = setup(); let emitted;
  app.ui.on('candidate-edit', payload => { emitted = payload; return { ok: true }; });
  app.ui.render(snapshot()); byText(app.elements.candidateList, '修改').dispatch('click');
  const card = app.elements.candidateList.children[0];
  const type = byData(card, 'editField', 'memoryType');
  const content = byData(card, 'editField', 'content');
  const pinned = byData(card, 'editField', 'pinned');
  const targets = byData(card, 'editField', 'targetMemoryIds');
  const status = byData(card, 'editField', 'resultStatus');
  type.value = 'history_event'; content.value = '编辑后的事件'; pinned.checked = true; targets.value = 'old-1, old-2'; status.value = 'archived';
  byText(card, '保存并确认').dispatch('click');
  assert.deepEqual(plain(emitted), {
    id: 'update-1', characterName: '阿宁', snapshotIdentity: 'snapshot-a',
    edited: { memoryType: 'history_event', content: '编辑后的事件', pinned: true, targetMemoryIds: ['old-1', 'old-2'], resultStatus: 'archived' },
  });
});

test('scene edit differentiates omitted fields from explicit clear', () => {
  const app = setup(); let emitted;
  app.ui.on('candidate-edit', payload => { emitted = payload; return { ok: true }; });
  app.ui.render(snapshot());
  const sceneCard = app.elements.candidateList.children[1]; byText(sceneCard, '修改').dispatch('click');
  const location = byData(sceneCard, 'sceneField', 'location');
  const locationClear = byData(sceneCard, 'clearField', 'location');
  const goal = byData(sceneCard, 'sceneField', 'currentGoal');
  const goalClear = byData(sceneCard, 'clearField', 'currentGoal');
  const conflictClear = byData(sceneCard, 'clearField', 'currentConflict');
  const charactersClear = byData(sceneCard, 'clearField', 'presentCharacters');
  const environment = byData(sceneCard, 'sceneField', 'environment');
  const notes = byData(sceneCard, 'sceneField', 'notes');
  assert.equal(conflictClear.checked, true);
  assert.equal(charactersClear.checked, true);
  location.value = '钟楼'; locationClear.checked = false;
  goal.value = ''; goalClear.checked = true;
  environment.value = ''; // originally non-empty, so deleting it without checking clear omits the field
  notes.value = ''; // omitted because it was never proposed and is not explicitly cleared
  byText(sceneCard, '保存并确认').dispatch('click');
  assert.deepEqual(plain(emitted), {
    id: 'scene-1', characterName: '阿宁', snapshotIdentity: 'snapshot-a',
    edited: { scenePatch: { location: '钟楼', presentCharacters: [], currentGoal: '', currentConflict: '' } },
  });
});

test('detached edit and batch-action controls retain the character identity they were rendered for', () => {
  const app = setup();
  const events = [];
  app.ui.on('candidate-edit', payload => events.push(payload));
  app.ui.on('candidate-dismiss-all', payload => events.push(payload));
  app.ui.render(snapshot());
  const oldCard = app.elements.candidateList.children[0];
  byText(oldCard, '修改').dispatch('click');
  const oldSave = byText(oldCard, '保存并确认');
  const oldDismissAll = byText(app.elements.candidateList, '全部不计入');

  const next = snapshot();
  next.characterName = '新角色';
  next.snapshotIdentity = 'snapshot-b';
  app.ui.render(next);
  oldSave.dispatch('click');
  oldDismissAll.dispatch('click');

  assert.equal(events[0].characterName, '阿宁');
  assert.equal(events[0].snapshotIdentity, 'snapshot-a');
  assert.equal(events[1].characterName, '阿宁');
  assert.equal(events[1].snapshotIdentity, 'snapshot-a');
});

test('memory candidate edit drafts survive same-identity renders and failed confirmation', () => {
  const app = setup();
  const state = snapshot();
  app.ui.render(state);
  let card = app.elements.candidateList.children[0];
  byText(card, '修改').dispatch('click');
  const draftValues = {
    memoryType: 'history_event', content: '未保存的候选草稿', targetMemoryIds: 'old-1, old-2', resultStatus: 'archived',
  };
  Object.entries(draftValues).forEach(([key, value]) => {
    const control = byData(card, 'editField', key); control.value = value; control.dispatch(key === 'content' ? 'input' : 'change');
  });
  const pinned = byData(card, 'editField', 'pinned'); pinned.checked = true; pinned.dispatch('change');

  app.ui.render(state);
  card = app.elements.candidateList.children[0];
  assert.equal(byData(card, 'editField', 'memoryType').value, 'history_event');
  assert.equal(byData(card, 'editField', 'content').value, '未保存的候选草稿');
  assert.equal(byData(card, 'editField', 'pinned').checked, true);
  assert.equal(byData(card, 'editField', 'targetMemoryIds').value, 'old-1, old-2');
  assert.equal(byData(card, 'editField', 'resultStatus').value, 'archived');
  assert.equal(byData(card, 'editField', 'content').parentNode.parentNode.hidden, false);

  app.ui.on('candidate-edit', () => { app.ui.render(state); return { ok: false }; });
  byText(card, '保存并确认').dispatch('click');
  card = app.elements.candidateList.children[0];
  assert.equal(byData(card, 'editField', 'content').value, '未保存的候选草稿');
  assert.equal(byData(card, 'editField', 'pinned').checked, true);
  assert.equal(byData(card, 'editField', 'content').parentNode.parentNode.hidden, false);
});

test('scene candidate drafts preserve field values and clear flags across failed rerenders', () => {
  const app = setup(); const state = snapshot(); app.ui.render(state);
  let card = app.elements.candidateList.children[1]; byText(card, '修改').dispatch('click');
  const location = byData(card, 'sceneField', 'location'); location.value = '钟楼草稿'; location.dispatch('input');
  const locationClear = byData(card, 'clearField', 'location'); locationClear.checked = true; locationClear.dispatch('change');
  const notes = byData(card, 'sceneField', 'notes'); notes.value = '备注草稿'; notes.dispatch('input');
  const notesClear = byData(card, 'clearField', 'notes'); notesClear.checked = false; notesClear.dispatch('change');

  app.ui.on('candidate-edit', () => { app.ui.render(state); return { ok: false }; });
  byText(card, '保存并确认').dispatch('click');
  card = app.elements.candidateList.children[1];
  assert.equal(byData(card, 'sceneField', 'location').value, '钟楼草稿');
  assert.equal(byData(card, 'clearField', 'location').checked, true);
  assert.equal(byData(card, 'sceneField', 'notes').value, '备注草稿');
  assert.equal(byData(card, 'clearField', 'notes').checked, false);
  assert.equal(byData(card, 'sceneField', 'location').parentNode.parentNode.parentNode.hidden, false);
});

test('successful candidate decisions clear their drafts while identity changes clear every candidate draft', () => {
  function assertActionClears(actionText, eventName) {
    const app = setup(); const state = snapshot(); app.ui.render(state);
    const card = app.elements.candidateList.children[0]; byText(card, '修改').dispatch('click');
    const content = byData(card, 'editField', 'content'); content.value = `${eventName}-draft`; content.dispatch('input');
    app.ui.on(eventName, () => {
      const removed = snapshot(); removed.memoryCandidates = [];
      app.ui.render(removed); return { ok: true };
    });
    byText(eventName === 'candidate-edit' ? card : app.elements.candidateList, actionText).dispatch('click');
    app.ui.render(state);
    const restored = app.elements.candidateList.children[0]; byText(restored, '修改').dispatch('click');
    assert.equal(byData(restored, 'editField', 'content').value, '新秘密', eventName);
  }
  assertActionClears('保存并确认', 'candidate-edit');
  assertActionClears('确认记忆', 'candidate-confirm');
  assertActionClears('不计入', 'candidate-dismiss');
  assertActionClears('全部不计入', 'candidate-dismiss-all');

  const switched = setup(); const state = snapshot(); switched.ui.render(state);
  let card = switched.elements.candidateList.children[0]; byText(card, '修改').dispatch('click');
  let content = byData(card, 'editField', 'content'); content.value = 'stale-draft'; content.dispatch('input');
  const imported = snapshot(); imported.snapshotIdentity = 'snapshot-b'; switched.ui.render(imported);
  switched.ui.render(state);
  card = switched.elements.candidateList.children[0]; byText(card, '修改').dispatch('click');
  assert.equal(byData(card, 'editField', 'content').value, '新秘密');

  content = byData(card, 'editField', 'content'); content.value = 'second-stale-draft'; content.dispatch('input');
  const other = snapshot(); other.characterName = '新角色'; switched.ui.render(other);
  switched.ui.render(state);
  card = switched.elements.candidateList.children[0]; byText(card, '修改').dispatch('click');
  assert.equal(byData(card, 'editField', 'content').value, '新秘密');
});

test('candidate draft remains the single source of truth when moving between sheet and pending panel', () => {
  function editAll(card, prefix) {
    const type = byData(card, 'editField', 'memoryType'); type.value = 'history_event'; type.dispatch('change');
    const content = byData(card, 'editField', 'content'); content.value = `${prefix}-content`; content.dispatch('input');
    const pinned = byData(card, 'editField', 'pinned'); pinned.checked = true; pinned.dispatch('change');
    const targets = byData(card, 'editField', 'targetMemoryIds'); targets.value = `${prefix}-one, ${prefix}-two`; targets.dispatch('input');
    const status = byData(card, 'editField', 'resultStatus'); status.value = 'archived'; status.dispatch('change');
  }
  function assertAll(card, prefix) {
    assert.equal(byData(card, 'editField', 'memoryType').value, 'history_event');
    assert.equal(byData(card, 'editField', 'content').value, `${prefix}-content`);
    assert.equal(byData(card, 'editField', 'pinned').checked, true);
    assert.equal(byData(card, 'editField', 'targetMemoryIds').value, `${prefix}-one, ${prefix}-two`);
    assert.equal(byData(card, 'editField', 'resultStatus').value, 'archived');
  }

  const sheetToCenter = setup(); sheetToCenter.ui.render(snapshot());
  let sheetCard = sheetToCenter.elements.candidateList.children[0]; byText(sheetCard, '修改').dispatch('click'); editAll(sheetCard, 'sheet');
  sheetToCenter.ui.openCandidateSheet(); sheetToCenter.elements.candidateCenterButton.dispatch('click');
  let pendingCard = sheetToCenter.elements.pendingList.children[1]; byText(pendingCard, '修改').dispatch('click');
  assertAll(pendingCard, 'sheet');

  const centerToSheet = setup(); centerToSheet.ui.render(snapshot());
  pendingCard = centerToSheet.elements.pendingList.children[1]; byText(pendingCard, '修改').dispatch('click'); editAll(pendingCard, 'center');
  centerToSheet.elements.promptBar.dispatch('click');
  sheetCard = centerToSheet.elements.candidateList.children[0]; byText(sheetCard, '修改').dispatch('click');
  assertAll(sheetCard, 'center');
});
