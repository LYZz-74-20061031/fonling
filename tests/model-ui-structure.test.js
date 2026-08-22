const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('index.html', 'utf8');
const css = fs.existsSync('css/model.css') ? fs.readFileSync('css/model.css', 'utf8') : '';

test('global model settings expose GLM first and keep DeepSeek in a collapsed backup section', () => {
  for (const id of [
    'glmApiKeyInput', 'toggleGlmKeyBtn', 'testGlmBtn', 'glmConnectionStatus',
    'defaultProviderSelect', 'deepseekApiKeyInput', 'toggleDeepseekKeyBtn',
    'testDeepseekBtn', 'deepseekConnectionStatus',
  ]) {
    assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, `${id} must exist exactly once`);
  }
  assert.match(html, /模型服务（全局）/);
  assert.match(html, /对所有智能体生效，不随角色 JSON 导入或导出/);
  assert.match(html, /GLM-4\.7-Flash/);
  assert.match(html, /GLM-4\.5-Air/);
  assert.match(html, /<details[^>]*id="deepseekBackupSettings"/);
  assert.match(html, /不会自动调用/);
});

test('composer has the compact left model control and right role indicator', () => {
  const status = html.match(/<div id="modelStatusBar"[\s\S]*?<\/div>\s*<\/div>/)?.[0] || '';
  assert.match(status, /id="airModeBtn"/);
  assert.match(status, /深度思考（付费模型）/);
  assert.match(status, /id="identityBar"/);
  assert.match(status, /id="identityDot"/);
  assert.match(status, /id="identityName"/);
  assert.ok(status.indexOf('airModeBtn') < status.indexOf('identityBar'));
});

test('model stylesheet keeps the status row compact on mobile and send button white with black icon', () => {
  assert.match(html, /<link rel="stylesheet" href="css\/model\.css">/);
  assert.match(css, /#modelStatusBar\s*\{[^}]*display\s*:\s*flex/i);
  assert.match(css, /#identityName\s*\{[^}]*text-overflow\s*:\s*ellipsis/i);
  assert.match(css, /#sendBtn\s*\{[^}]*background\s*:\s*#fff/i);
  assert.match(css, /#sendBtn\s*\{[^}]*color\s*:\s*#(?:111|000)/i);
  assert.match(css, /@media\s*\(max-width:\s*480px\)/i);
});

test('one-shot button state and global connection tests are wired', () => {
  assert.match(html, /airModeBtn\.addEventListener\('click'/);
  assert.match(html, /modelSession\.armAir\(\)/);
  assert.match(html, /testGlmBtn\.addEventListener\('click'/);
  assert.match(html, /testDeepseekBtn\.addEventListener\('click'/);
  assert.match(html, /createModelRequestPlan\('connection_test'/);
});

test('failed story requests offer free retry and explicit Air retry without automatic fallback', () => {
  assert.match(html, /再次免费尝试/);
  assert.match(html, /深度思考本条/);
  assert.match(html, /function retryLastFailedMessage\(/);
  assert.match(html, /sendMessage\(\{\s*reuseLastUser:\s*true/);
  assert.doesNotMatch(html, /catch\s*\([^)]*\)[\s\S]{0,300}defaultProvider\s*=\s*['"]deepseek/);
});
