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
  constructor(tag = 'div', document) { this.tagName = tag.toUpperCase(); this.ownerDocument = document; this.children = []; this.listeners = {}; this.attributes = {}; this.classList = new FakeClassList(); this.dataset = {}; this.hidden = false; this.value = ''; this.checked = false; this.textContent = ''; }
  appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
  removeChild(child) { this.children.splice(this.children.indexOf(child), 1); }
  get firstChild() { return this.children[0] || null; }
  addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
  dispatch(type, extra = {}) { (this.listeners[type] || []).forEach(handler => handler({ target: this, key: extra.key, shiftKey: extra.shiftKey, preventDefault() { extra.prevented = true; } })); return extra; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name]; }
  focus() { this.ownerDocument.activeElement = this; }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  closest(selector) { if (selector === '[hidden]') { for (let node = this; node; node = node.parentNode) if (node.hidden) return node; } return null; }
  querySelectorAll(selector) {
    const all = []; const walk = node => { node.children.forEach(child => { all.push(child); walk(child); }); }; walk(this);
    if (selector.includes('button')) {
      const tags = [];
      if (selector.includes('button')) tags.push('BUTTON');
      if (selector.includes('input')) tags.push('INPUT');
      if (selector.includes('textarea')) tags.push('TEXTAREA');
      if (selector.includes('select')) tags.push('SELECT');
      return all.filter(node => tags.includes(node.tagName) && !node.disabled && node.hidden !== true);
    }
    return all;
  }
}
function setup() {
  const document = { activeElement: null, listeners: {}, createElement(tag) { return new FakeNode(tag, this); }, addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }, dispatch(type, event) { (this.listeners[type] || []).forEach(handler => handler(event)); } };
  const timers = [];
  const context = { document, Date, confirm: () => true, setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {} };
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync('js/memory/memory-ui.js', 'utf8'), context);
  const node = tag => new FakeNode(tag, document);
  const overlay = node(), closeButton = node('button'), trigger = node('button'), toast = node(), centerSelect = node('select');
  const tabs = ['history', 'key-info', 'scene', 'pending'].map(name => { const tab = node('button'); tab.dataset.tab = name; return tab; });
  const panels = tabs.map(tab => { const panel = node(); panel.dataset.panel = tab.dataset.tab; return panel; });
  const sceneFields = { time: node('input'), location: node('input'), presentCharacters: node('input'), currentGoal: node('textarea'), currentConflict: node('textarea'), characterStates: node('textarea'), environment: node('textarea'), notes: node('textarea') };
  [closeButton, ...tabs, ...panels].forEach(child => overlay.appendChild(child));
  panels[2].appendChild(sceneFields.notes);
  overlay.appendChild(centerSelect);
  const candidateSheet = node(), candidateCloseButton = node('button'), candidateBackdrop = node(), candidateCenterButton = node('button');
  const candidateSelect = node('select');
  candidateSheet.hidden = true;
  candidateSheet.appendChild(candidateCloseButton); candidateSheet.appendChild(candidateCenterButton); candidateSheet.appendChild(candidateSelect);
  const manualForms = {
    history_event: { form: node('form'), input: node('textarea'), confirm: node('button'), cancel: node('button') },
    key_info: { form: node('form'), input: node('textarea'), confirm: node('button'), cancel: node('button') },
  };
  const elements = { overlay, closeButton, backdrop: node(), characterName: node(), tabs, panels, historyList: node(), keyInfoList: node(), pendingList: node(), sceneFields, addHistory: node('button'), addKeyInfo: node('button'), saveScene: node('button'), clearScene: node('button'), analyzeButton: node('button'), candidateSheet, candidateCloseButton, candidateBackdrop, candidateCenterButton, promptBar: node(), promptText: node(), manualForms, toast };
  const ui = context.FonlingMemory.UI.createMemoryUI(elements);
  return { context, document, timers, elements, ui, trigger, centerSelect, candidateSelect };
}
function snapshot() { return { characterName: 'Mira', memories: [
  { id: 'a', type: 'key_info', content: 'A saved', status: 'active', pinned: false },
  { id: 'b', type: 'key_info', content: 'B saved', status: 'active', pinned: false },
], currentScene: { location: 'Vault', presentCharacters: [] }, memoryCandidates: [] }; }

test('render preserves another memory draft and scene drafts across successful operations', () => {
  const app = setup(); app.ui.render(snapshot());
  const draftA = app.elements.keyInfoList.children[0].children[0]; draftA.value = 'A unsaved'; draftA.dispatch('input');
  app.elements.sceneFields.location.value = 'Harbor draft'; app.elements.sceneFields.location.dispatch('input');
  const changed = snapshot(); changed.memories[1].pinned = true; app.ui.render(changed);
  assert.equal(app.elements.keyInfoList.children[0].children[0].value, 'A unsaved');
  assert.equal(app.elements.sceneFields.location.value, 'Harbor draft');
});

test('failed memory and scene saves retain the triggering drafts after controller rerender', () => {
  const app = setup(); app.ui.render(snapshot());
  app.ui.on('updateMemory', () => { app.ui.render(snapshot()); return { ok: false }; });
  app.ui.on('patchScene', () => { app.ui.render(snapshot()); return { ok: false }; });
  const memoryDraft = app.elements.keyInfoList.children[0].children[0]; memoryDraft.value = 'Failed memory draft'; memoryDraft.dispatch('input');
  app.elements.keyInfoList.children[0].children[2].children[0].dispatch('click');
  assert.equal(app.elements.keyInfoList.children[0].children[0].value, 'Failed memory draft');
  app.elements.sceneFields.location.value = 'Failed scene draft'; app.elements.sceneFields.location.dispatch('input'); app.elements.saveScene.dispatch('click');
  assert.equal(app.elements.sceneFields.location.value, 'Failed scene draft');
});

test('failed pin save restores the checkbox through its real change event', () => {
  const app = setup(); app.ui.render(snapshot());
  app.ui.on('togglePinned', () => { app.ui.render(snapshot()); return { ok: false }; });
  const checkbox = app.elements.keyInfoList.children[0].children[2].children[1].children[0];
  assert.equal(checkbox.checked, false);
  checkbox.checked = true;
  checkbox.dispatch('change');
  const restored = app.elements.keyInfoList.children[0].children[2].children[1].children[0];
  assert.equal(restored.checked, false);
});

test('character or complete snapshot identity changes clear drafts even when memory IDs match', () => {
  const app = setup(); app.ui.render(snapshot());
  const memoryDraft = app.elements.keyInfoList.children[0].children[0]; memoryDraft.value = 'Mira draft'; memoryDraft.dispatch('input');
  app.elements.sceneFields.location.value = 'Mira scene draft'; app.elements.sceneFields.location.dispatch('input');

  const otherCharacter = snapshot(); otherCharacter.characterName = 'Ari'; otherCharacter.memories[0].content = 'Ari saved'; otherCharacter.currentScene.location = 'Ari scene';
  app.ui.render(otherCharacter);
  assert.equal(app.elements.keyInfoList.children[0].children[0].value, 'Ari saved');
  assert.equal(app.elements.sceneFields.location.value, 'Ari scene');

  const imported = snapshot(); imported.characterName = 'Ari'; imported.snapshotIdentity = 'import-2'; imported.memories[0].content = 'Imported saved'; imported.currentScene.location = 'Imported scene';
  app.elements.keyInfoList.children[0].children[0].value = 'Ari draft'; app.elements.keyInfoList.children[0].children[0].dispatch('input');
  app.elements.sceneFields.location.value = 'Ari scene draft'; app.elements.sceneFields.location.dispatch('input');
  app.ui.render(imported);
  assert.equal(app.elements.keyInfoList.children[0].children[0].value, 'Imported saved');
  assert.equal(app.elements.sceneFields.location.value, 'Imported scene');
});

test('clear scene success removes drafts while failure preserves them', () => {
  const success = setup(); success.ui.render(snapshot()); success.ui.on('clearScene', () => { const empty = snapshot(); empty.currentScene.location = ''; success.ui.render(empty); return { ok: true }; });
  success.elements.sceneFields.location.value = 'Draft'; success.elements.sceneFields.location.dispatch('input'); success.elements.clearScene.dispatch('click');
  assert.equal(success.elements.sceneFields.location.value, '');

  const failure = setup(); failure.ui.render(snapshot()); failure.ui.on('clearScene', () => { failure.ui.render(snapshot()); return { ok: false }; });
  failure.elements.sceneFields.location.value = 'Kept draft'; failure.elements.sceneFields.location.dispatch('input'); failure.elements.clearScene.dispatch('click');
  assert.equal(failure.elements.sceneFields.location.value, 'Kept draft');
});

test('modal manages focus, escape, tab trap, and arrow-key tab navigation', () => {
  const app = setup(); app.trigger.focus(); app.ui.openCenter('history');
  assert.equal(app.document.activeElement, app.elements.tabs[0]);
  app.elements.tabs[0].dispatch('keydown', { key: 'ArrowRight' });
  assert.equal(app.document.activeElement, app.elements.tabs[1]);
  app.elements.tabs[2].dispatch('click');
  app.elements.closeButton.focus();
  const backward = { key: 'Tab', shiftKey: true, preventDefault() { this.prevented = true; } };
  app.document.dispatch('keydown', backward);
  assert.equal(backward.prevented, true);
  assert.equal(app.document.activeElement, app.centerSelect);
  const forward = { key: 'Tab', shiftKey: false, preventDefault() { this.prevented = true; } };
  app.document.dispatch('keydown', forward);
  assert.equal(forward.prevented, true);
  assert.equal(app.document.activeElement, app.elements.closeButton);
  app.document.dispatch('keydown', { key: 'Escape', preventDefault() {} });
  assert.equal(app.elements.overlay.classList.contains('active'), false);
  assert.equal(app.document.activeElement, app.trigger);
});

test('toast is an alert and automatically hides', () => {
  const app = setup(); app.ui.showStorageWarning('Save failed');
  assert.equal(app.elements.toast.getAttribute('role'), 'alert');
  assert.equal(app.elements.toast.getAttribute('aria-live'), 'assertive');
  assert.equal(app.elements.toast.hidden, false);
  app.timers.at(-1)();
  assert.equal(app.elements.toast.hidden, true);
});

test('manual analysis loading state always resets after an asynchronous timeout result', async () => {
  const app = setup();
  let resolveAnalysis;
  app.elements.analyzeButton.textContent = '整理记忆';
  app.ui.on('manual-analyze', () => new Promise(resolve => { resolveAnalysis = resolve; }));
  app.elements.analyzeButton.dispatch('click');
  assert.equal(app.elements.analyzeButton.disabled, true);
  assert.equal(app.elements.analyzeButton.textContent, '正在整理…');
  resolveAnalysis({ ok: false, error: 'ANALYSIS_TIMEOUT' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.elements.analyzeButton.disabled, false);
  assert.equal(app.elements.analyzeButton.textContent, '整理记忆');
});

test('render announces pending candidates and candidate sheet controls open close and enter center', () => {
  const app = setup();
  const state = snapshot(); state.memoryCandidates = [{ id: 'candidate-1', content: 'Remember this' }];
  app.ui.render(state);
  assert.equal(app.elements.promptBar.hidden, false);
  assert.match(app.elements.promptText.textContent, /1/);
  app.elements.promptBar.dispatch('click');
  assert.equal(app.elements.candidateSheet.hidden, false);
  assert.equal(app.elements.candidateSheet.getAttribute('aria-hidden'), 'false');
  app.elements.candidateCloseButton.dispatch('click');
  assert.equal(app.elements.candidateSheet.hidden, true);
  app.ui.openCandidateSheet();
  app.elements.candidateBackdrop.dispatch('click');
  assert.equal(app.elements.candidateSheet.hidden, true);
  app.ui.openCandidateSheet();
  app.elements.candidateCenterButton.dispatch('click');
  assert.equal(app.elements.candidateSheet.hidden, true);
  assert.equal(app.elements.overlay.classList.contains('active'), true);
  assert.equal(app.elements.tabs[3].getAttribute('aria-selected'), 'true');
});

test('candidate sheet traps focus, closes with escape, and restores its trigger without affecting center', () => {
  const app = setup();
  app.elements.promptBar.focus(); app.ui.openCandidateSheet();
  assert.equal(app.document.activeElement, app.elements.candidateCloseButton);

  const backward = { key: 'Tab', shiftKey: true, preventDefault() { this.prevented = true; } };
  app.document.dispatch('keydown', backward);
  assert.equal(backward.prevented, true);
  assert.equal(app.document.activeElement, app.candidateSelect);
  const forward = { key: 'Tab', shiftKey: false, preventDefault() { this.prevented = true; } };
  app.document.dispatch('keydown', forward);
  assert.equal(forward.prevented, true);
  assert.equal(app.document.activeElement, app.elements.candidateCloseButton);

  app.document.dispatch('keydown', { key: 'Escape', preventDefault() {} });
  assert.equal(app.elements.candidateSheet.hidden, true);
  assert.equal(app.document.activeElement, app.elements.promptBar);

  app.trigger.focus(); app.ui.openCenter('history');
  app.document.dispatch('keydown', { key: 'Escape', preventDefault() {} });
  assert.equal(app.elements.overlay.classList.contains('active'), false);
  assert.equal(app.document.activeElement, app.trigger);
});

test('manual add form opens, cancels, succeeds and retains input on failure', () => {
  const app = setup();
  const history = app.elements.manualForms.history_event;
  history.form.hidden = true;
  app.elements.addHistory.dispatch('click');
  assert.equal(history.form.hidden, false);
  assert.equal(app.document.activeElement, history.input);
  history.input.value = 'cancel me'; history.cancel.dispatch('click');
  assert.equal(history.form.hidden, true);
  assert.equal(history.input.value, '');

  let submitted;
  app.ui.on('addMemory', payload => { submitted = payload; return { ok: true }; });
  app.elements.addHistory.dispatch('click'); history.input.value = 'A new event'; history.form.dispatch('submit');
  assert.equal(submitted.type, 'history_event');
  assert.equal(submitted.content, 'A new event');
  assert.equal(submitted.source, 'manual');
  assert.equal(history.form.hidden, true);
  assert.equal(history.input.value, '');

  const keyInfo = app.elements.manualForms.key_info;
  keyInfo.form.hidden = true;
  app.ui.on('addMemory', payload => payload.type === 'key_info' ? { ok: false } : undefined);
  app.elements.addKeyInfo.dispatch('click'); keyInfo.input.value = 'Keep after failure'; keyInfo.form.dispatch('submit');
  assert.equal(keyInfo.form.hidden, false);
  assert.equal(keyInfo.input.value, 'Keep after failure');
});

test('character identity changes close and clear manual add forms', () => {
  const app = setup(); app.ui.render(snapshot());
  const history = app.elements.manualForms.history_event;
  const keyInfo = app.elements.manualForms.key_info;
  app.elements.addHistory.dispatch('click'); history.input.value = 'Mira history draft';
  app.elements.addKeyInfo.dispatch('click'); keyInfo.input.value = 'Mira key draft';

  const otherCharacter = snapshot(); otherCharacter.characterName = 'Ari';
  app.ui.render(otherCharacter);

  assert.equal(history.form.hidden, true);
  assert.equal(history.input.value, '');
  assert.equal(keyInfo.form.hidden, true);
  assert.equal(keyInfo.input.value, '');
});
