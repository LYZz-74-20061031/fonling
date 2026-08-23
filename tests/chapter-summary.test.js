const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('node:fs'); const vm = require('node:vm');
function load() { const s = { globalThis: null, Date }; s.globalThis = s; vm.createContext(s); vm.runInContext(fs.readFileSync('js/chapter/chapter-model.js', 'utf8'), s); vm.runInContext(fs.readFileSync('js/chapter/chapter-context.js', 'utf8'), s); vm.runInContext(fs.readFileSync('js/chapter/chapter-controller.js', 'utf8'), s); return s.FonlingChapter; }
function ended() { return { id: 'c1', name: '雨夜', status: 'ended', revision: 4, endedAt: '2026-08-23T02:00:00Z', rollingSummary: '此前抵达山门', rollingSummaryThroughMessageId: 'a1', messages: [{ id: 'u1', role: 'user', speakerName: '主控', content: '出发' }, { id: 'a1', role: 'assistant', speakerName: '阿宁', content: '抵达' }, { id: 'u2', role: 'user', speakerName: '主控', content: '敲门' }, { id: 'a2', role: 'assistant', speakerName: '阿宁', content: '门开了' }], summary: { confirmedText: '', draftStatus: 'generating', draftText: '', sourceSceneText: '地点：山门；冲突：守卫阻拦' } }; }
test('final summary prompt uses rolling summary, only uncompressed raw text, and captured scene', () => { const chapter = load(); const messages = chapter.Controller.buildFinalSummaryMessages(ended()); const text = messages.map(x => x.content).join('\n'); assert.match(text, /600–1000/); assert.match(text, /1200/); assert.match(text, /此前抵达山门/); assert.match(text, /敲门/); assert.match(text, /门开了/); assert.doesNotMatch(text, /主控：出发/); assert.match(text, /守卫阻拦/); });
test('regenerating after confirmation uses the old confirmed summary as the ending-state reference', () => {
  const chapter = load(); let state = { chapterSchemaVersion: 1, chapters: [ended()], activeChapterId: null };
  state = chapter.Model.confirmSummary(state, 'c1', '旧确认摘要：众人留在山门，守卫的条件仍未解决。', '2026-08-23T02:10:00Z');
  state = chapter.Model.beginSummary(state, 'c1');
  const text = chapter.Controller.buildFinalSummaryMessages(state.chapters[0]).map(message => message.content).join('\n');
  assert.match(text, /上一版已确认摘要/);
  assert.match(text, /众人留在山门/);
});
test('final summary validation rejects empty or over-1200 output', () => { const controller = load().Controller; assert.equal(controller.validateFinalSummary('有效摘要').ok, true); assert.equal(controller.validateFinalSummary(' ').code, 'EMPTY_CHAPTER_SUMMARY'); assert.equal(controller.validateFinalSummary('长'.repeat(1201)).code, 'CHAPTER_SUMMARY_TOO_LONG'); });
test('async result identity requires character, chapter, revision, and epoch', () => { const controller = load().Controller; const request = { characterName: '阿宁', chapterId: 'c1', revision: 4, epoch: 7 }; const chapter = ended(); assert.equal(controller.summaryRequestMatches(request, { characterName: '阿宁', chapter, epoch: 7 }), true); assert.equal(controller.summaryRequestMatches(request, { characterName: '阿宁', chapter: { ...chapter, revision: 5 }, epoch: 7 }), false); assert.equal(controller.summaryRequestMatches(request, { characterName: '别人', chapter, epoch: 7 }), false); assert.equal(controller.summaryRequestMatches(request, { characterName: '阿宁', chapter, epoch: 8 }), false); });
test('index requests fixed free GLM and persists ready or failed state behind an epoch guard', () => { const html = fs.readFileSync('index.html', 'utf8'); assert.match(html, /function requestChapterSummary/); assert.match(html, /createModelRequestPlan\('summary',\s*\{\s*provider:\s*'glm'/); assert.match(html, /chapterSummaryRequestEpochs/); assert.match(html, /setSummaryDraft/); assert.match(html, /setSummaryFailure/); });
test('failed manual confirmation restores the in-flight summary request guard', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const start = html.indexOf("chapterUI.on('confirm-summary'");
  const block = html.slice(start, html.indexOf("chapterUI.on('regenerate-summary'", start));
  assert.match(block, /previousSummaryRequestGuard/);
  assert.match(block, /chapterSummaryEpoch\s*=\s*previousSummaryRequestGuard\.epoch/);
  assert.match(block, /delete chapterSummaryRequestEpochs\[requestKey\]/);
});
test('interrupted persisted generation is recovered on load and import', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const loadStart = html.indexOf('function loadCharacterData');
  const loadBlock = html.slice(loadStart, html.indexOf('function saveCurrentCharacter', loadStart));
  const importStart = html.indexOf('function normalizeImportedCharacter');
  const importBlock = html.slice(importStart, html.indexOf('function importData', importStart));
  assert.match(loadBlock, /recoverInterruptedSummaries/);
  assert.match(loadBlock, /chapterSummaryRequestIsTracked/);
  assert.match(importBlock, /recoverInterruptedSummaries/);
});
test('a background summary save failure becomes retryable and reports the storage warning', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const start = html.indexOf('function applyChapterSummaryMutation');
  const block = html.slice(start, html.indexOf('async function requestChapterSummary', start));
  assert.match(block, /setSummaryFailure/);
  assert.match(block, /reportSaveFailure/);
  assert.match(block, /章节摘要保存失败/);
});
test('completed summary requests remove only their own active tracking key', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const start = html.indexOf('async function requestChapterSummary');
  const block = html.slice(start, html.indexOf('/* ---- Background ---- */', start));
  assert.match(block, /finally/);
  assert.match(block, /chapterSummaryRequestEpochs\[key\] === epoch/);
  assert.match(block, /delete chapterSummaryRequestEpochs\[key\]/);
});
