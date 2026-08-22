const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

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

test('index creates all model plans through the shared global configuration', () => {
  const source = extractFunction('createModelRequestPlan');
  const calls = [];
  const context = {
    modelConfig: { defaultProvider: 'glm', glmApiKey: 'test' },
    modelGateway: {
      createPlan(options) { calls.push(options); return Object.freeze({ ...options, routed: true }); },
    },
  };
  vm.runInNewContext(`${source}; this.createPlan = createModelRequestPlan;`, context);

  const chat = context.createPlan('chat');
  const summary = context.createPlan('summary', { tier: 'air', provider: 'deepseek' });
  const analysis = context.createPlan('analysis', { tier: 'air' });
  assert.equal(chat.config, context.modelConfig);
  assert.deepEqual(calls.map(call => call.task), ['chat', 'summary', 'analysis']);
  assert.equal(summary.config, context.modelConfig);
  assert.equal(analysis.config, context.modelConfig);
});

test('chat, regenerate, and summary no longer perform provider-specific fetches', () => {
  for (const name of ['sendMessage', 'regenerateMessage', 'autoSummarize']) {
    const source = extractFunction(name);
    assert.match(source, /requestModel\s*\(/, `${name} must use the shared gateway`);
    assert.doesNotMatch(source, /fetch\s*\(/, `${name} must not fetch a provider directly`);
    assert.doesNotMatch(source, /DEEPSEEK_API|MODEL\b/, `${name} must not hard-code DeepSeek`);
  }
});

test('memory analysis configuration uses the fixed free analysis plan', () => {
  assert.match(html, /getAnalysisConfig:\s*function\([^)]*\)\s*\{[\s\S]*?createModelRequestPlan\('analysis'\)/);
  assert.doesNotMatch(html, /getAnalysisConfig:[\s\S]{0,250}DEEPSEEK_API/);
});

test('requestModel forwards messages, deltas, and cancellation to the gateway', async () => {
  const source = extractFunction('requestModel');
  let received;
  const context = {
    fetch() {},
    modelGateway: {
      async request(options) { received = options; return { content: 'ok', attempts: 1, plan: options.plan }; },
    },
  };
  vm.runInNewContext(`${source}; this.requestModel = requestModel;`, context);
  const plan = { task: 'chat' };
  const messages = [{ role: 'user', content: 'hi' }];
  const signal = { aborted: false };
  const onDelta = () => {};
  const result = await context.requestModel(plan, messages, onDelta, signal);
  assert.equal(result.content, 'ok');
  assert.equal(received.plan, plan);
  assert.equal(received.messages, messages);
  assert.equal(received.onDelta, onDelta);
  assert.equal(received.signal, signal);
  assert.equal(received.fetchImpl, context.fetch);
});

test('finishing a conversation request refreshes the model controls', () => {
  const source = extractFunction('finishConversationRequest');
  assert.match(source, /updateModelStatusBar\s*\(\s*\)/);
});

test('successful character replacement flows reset pending one-shot Air state', () => {
  for (const name of ['createCharacter', 'importData', 'deleteCharacter']) {
    const source = extractFunction(name);
    assert.match(source, /modelSession\.reset\s*\(\s*\)/, `${name} must reset pending Air state`);
  }
});
