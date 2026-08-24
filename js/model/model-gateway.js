(function (global) {
  'use strict';

  const Config = global.FonlingModels && global.FonlingModels.Config;
  if (!Config) throw new Error('FonlingModels.Config must be loaded before FonlingModels.Gateway');

  const ENDPOINTS = Object.freeze({
    glm: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    deepseek: 'https://api.deepseek.com/chat/completions',
  });
  const TASKS = Object.freeze(['chat', 'summary', 'analysis', 'connection_test']);

  class ModelRequestError extends Error {
    constructor(message, details) {
      super(message || '模型请求失败');
      this.name = 'ModelRequestError';
      const source = details || {};
      this.kind = source.kind || 'unknown';
      this.status = Number.isFinite(source.status) ? source.status : 0;
      this.retryable = source.retryable === true;
      this.attempts = Number.isFinite(source.attempts) ? source.attempts : 0;
      this.cause = source.cause;
    }
  }

  function cleanString(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function createPlan(options) {
    const source = options || {};
    const task = TASKS.includes(source.task) ? source.task : 'chat';
    const config = Config.normalizeConfig(source.config);
    const automatic = task === 'summary' || task === 'analysis';
    const air = task === 'chat' && source.tier === 'air';
    let provider = Config.PROVIDERS.GLM;
    let tier = 'free';

    if (air) {
      provider = Config.PROVIDERS.GLM;
      tier = 'air';
    } else if (!automatic && source.provider === Config.PROVIDERS.DEEPSEEK) {
      provider = Config.PROVIDERS.DEEPSEEK;
      tier = 'standard';
    } else if (!automatic && source.provider !== Config.PROVIDERS.GLM && config.defaultProvider === Config.PROVIDERS.DEEPSEEK) {
      provider = Config.PROVIDERS.DEEPSEEK;
      tier = 'standard';
    }

    if (task === 'connection_test') {
      provider = source.provider === Config.PROVIDERS.DEEPSEEK
        ? Config.PROVIDERS.DEEPSEEK
        : Config.PROVIDERS.GLM;
      tier = provider === Config.PROVIDERS.GLM ? 'free' : 'standard';
    }

    const isGlm = provider === Config.PROVIDERS.GLM;
    const stream = task === 'chat';
    const model = isGlm
      ? (tier === 'air' ? Config.MODELS.glm.air : Config.MODELS.glm.free)
      : Config.MODELS.deepseek.chat;
    const maxTokens = task === 'analysis' ? 1400
      : task === 'summary' ? 1024
        : task === 'connection_test' ? 8
          : tier === 'air' ? 4096 : 2560;
    const thinkingType = task === 'chat' && tier === 'air' ? 'enabled' : 'disabled';
    const temperature = task === 'analysis' ? 0.1
      : task === 'summary' || task === 'connection_test' ? 0.2
        : 0.9;

    return Object.freeze({
      task,
      provider,
      tier,
      model,
      endpoint: ENDPOINTS[provider],
      apiKey: isGlm ? config.glmApiKey : config.deepseekApiKey,
      stream,
      maxTokens,
      thinkingType,
      temperature,
      responseFormat: task === 'analysis' ? Object.freeze({ type: 'json_object' }) : null,
      retryLimit: isGlm && tier === 'free' ? config.costPolicy.freeRetryLimit : 0,
    });
  }

  function buildRequestBody(plan, messages) {
    const body = {
      model: plan.model,
      messages: Array.isArray(messages) ? messages : [],
      stream: plan.stream,
      max_tokens: plan.maxTokens,
      temperature: plan.temperature,
    };
    if (plan.provider === Config.PROVIDERS.GLM) {
      body.thinking = { type: plan.thinkingType === 'enabled' ? 'enabled' : 'disabled' };
    }
    if (plan.responseFormat) body.response_format = { ...plan.responseFormat };
    return body;
  }

  function kindForStatus(status) {
    if (status === 401) return 'auth';
    if (status === 403) return 'permission';
    if (status === 404) return 'model';
    if (status === 429) return 'rate_limit';
    if (status >= 500) return 'server';
    if (status === 400 || status === 409 || status === 422) return 'parameter';
    if (status === 402) return 'quota';
    return 'http';
  }

  function retryableKind(kind) {
    return kind === 'network' || kind === 'rate_limit' || kind === 'server';
  }

  async function responseError(response) {
    let message = `模型请求失败（HTTP ${response.status || 0}）`;
    try {
      const payload = await response.json();
      const supplied = payload && payload.error && payload.error.message;
      if (cleanString(supplied)) message = cleanString(supplied);
    } catch (_) {}
    const kind = kindForStatus(response.status || 0);
    return new ModelRequestError(message, {
      kind,
      status: response.status || 0,
      retryable: retryableKind(kind),
    });
  }

  function normalizeThrown(error) {
    if (error instanceof ModelRequestError) return error;
    if (error && error.name === 'AbortError') {
      return new ModelRequestError('模型请求已取消', { kind: 'aborted', cause: error });
    }
    return new ModelRequestError(error && error.message ? error.message : '网络请求失败', {
      kind: 'network',
      retryable: true,
      cause: error,
    });
  }

  function parseSseLine(line) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return { reasoningDelta: '', contentDelta: '' };
    const data = trimmed.slice(5).trim();
    if (!data || data === '[DONE]') return { reasoningDelta: '', contentDelta: '' };
    try {
      const payload = JSON.parse(data);
      const delta = payload && payload.choices && payload.choices[0] && payload.choices[0].delta;
      return {
        reasoningDelta: delta && typeof delta.reasoning_content === 'string' ? delta.reasoning_content : '',
        contentDelta: delta && typeof delta.content === 'string' ? delta.content : '',
      };
    } catch (_) {
      return { reasoningDelta: '', contentDelta: '' };
    }
  }

  async function readSseContent(response, onDelta) {
    if (!response.body || typeof response.body.getReader !== 'function') {
      throw new ModelRequestError('模型没有返回可读取的流', { kind: 'response' });
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let content = '';
    let reasoning = '';

    function consume(line) {
      const parsed = parseSseLine(line);
      if (!parsed.reasoningDelta && !parsed.contentDelta) return;
      reasoning += parsed.reasoningDelta;
      content += parsed.contentDelta;
      if (typeof onDelta === 'function') {
        onDelta({
          reasoningDelta: parsed.reasoningDelta,
          contentDelta: parsed.contentDelta,
          reasoning,
          content,
        });
      }
    }

    while (true) {
      const part = await reader.read();
      if (part.done) break;
      buffer += decoder.decode(part.value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      lines.forEach(consume);
    }
    buffer += decoder.decode();
    if (buffer) consume(buffer);
    return content;
  }

  async function readJsonContent(response) {
    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      throw new ModelRequestError('模型返回了无效 JSON', { kind: 'response', cause: error });
    }
    return cleanString(payload && payload.choices && payload.choices[0]
      && payload.choices[0].message && payload.choices[0].message.content);
  }

  async function performRequest(options) {
    const plan = options.plan;
    const fetchImpl = options.fetchImpl;
    const response = await fetchImpl(plan.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${plan.apiKey}`,
      },
      body: JSON.stringify(buildRequestBody(plan, options.messages)),
      signal: options.signal,
    });
    if (!response || !response.ok) throw await responseError(response || { status: 0, json: async () => ({}) });
    const content = plan.stream
      ? await readSseContent(response, options.onDelta)
      : await readJsonContent(response);
    return content;
  }

  async function request(options) {
    const source = options || {};
    const plan = source.plan;
    if (!plan || !TASKS.includes(plan.task)) {
      throw new ModelRequestError('缺少有效的模型请求计划', { kind: 'plan', attempts: 0 });
    }
    if (!cleanString(plan.apiKey)) {
      throw new ModelRequestError('请先配置对应的 API Key', { kind: 'missing_key', attempts: 0 });
    }
    const fetchImpl = typeof source.fetchImpl === 'function' ? source.fetchImpl : global.fetch;
    if (typeof fetchImpl !== 'function') {
      throw new ModelRequestError('当前环境不支持网络请求', { kind: 'network', attempts: 0 });
    }

    let attempts = 0;
    while (true) {
      attempts += 1;
      try {
        const content = await performRequest({ ...source, plan, fetchImpl });
        return { content, attempts, plan };
      } catch (thrown) {
        const error = normalizeThrown(thrown);
        error.attempts = attempts;
        if (!error.retryable || attempts > plan.retryLimit) throw error;
      }
    }
  }

  const api = Object.freeze({
    ENDPOINTS,
    TASKS,
    ModelRequestError,
    createPlan,
    buildRequestBody,
    readSseContent,
    request,
  });

  global.FonlingModels = global.FonlingModels || {};
  global.FonlingModels.Gateway = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
