const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('settings markup provides the category home and all five dedicated views', () => {
  assert.match(html, /data-settings-view="home"/);
  for (const route of ['character', 'identity', 'chapter-memory', 'model', 'data']) {
    assert.match(html, new RegExp(`data-settings-view="${route}"`));
    assert.match(html, new RegExp(`data-settings-route="${route}"`));
  }
});

test('settings redesign preserves legacy control identifiers', () => {
  for (const id of [
    'systemPromptInput', 'styleInput', 'userIdentityInput', 'rolesContainer',
    'memoryCenterBtn', 'chapterManagerBtn', 'glmApiKeyInput', 'defaultProviderSelect',
    'bgUploadBtn', 'exportBtn', 'importBtn', 'clearChatBtn', 'deleteCharBtn'
  ]) {
    assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
  }
});

test('long-text editor has explicit save and cancel actions plus unsaved protection', () => {
  assert.match(html, /id="settingsTextEditor"/);
  assert.match(html, /id="settingsEditorTextarea"/);
  assert.match(html, /id="settingsEditorSaveBtn"/);
  assert.match(html, /id="settingsEditorCancelBtn"/);
  assert.match(html, /有未保存的修改/);
});

test('settings stylesheet and UI controller are loaded', () => {
  assert.match(html, /css\/settings\.css/);
  assert.match(html, /js\/settings\/settings-ui\.js/);
});

test('background focus is wired through character persistence flows', () => {
  const focusReferences = html.match(/bgCardFocus/g) || [];
  assert.ok(focusReferences.length >= 8, `expected at least 8 bgCardFocus references, got ${focusReferences.length}`);
});

test('background focus editor provides drag, range, reset, cancel, and save controls', () => {
  for (const id of [
    'bgCardFocusBtn', 'settingsBackgroundFocusEditor', 'settingsFocusPreview',
    'settingsFocusImage', 'settingsFocusX', 'settingsFocusY',
    'settingsFocusResetBtn', 'settingsFocusCancelBtn', 'settingsFocusSaveBtn'
  ]) {
    assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
  }
  assert.doesNotMatch(html, /settings-character-fallback\.png/);
});
