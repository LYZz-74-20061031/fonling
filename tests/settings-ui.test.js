const test = require('node:test');
const assert = require('node:assert/strict');

const SettingsUI = require('../js/settings/settings-ui.js');

test('getOverview derives the current character, chapter, roles, and pending summaries', () => {
  const overview = SettingsUI.getOverview({
    currentCharacter: '阿宁',
    activeChapterId: 'chapter-1',
    chapters: [
      { id: 'chapter-1', name: '雨夜', status: 'active', summary: { draftStatus: 'none' } },
      { id: 'chapter-0', name: '初见', status: 'ended', summary: { draftStatus: 'ready' } },
      { id: 'chapter-old', name: '旧事', status: 'ended', summary: { draftStatus: 'confirmed' } }
    ],
    roles: [{ name: '主控替身' }, { name: '旁观者' }]
  });

  assert.equal(overview.characterName, '阿宁');
  assert.equal(overview.chapterText, '当前章节：雨夜');
  assert.equal(overview.identityDetail, '主控身份、2 个切换身份');
  assert.equal(overview.pendingSummaryCount, 1);
  assert.equal(overview.chapterDetail, '有 1 份新摘要待确认');
});

test('getOverview returns calm empty-state copy when no chapter or pending summary exists', () => {
  const overview = SettingsUI.getOverview({ currentCharacter: '', chapters: [], roles: [] });
  assert.equal(overview.characterName, '未登录');
  assert.equal(overview.chapterText, '当前章节：无');
  assert.equal(overview.identityDetail, '主控身份、暂无切换身份');
  assert.equal(overview.chapterDetail, '章节、摘要与长期记忆');
});

test('navigator changes category views and rejects unknown routes', () => {
  const navigator = SettingsUI.createNavigator(['home', 'character', 'identity']);
  assert.equal(navigator.currentView(), 'home');
  assert.equal(navigator.openView('character'), true);
  assert.equal(navigator.currentView(), 'character');
  assert.equal(navigator.openView('missing'), false);
  assert.equal(navigator.currentView(), 'character');
  navigator.goHome();
  assert.equal(navigator.currentView(), 'home');
});

test('navigator tracks dirty editor state and protects unsaved text', () => {
  const navigator = SettingsUI.createNavigator(['home', 'character']);
  navigator.beginEdit({ key: 'systemPrompt', title: 'AI 人设与世界观', value: '原文' });
  assert.equal(navigator.editor().dirty, false);
  navigator.updateDraft('修改后的内容');
  assert.equal(navigator.editor().dirty, true);
  assert.equal(navigator.canCloseEditor(() => false), false);
  assert.equal(navigator.editor().open, true);
  assert.equal(navigator.canCloseEditor(() => true), true);
  assert.equal(navigator.editor().open, false);
});

test('normalizeBackgroundFocus supplies defaults and clamps unsafe values', () => {
  assert.deepEqual(SettingsUI.normalizeBackgroundFocus(), { x: 50, y: 35 });
  assert.deepEqual(SettingsUI.normalizeBackgroundFocus({ x: -12, y: 140 }), { x: 0, y: 100 });
  assert.deepEqual(SettingsUI.normalizeBackgroundFocus({ x: '72', y: Infinity }), { x: 72, y: 35 });
});

test('getCoverMetrics reports overflow for a portrait image in a wide card', () => {
  assert.deepEqual(SettingsUI.getCoverMetrics({
    imageWidth: 600, imageHeight: 1200, frameWidth: 360, frameHeight: 180
  }), {
    scale: 0.6, renderedWidth: 360, renderedHeight: 720, overflowX: 0, overflowY: 540
  });
});

test('focusAfterDrag moves portrait focus vertically without exposing empty space', () => {
  const metrics = SettingsUI.getCoverMetrics({
    imageWidth: 600, imageHeight: 1200, frameWidth: 360, frameHeight: 180
  });
  assert.deepEqual(SettingsUI.focusAfterDrag({
    focus: { x: 50, y: 50 }, deltaX: 30, deltaY: 54, metrics
  }), { x: 50, y: 40 });
  assert.deepEqual(SettingsUI.focusAfterDrag({
    focus: { x: 50, y: 5 }, deltaX: 0, deltaY: 999, metrics
  }), { x: 50, y: 0 });
});

test('focusAfterDrag moves landscape focus horizontally', () => {
  const metrics = SettingsUI.getCoverMetrics({
    imageWidth: 1200, imageHeight: 400, frameWidth: 360, frameHeight: 180
  });
  assert.deepEqual(SettingsUI.focusAfterDrag({
    focus: { x: 50, y: 35 }, deltaX: 18, deltaY: 50, metrics
  }), { x: 40, y: 35 });
});
