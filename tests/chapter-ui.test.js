const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('node:fs'); const vm = require('node:vm');
function loadUI() { const s = { globalThis: null }; s.globalThis = s; vm.createContext(s); vm.runInContext(fs.readFileSync('js/chapter/chapter-ui.js', 'utf8'), s); return s.FonlingChapter.UI; }
test('chapter status is optional and shows the active name', () => { const ui = loadUI(); assert.equal(ui.statusText({ chapters: [], activeChapterId: null }), '当前章节：无'); assert.equal(ui.statusText({ chapters: [{ id: 'c', name: '很长的章节名', status: 'active' }], activeChapterId: 'c' }), '当前章节：很长的章节名'); });
test('pending list includes ready, failed, and generating summaries', () => { const ui = loadUI(); const chapters = ['ready', 'failed', 'generating', 'none'].map(status => ({ id: status, status: 'ended', summary: { draftStatus: status } })); assert.deepEqual(Array.from(ui.pendingChapters({ chapters }), x => x.id), ['ready', 'failed', 'generating']); });
test('page declares three-part status, chapter manager, pending prompt, summary and raw transcript surfaces', () => { const html = fs.readFileSync('index.html', 'utf8'); assert.match(html, /css\/chapter\.css/); assert.match(html, /id="chapterStatus"/); assert.match(html, /id="chapterPromptBar"/); assert.match(html, /id="chapterManagerBtn"/); assert.match(html, /id="chapterManagerOverlay"/); assert.match(html, /id="chapterCurrent"/); assert.match(html, /id="chapterPending"/); assert.match(html, /id="chapterEnded"/); assert.match(html, /id="chapterDetail"/); assert.match(html, /js\/chapter\/chapter-ui\.js/); });
test('chapter CSS ellipsizes status and provides mobile full-screen manager without horizontal overflow', () => { const css = fs.readFileSync('css/chapter.css', 'utf8'); assert.match(css, /#chapterStatus\{[^}]*text-overflow:ellipsis/); assert.match(css, /@media\(max-width:480px\)/); assert.match(css, /\.chapter-manager\{inset:0/); assert.match(css, /word-break:break-word/); });
test('summary confirmation reads the textarea beside the clicked action', () => {
  const source = fs.readFileSync('js/chapter/chapter-ui.js', 'utf8');
  assert.match(source, /button\.closest\('\.chapter-card, \.chapter-manager-detail'\)/);
  assert.match(source, /fieldRoot\.querySelector\(`\[data-summary-input="\$\{chapterId\}"\]`\)/);
});
test('a failed-send chapter tail disables cancel and end actions until retry completes', () => {
  const source = fs.readFileSync('js/chapter/chapter-ui.js', 'utf8');
  assert.match(source, /activeChapterBoundary\(state\)/);
  assert.match(source, /boundary\.pendingMessages\.length/);
  assert.match(source, /请先完成或重试当前回复/);
});
test('chapter manager modal moves, traps, and restores keyboard focus', () => {
  const source = fs.readFileSync('js/chapter/chapter-ui.js', 'utf8');
  assert.match(source, /restoreFocusTo/);
  assert.match(source, /input\.closeButton\.focus\(\)/);
  assert.match(source, /event\.key === 'Escape'/);
  assert.match(source, /event\.key !== 'Tab'/);
  assert.match(source, /target\.focus\(\)/);
});
