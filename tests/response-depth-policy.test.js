const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadModels() {
  const sandbox = { globalThis: null, TextDecoder, TextEncoder };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync('js/model/model-config.js', 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync('js/model/model-gateway.js', 'utf8'), sandbox);
  if (fs.existsSync('js/model/response-policy.js')) {
    vm.runInContext(fs.readFileSync('js/model/response-policy.js', 'utf8'), sandbox);
  }
  return sandbox.FonlingModels;
}

test('ordinary chat is concise while Air keeps a larger thinking budget', () => {
  const models = loadModels();
  const config = models.Config.normalizeConfig({
    glmApiKey: 'glm-key',
    deepseekApiKey: 'deepseek-key',
  });
  const ordinary = models.Gateway.createPlan({ task: 'chat', provider: 'glm', config });
  const air = models.Gateway.createPlan({ task: 'chat', tier: 'air', config });

  assert.equal(ordinary.maxTokens, 2560);
  assert.equal(ordinary.thinkingType, 'disabled');
  assert.equal(air.maxTokens, 4096);
  assert.equal(air.thinkingType, 'enabled');
  assert.deepEqual(JSON.parse(JSON.stringify(models.Gateway.buildRequestBody(ordinary, []).thinking)), { type: 'disabled' });
  assert.deepEqual(JSON.parse(JSON.stringify(models.Gateway.buildRequestBody(air, []).thinking)), { type: 'enabled' });
});

test('response policy exposes ordinary and Air context profiles', () => {
  const models = loadModels();
  assert.ok(models.ResponsePolicy, 'FonlingModels.ResponsePolicy must be loaded');

  const ordinary = models.ResponsePolicy.forPlan({ task: 'chat', tier: 'free' });
  const air = models.ResponsePolicy.forPlan({ task: 'chat', tier: 'air' });

  assert.deepEqual(JSON.parse(JSON.stringify(ordinary.limits)), {
    recentMessages: 14,
    narrativeCharacters: 6000,
    memoryCharacters: 8000,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(air.limits)), {
    recentMessages: 24,
    narrativeCharacters: 10000,
    memoryCharacters: 12000,
  });
  assert.match(ordinary.instruction, /精炼/);
  assert.match(ordinary.instruction, /一半到三分之二|50%.*67%/);
  assert.match(ordinary.instruction, /动作|心理/);
  assert.match(air.instruction, /人物动机/);
  assert.match(air.instruction, /潜台词/);
  assert.match(air.instruction, /关系变化/);
  assert.match(air.instruction, /伏笔/);
  assert.match(air.instruction, /行为后果/);
});

test('non-chat token limits and DeepSeek request bodies remain compatible', () => {
  const models = loadModels();
  const config = models.Config.normalizeConfig({ deepseekApiKey: 'deepseek-key' });
  const summary = models.Gateway.createPlan({ task: 'summary', config });
  const analysis = models.Gateway.createPlan({ task: 'analysis', config });
  const connection = models.Gateway.createPlan({ task: 'connection_test', provider: 'deepseek', config });
  const deepseek = models.Gateway.createPlan({ task: 'chat', provider: 'deepseek', config });

  assert.equal(summary.maxTokens, 1024);
  assert.equal(analysis.maxTokens, 1400);
  assert.equal(connection.maxTokens, 8);
  assert.equal(deepseek.maxTokens, 2560);
  assert.equal('thinking' in models.Gateway.buildRequestBody(deepseek, []), false);
});

test('mixed GLM stream separates reasoning from final reply content', async () => {
  const models = loadModels();
  const chunks = [
    'data: {"choices":[{"delta":{"reasoning_content":"先核对人物关系。"}}]}\n\n',
    'data: {"choices":[{"delta":{"reasoning_content":"再判断承诺。","content":"她抬眼。"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"“我记得。”"}}]}\n\n',
    'data: [DONE]\n\n',
  ].map(value => new TextEncoder().encode(value));
  let index = 0;
  const snapshots = [];
  const response = {
    body: {
      getReader() {
        return {
          async read() {
            return index < chunks.length
              ? { done: false, value: chunks[index++] }
              : { done: true, value: undefined };
          },
        };
      },
    },
  };

  const content = await models.Gateway.readSseContent(response, snapshot => snapshots.push({ ...snapshot }));

  assert.equal(content, '她抬眼。“我记得。”');
  assert.equal(snapshots.at(-1).reasoning, '先核对人物关系。再判断承诺。');
  assert.equal(snapshots.at(-1).content, '她抬眼。“我记得。”');
  assert.equal(snapshots.some(snapshot => snapshot.reasoningDelta === '先核对人物关系。'), true);
  assert.equal(snapshots.some(snapshot => snapshot.contentDelta === '“我记得。”'), true);
});
