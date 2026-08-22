const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('index.html', 'utf8');

function extractFunction(name) {
  const match = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(html);
  assert.ok(match, `${name} must exist`);
  const brace = html.indexOf('{', match.index);
  let depth = 0;
  for (let index = brace; index < html.length; index += 1) {
    if (html[index] === '{') depth += 1;
    if (html[index] === '}') depth -= 1;
    if (depth === 0) return html.slice(match.index, index + 1);
  }
  throw new Error(`unterminated ${name}`);
}

test('model session loads before the app and a successful send records actual generation provenance', () => {
  const sessionIndex = html.indexOf('<script src="js/model/model-session.js"></script>');
  const appIndex = html.indexOf('<script>');
  assert.ok(sessionIndex >= 0 && sessionIndex < appIndex);
  const source = extractFunction('sendMessage');
  assert.match(source, /modelSession\.beginSend\s*\(/);
  assert.match(source, /createGenerationMetadata\(generationPlan,\s*'send'/);
  assert.match(source, /modelSession\.finish\s*\(/);
});

test('latest assistant action is explicitly Air and records regenerate provenance', () => {
  const render = extractFunction('renderMessages');
  const regenerate = extractFunction('regenerateMessage');
  assert.match(render, /重新深度思考/);
  assert.doesNotMatch(render, /textContent\s*=\s*'重说'/);
  assert.match(regenerate, /beginAirRegenerate\s*\(/);
  assert.match(regenerate, /createModelRequestPlan\('chat',\s*\{\s*tier:\s*'air'/);
  assert.match(regenerate, /createGenerationMetadata\(regenerationPlan,\s*'regenerate'/);
});

test('only Air replies receive a visible Air badge', () => {
  const render = extractFunction('renderMessages');
  assert.match(render, /isAirGeneration\(msg\.generation\)/);
  assert.match(render, /model-tier-badge/);
  assert.match(render, /textContent\s*=\s*'Air'/);
});

test('character and identity switches cancel any unused one-shot Air selection', () => {
  for (const name of ['loadCharacterData', 'switchCharacter', 'switchToRole', 'switchToMain']) {
    assert.match(extractFunction(name), /modelSession\.reset\s*\(/, `${name} must reset the one-shot model state`);
  }
});
