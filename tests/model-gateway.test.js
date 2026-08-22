const test = require('node:test');
const assert = require('node:assert/strict');

require('../js/model/model-config.js');
const Gateway = require('../js/model/model-gateway.js');

function config(overrides) {
  return {
    ...globalThis.FonlingModels.Config.createDefaultConfig(),
    glmApiKey: 'glm-test-key',
    deepseekApiKey: 'deepseek-test-key',
    ...(overrides || {}),
  };
}

function jsonResponse(content, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      if (!this.ok) return { error: { message: content } };
      return { choices: [{ message: { content } }] };
    },
  };
}

function streamResponse(chunks, status = 200) {
  let index = 0;
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return { error: { message: 'stream error' } }; },
    body: {
      getReader() {
        return {
          async read() {
            if (index >= chunks.length) return { done: true };
            return { done: false, value: chunks[index++] };
          },
        };
      },
    },
  };
}

test('normal GLM chat plan is free, streaming, and explicitly disables thinking', async () => {
  const plan = Gateway.createPlan({ task: 'chat', config: config() });
  assert.deepEqual({ provider: plan.provider, model: plan.model, tier: plan.tier, retryLimit: plan.retryLimit }, {
    provider: 'glm', model: 'glm-4.7-flash', tier: 'free', retryLimit: 1,
  });
  assert.equal(Object.isFrozen(plan), true);

  let request;
  const result = await Gateway.request({
    plan,
    messages: [{ role: 'user', content: '你好' }],
    fetchImpl: async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) };
      return streamResponse([new TextEncoder().encode('data: {"choices":[{"delta":{"content":"好"}}]}\n\ndata: [DONE]\n\n')]);
    },
  });

  assert.equal(request.url, Gateway.ENDPOINTS.glm);
  assert.equal(request.options.headers.Authorization, 'Bearer glm-test-key');
  assert.deepEqual(request.body.thinking, { type: 'disabled' });
  assert.equal(request.body.model, 'glm-4.7-flash');
  assert.equal(request.body.stream, true);
  assert.equal(request.body.max_tokens, 4096);
  assert.equal(request.body.temperature, 0.9);
  assert.equal(result.content, '好');
  assert.equal(result.attempts, 1);
});

test('explicit Air plan uses GLM Air once and never enables thinking or retries', async () => {
  const plan = Gateway.createPlan({ task: 'chat', tier: 'air', config: config({ defaultProvider: 'deepseek' }) });
  assert.equal(plan.provider, 'glm');
  assert.equal(plan.model, 'glm-4.5-air');
  assert.equal(plan.tier, 'air');
  assert.equal(plan.retryLimit, 0);

  let body;
  await assert.rejects(() => Gateway.request({
    plan,
    messages: [{ role: 'user', content: '继续' }],
    fetchImpl: async (_url, options) => {
      body = JSON.parse(options.body);
      throw new TypeError('offline');
    },
  }), error => error.kind === 'network' && error.attempts === 1);
  assert.deepEqual(body.thinking, { type: 'disabled' });
});

test('summary and memory analysis are always free GLM even when chat defaults to DeepSeek', async () => {
  const source = config({ defaultProvider: 'deepseek' });
  const summary = Gateway.createPlan({ task: 'summary', tier: 'air', config: source });
  const analysis = Gateway.createPlan({ task: 'analysis', provider: 'deepseek', tier: 'air', config: source });

  assert.deepEqual([summary.provider, summary.model, summary.tier, summary.stream], ['glm', 'glm-4.7-flash', 'free', false]);
  assert.deepEqual([analysis.provider, analysis.model, analysis.tier, analysis.stream], ['glm', 'glm-4.7-flash', 'free', false]);

  const bodies = [];
  await Gateway.request({
    plan: summary, messages: [],
    fetchImpl: async (_url, options) => { bodies.push(JSON.parse(options.body)); return jsonResponse('摘要'); },
  });
  await Gateway.request({
    plan: analysis, messages: [],
    fetchImpl: async (_url, options) => { bodies.push(JSON.parse(options.body)); return jsonResponse('{"candidates":[]}'); },
  });

  assert.equal(bodies[0].max_tokens, 1024);
  assert.equal(bodies[0].stream, false);
  assert.deepEqual(bodies[0].thinking, { type: 'disabled' });
  assert.equal(bodies[1].max_tokens, 1400);
  assert.equal(bodies[1].temperature, 0.1);
  assert.deepEqual(bodies[1].response_format, { type: 'json_object' });
});

test('manual DeepSeek chat uses its own key and never receives GLM-only thinking', async () => {
  const plan = Gateway.createPlan({ task: 'chat', config: config({ defaultProvider: 'deepseek' }) });
  assert.deepEqual([plan.provider, plan.model, plan.tier, plan.retryLimit], ['deepseek', 'deepseek-v4-flash', 'standard', 0]);

  let request;
  await Gateway.request({
    plan, messages: [],
    fetchImpl: async (url, options) => {
      request = { url, headers: options.headers, body: JSON.parse(options.body) };
      return streamResponse([new TextEncoder().encode('data: [DONE]')]);
    },
  });
  assert.equal(request.url, Gateway.ENDPOINTS.deepseek);
  assert.equal(request.headers.Authorization, 'Bearer deepseek-test-key');
  assert.equal(Object.prototype.hasOwnProperty.call(request.body, 'thinking'), false);
});

test('SSE parser preserves split UTF-8 and a final frame without a newline', async () => {
  const bytes = new TextEncoder().encode('data: {"choices":[{"delta":{"content":"剧情继续🌙"}}]}');
  const split = bytes.indexOf(0xf0) + 2;
  const deltas = [];
  const result = await Gateway.request({
    plan: Gateway.createPlan({ task: 'chat', config: config() }),
    messages: [],
    onDelta(value) { deltas.push(value); },
    fetchImpl: async () => streamResponse([bytes.slice(0, split), bytes.slice(split)]),
  });
  assert.equal(result.content, '剧情继续🌙');
  assert.deepEqual(deltas, ['剧情继续🌙']);
});

test('SSE parser preserves meaningful whitespace inside streamed text', async () => {
  const first = 'data: {"choices":[{"delta":{"content":"Hello "}}]}\n\n';
  const second = 'data: {"choices":[{"delta":{"content":"world"}}]}\n\ndata: [DONE]\n\n';
  const deltas = [];
  const result = await Gateway.request({
    plan: Gateway.createPlan({ task: 'chat', config: config() }),
    messages: [],
    onDelta(value) { deltas.push(value); },
    fetchImpl: async () => streamResponse([
      new TextEncoder().encode(first),
      new TextEncoder().encode(second),
    ]),
  });

  assert.equal(result.content, 'Hello world');
  assert.deepEqual(deltas, ['Hello ', 'world']);
});

test('free GLM retries exactly once for network, 429, and 5xx failures', async t => {
  for (const scenario of [
    ['network', () => { throw new TypeError('offline'); }],
    ['429', () => jsonResponse('limited', 429)],
    ['5xx', () => jsonResponse('down', 503)],
  ]) {
    await t.test(scenario[0], async () => {
      let calls = 0;
      const result = await Gateway.request({
        plan: Gateway.createPlan({ task: 'summary', config: config() }),
        messages: [],
        fetchImpl: async () => {
          calls += 1;
          if (calls === 1) return scenario[1]();
          return jsonResponse('成功');
        },
      });
      assert.equal(calls, 2);
      assert.equal(result.content, '成功');
      assert.equal(result.attempts, 2);
    });
  }
});

test('auth, parameter, model, and aborted failures do not retry', async t => {
  for (const scenario of [
    ['auth', 401, 'auth'],
    ['parameter', 400, 'parameter'],
    ['model', 404, 'model'],
  ]) {
    await t.test(scenario[0], async () => {
      let calls = 0;
      await assert.rejects(() => Gateway.request({
        plan: Gateway.createPlan({ task: 'summary', config: config() }), messages: [],
        fetchImpl: async () => { calls += 1; return jsonResponse('no', scenario[1]); },
      }), error => error.kind === scenario[2] && error.attempts === 1);
      assert.equal(calls, 1);
    });
  }

  await t.test('aborted', async () => {
    let calls = 0;
    await assert.rejects(() => Gateway.request({
      plan: Gateway.createPlan({ task: 'summary', config: config() }), messages: [],
      fetchImpl: async () => {
        calls += 1;
        throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      },
    }), error => error.kind === 'aborted' && error.attempts === 1);
    assert.equal(calls, 1);
  });
});

test('missing credentials fail before fetch without an automatic fallback', async () => {
  let calls = 0;
  await assert.rejects(() => Gateway.request({
    plan: Gateway.createPlan({ task: 'chat', config: config({ glmApiKey: '' }) }),
    messages: [], fetchImpl: async () => { calls += 1; },
  }), error => error.kind === 'missing_key' && error.attempts === 0);
  assert.equal(calls, 0);
});
