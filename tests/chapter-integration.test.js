const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('node:fs'); const vm = require('node:vm');
const html = fs.readFileSync('index.html', 'utf8');
function extract(name) { const match = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(html); assert.ok(match, `${name} missing`); const open = html.indexOf('{', match.index); let depth = 0; for (let i = open; i < html.length; i += 1) { if (html[i] === '{') depth += 1; else if (html[i] === '}' && --depth === 0) return html.slice(match.index, i + 1); } throw new Error(`unclosed ${name}`); }
test('send tags both messages and archives a complete chapter turn before persistence', () => { const send = extract('sendMessage'); assert.match(send, /chapterId:\s*state\.activeChapterId\s*\|\|\s*undefined/); assert.match(send, /assistantMsg[\s\S]*chapterId:\s*userMsg\.chapterId/); assert.match(send, /appendCompletedTurn/); assert.ok(send.indexOf('appendCompletedTurn') < send.indexOf('saveCurrentCharacter()')); });
test('conversation snapshots include chapter data for atomic rollback', () => { const capture = extract('captureConversationState'); const apply = extract('applyConversationState'); ['chapterSchemaVersion', 'chapters', 'activeChapterId'].forEach(key => { assert.match(capture, new RegExp(key)); assert.match(apply, new RegExp(key)); }); });
test('edit and regenerate synchronize active chapter transcript', () => { assert.match(extract('commitMessageEdit'), /replaceAssistantMessage/); const regenerate = extract('regenerateMessage'); assert.match(regenerate, /chapterId:\s*previousConversationState\.messages\[aiIdx\]\.chapterId/); assert.match(regenerate, /replaceAssistantMessage/); });
test('render and backtrack enforce active chapter ownership', () => { const render = extract('renderMessages'); assert.match(render, /canBacktrackChapterMessage/); assert.match(render, /canMutateChapterMessage/); const backtrack = extract('backtrackMessage'); assert.match(backtrack, /canBacktrackChapterMessage/); assert.match(backtrack, /truncateActiveChapterAfter/); });
test('API messages use chapter narrative context and persist chapter traces', () => { const build = extract('buildApiMessages'); assert.match(build, /buildNarrativeContext/); assert.match(build, /chapterSummaryIds/); const trace = extract('recordMemoryRequestTrace'); assert.match(trace, /usedActiveChapterRollingSummary/); assert.match(trace, /usedUnchapteredSummary/); });
test('API messages use the active response profile for recent, chapter, and memory budgets', () => { const build = extract('buildApiMessages'); assert.match(build, /responsePolicy\.forPlan/); assert.match(build, /recentMessages/); assert.match(build, /narrativeCharacters/); assert.match(build, /memoryCharacters/); assert.match(build, /profile\.instruction/); });
test('automatic compaction uses ownership-aware plan and atomic apply', () => { const auto = extract('autoSummarize'); assert.match(auto, /buildCompactionPlan/); assert.match(auto, /applyCompactionResults/); assert.match(auto, /group\.needsSummary/); });
test('automatic compaction separates apply safety from request cleanup', async () => {
  const auto = extract('autoSummarize');
  const identityStart = auto.indexOf('function requestIdentityIsCurrent');
  const currentStart = auto.indexOf('function current');
  const identityBlock = auto.slice(identityStart, currentStart);
  const currentBlock = auto.slice(currentStart, auto.indexOf('var noteWrap', currentStart));
  assert.doesNotMatch(identityBlock, /state\.isStreaming/);
  assert.match(currentBlock, /!state\.isStreaming/);
  assert.match(auto, /finally[\s\S]*requestIdentityIsCurrent\(\)/);

  const state = { isStreaming: true, summarising: false, currentCharacter: '阿宁', messages: Array.from({ length: 31 }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'assistant' : 'user', content: 'x', chapterId: 'ended' })), summary: '', chapterSchemaVersion: 1, chapters: [{ id: 'ended', revision: 3 }], activeChapterId: null, memoryCandidates: [], memoryAnalysis: {}, memoryRequestTraces: {} };
  const note = { parentNode: null, querySelector: () => ({ textContent: '' }), remove() { this.parentNode = null; } };
  const sandbox = { state, MAX_MSG_BEFORE_SUMMARY: 30, RECENT_KEEP: 14, summaryRequestEpoch: 0, chapterContext: { buildCompactionPlan: () => ({ retiredMessageIds: ['m0'], groups: [{ chapterId: 'ended', needsSummary: false, discardOnly: true }] }) }, captureConversationState: () => ({ ...state }), document: { createElement: () => note }, chatArea: { appendChild: value => { value.parentNode = true; } }, scrollToBottom() {}, requestModel() { throw new Error('discard-only should not request'); }, createModelRequestPlan() {}, applyConversationState() {}, saveCurrentCharacter: () => ({ ok: true }), reportSaveFailure() {}, requestChapterSummary() {}, setTimeout() {}, renderMessages() {} };
  vm.runInNewContext(`${auto}; this.run = autoSummarize();`, sandbox);
  await sandbox.run;
  assert.equal(state.summarising, false);
});
test('successful compaction refreshes from request identity instead of the mutated revision signature', () => {
  const auto = extract('autoSummarize');
  assert.match(auto, /function requestIdentityIsCurrent\(\)/);
  assert.match(auto, /setTimeout\(function\(\) \{ noteWrap\.remove\(\); if \(!state\.isStreaming && requestIdentityIsCurrent\(\)\) renderMessages\(\); \}/);
});
test('rendering a persisted failed-send tail restores one retry action group', () => {
  const render = extract('renderMessages');
  const failed = extract('showFailedSendActions');
  assert.match(render, /latestMessage\.role === 'user'/);
  assert.match(render, /showFailedSendActions\(\)/);
  assert.match(failed, /querySelector\('\.model-failure-actions'\)/);
});
test('imported state always clears stale streaming and compaction flags', () => {
  const imported = extract('importData');
  assert.match(imported, /isStreaming:\s*false/);
  assert.match(imported, /summarising:\s*false/);
  assert.match(imported, /previousImportRequestState/);
  assert.match(imported, /summaryRequestEpoch\s*=\s*previousImportRequestState\.summary/);
  assert.match(imported, /characterSelectionEpoch\s*=\s*previousImportRequestState\.selection/);
});
test('summary confirmation and regeneration are blocked during a streaming reply', () => {
  const confirmStart = html.indexOf("chapterUI.on('confirm-summary'");
  const confirmBlock = html.slice(confirmStart, html.indexOf("chapterUI.on('regenerate-summary'", confirmStart));
  const regenerateStart = html.indexOf("chapterUI.on('regenerate-summary'");
  const regenerateBlock = html.slice(regenerateStart, html.indexOf('/* ---- Persistence ---- */', regenerateStart));
  assert.match(confirmBlock, /chapterOperationBlocked\(\)/);
  assert.match(regenerateBlock, /chapterOperationBlocked\(\)/);
});
test('chapter save failures reuse the full-backup storage warning', () => {
  const report = extract('reportChapterOperation');
  assert.match(report, /SAVE_FAILED/);
  assert.match(report, /reportSaveFailure\(result\.saveResult/);
  assert.match(report, /完整备份/);
});
test('chat save rollback reloads the persisted concurrent chapter summary instead of an old request snapshot', () => {
  const previous = { messages: [{ id: 'old' }], chapters: [{ id: 'ended', summary: { draftStatus: 'generating' } }] };
  const persisted = { messages: [{ id: 'old' }], summary: '', chapterSchemaVersion: 1, chapters: [{ id: 'ended', summary: { draftStatus: 'ready', draftText: '后台完成' } }], activeChapterId: null, memoryCandidates: [], memoryAnalysis: {}, memoryRequestTraces: {} };
  let applied = null;
  const sandbox = { previous, state: { currentCharacter: '阿宁' }, loadCharacterSnapshotForAnalysis: () => persisted, applyConversationState: value => { applied = value; } };
  vm.runInNewContext(`${extract('restoreConversationAfterSaveFailure')}; restoreConversationAfterSaveFailure(previous, { ok: false, rolledBack: true });`, sandbox);
  assert.equal(applied.chapters[0].summary.draftStatus, 'ready');
  assert.ok((html.match(/restoreConversationAfterSaveFailure\(/g) || []).length >= 5);
});
