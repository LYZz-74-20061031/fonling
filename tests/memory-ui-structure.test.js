const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('index.html', 'utf8');

test('memory center assets load in dependency order and required IDs are unique', () => {
  assert.match(html, /<link[^>]+href="css\/memory\.css"/);
  const order = [
    'js/memory/memory-model.js',
    'js/memory/memory-storage.js',
    'js/memory/memory-ui.js',
    'js/memory/memory-controller.js',
    '<script>',
  ].map(token => html.indexOf(token));
  assert.ok(order.every(index => index >= 0));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));

  const ids = [
    'memoryCenterBtn', 'memoryPromptBar', 'memoryPromptText', 'memoryCandidateSheet',
    'memoryCenterOverlay', 'memoryCenterTabs', 'memoryHistoryPanel', 'memoryKeyInfoPanel',
    'memoryScenePanel', 'memoryPendingPanel', 'memoryAnalyzeBtn',
  ];
  ids.forEach(id => assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, id));
  const tabPairs = [
    ['memoryHistoryTab', 'memoryHistoryPanel'], ['memoryKeyInfoTab', 'memoryKeyInfoPanel'],
    ['memorySceneTab', 'memoryScenePanel'], ['memoryPendingTab', 'memoryPendingPanel'],
  ];
  tabPairs.forEach(([tab, panel]) => {
    assert.match(html, new RegExp(`id="${tab}"[^>]+aria-controls="${panel}"`));
    assert.match(html, new RegExp(`id="${panel}"[^>]+aria-labelledby="${tab}"`));
  });
});

test('memory prompt bar sits directly above the chat input and announces the pending count', () => {
  assert.match(html, /<div id="memoryPromptBar"[^>]*aria-live="polite"[^>]*>[\s\S]*?<\/div>\s*<footer id="inputBar">/);
  assert.match(html, /id="memoryPromptText"/);
});

test('candidate bottom sheet and manual add forms have complete accessible structure', () => {
  assert.match(html, /id="memoryCandidateSheet"[^>]*aria-hidden="true"/);
  assert.match(html, /data-memory-candidate-backdrop/);
  assert.match(html, /class="memory-candidate-handle"[^>]*aria-hidden="true"/);
  assert.match(html, /id="memoryCandidateCloseBtn"[^>]*aria-label=/);
  assert.match(html, /id="memoryCandidateList"/);
  assert.match(html, /id="memoryCandidateCenterBtn"/);
  ['History', 'KeyInfo'].forEach(kind => {
    assert.match(html, new RegExp(`id="memoryAdd${kind}Form"[^>]*hidden`));
    assert.match(html, new RegExp(`id="memoryAdd${kind}Input"`));
    assert.match(html, new RegExp(`id="memoryAdd${kind}ConfirmBtn"`));
    assert.match(html, new RegExp(`id="memoryAdd${kind}CancelBtn"`));
  });
  assert.match(html, /历史事件、关键信息和当前场景在记忆中心统一管理。/);
  assert.equal(/\bprompt\s*\(/.test(html), false);
});

test('legacy memory editors and runtime functions are retired from index', () => {
  const retired = [
    'historyEventsContainer', 'keyInfoContainer', 'currentStateInput', 'addEventBtn', 'addKeyInfoBtn',
    'renderHistoryEvents', 'renderKeyInfo', 'state.historyEvents', 'state.keyInfo', 'state.currentState',
  ];
  retired.forEach(token => assert.equal(html.includes(token), false, token));
});

test('memory center stylesheet includes accessible targets, safe areas, scrolling and narrow layout', () => {
  const css = fs.readFileSync('css/memory.css', 'utf8');
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /overflow-y:\s*auto/);
  assert.match(css, /@media\s*\(max-width:\s*600px\)/);
  assert.match(css, /#memoryPromptBar\s*\{[^}]*flex-shrink:\s*0/);
  assert.match(css, /\.memory-candidate-sheet\s*\{[^}]*padding-bottom:\s*calc\([^)]*env\(safe-area-inset-bottom,\s*0px\)/);
  assert.match(css, /\.memory-candidate-list\s*\{[^}]*overflow-y:\s*auto/);
  assert.match(css, /@media\s*\(max-width:\s*480px\)[\s\S]*\.memory-candidate__actions\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*1fr\s+1fr\s+1fr/);
});
