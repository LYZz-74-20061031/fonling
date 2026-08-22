const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

function loadMemory() {
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    AbortController,
    crypto: { randomUUID: (() => { let id = 0; return () => `uuid-${++id}`; })() },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const file of ['memory-model.js', 'memory-analyzer.js']) {
    const source = fs.readFileSync(path.join(root, 'js', 'memory', file), 'utf8');
    vm.runInContext(source, sandbox, { filename: file });
  }
  return sandbox.FonlingMemory;
}

function candidate(overrides = {}) {
  return {
    operation: 'add',
    memoryType: 'history_event',
    content: '阿宁在旧港发现了密道',
    sourceMessageIds: ['u1', 'a1'],
    reason: '重要剧情变化',
    ...overrides,
  };
}

test('trigger rules recognize story-changing turns and reject greetings or analyzed turns', () => {
  const { Analyzer } = loadMemory();
  const positives = [
    '我们离开旧港，抵达了北城车站。',
    '三天后，阿宁走进房间，陆衡随后离开。',
    '我答应明天交出钥匙，这是队长的命令。',
    '她终于揭露秘密：自己其实是失踪的王女。',
    '经过这件事，两人从敌对变成了彼此信任。',
    '阿宁把赤铜钥匙交给陆衡保管。',
    '陆衡身受重伤，后来在神殿苏醒并恢复。',
    '追兵已经包围车站，但爆炸后危机解除。',
    '这个世界的新规则是：月光会让时间倒流。',
  ];
  positives.forEach((assistantText, index) => {
    assert.equal(Analyzer.shouldAnalyzeTurn({
      turnKey: `u${index}:a${index}`,
      userText: '继续剧情',
      assistantText,
      analyzedTurnKeys: [],
    }), true, assistantText);
  });

  assert.equal(Analyzer.shouldAnalyzeTurn({ userText: '你好', assistantText: '你好呀。' }), false);
  assert.equal(Analyzer.shouldAnalyzeTurn({ userText: '嗯', assistantText: '雨仍然静静地下着。' }), false);
  assert.equal(Analyzer.shouldAnalyzeTurn({ userText: '继续', assistantText: '   ' }), false);
  assert.equal(Analyzer.shouldAnalyzeTurn({
    turnKey: 'u1:a1', userText: '继续', assistantText: positives[0], analyzedTurnKeys: ['u1:a1']
  }), false);
});

test('trigger rules ignore event nouns appearing only in user questions', () => {
  const { Analyzer } = loadMemory();
  const probes = [
    ['赤铜钥匙现在在哪里？', '她没有回答，只是安静地看着你。'],
    ['陆衡是不是已经死了？', '没人能够确认这个猜测。'],
    ['这项任务完成了吗？危机解除了吗？', '她沉默不语，没有给出结论。'],
  ];
  probes.forEach(([userText, assistantText]) => {
    assert.equal(Analyzer.shouldAnalyzeTurn({ userText, assistantText, analyzedTurnKeys: [] }), false, userText);
  });
});

test('trigger rules recognize explicit story events narrated by the user even when the assistant only reacts', () => {
  const { Analyzer } = loadMemory();
  const probes = [
    ['我把赤铜钥匙交给了陆衡。', '他点了点头。'],
    ['我向阿宁承诺，一定会活着回来。', '她轻轻应了一声。'],
    ['我终于告诉她，我其实是失踪的王子。', '她愣住了。'],
  ];
  probes.forEach(([userText, assistantText]) => {
    assert.equal(Analyzer.shouldAnalyzeTurn({ userText, assistantText, analyzedTurnKeys: [] }), true, userText);
  });
  assert.equal(Analyzer.shouldAnalyzeTurn({
    userText: '你有赤铜钥匙吗？', assistantText: '我不知道。', analyzedTurnKeys: [],
  }), false);
});

test('strong events bypass the ordinary length threshold and natural time expressions trigger analysis', () => {
  const { Analyzer } = loadMemory();
  for (const assistantText of ['他死了。', '她受伤。', '她离开。', '得到钥匙。', '我答应了。']) {
    assert.equal(Analyzer.shouldAnalyzeTurn({ userText: '', assistantText }), true, assistantText);
  }
  for (const assistantText of ['凌晨两点，钟声响起。', '上午，众人在门外集合。', '第三天，封闭的门终于打开。']) {
    assert.equal(Analyzer.shouldAnalyzeTurn({ userText: '继续', assistantText }), true, assistantText);
  }
});

test('analysis prompt contains bounded story context and request is non-streaming strict JSON', () => {
  const { Analyzer } = loadMemory();
  const input = {
    recentMessages: [{ id: 'u1', role: 'user', content: '去旧港' }, { id: 'a1', role: 'assistant', content: '抵达旧港' }],
    summary: '此前两人正在追查钥匙。',
    currentScene: { time: '深夜', location: '旧港', presentCharacters: ['阿宁'] },
    memories: [
      { id: 'k1', type: 'key_info', status: 'active', content: '阿宁害怕深水' },
      { id: 'k2', type: 'key_info', status: 'resolved', content: '旧伤已经痊愈' },
      { id: 'h1', type: 'history_event', status: 'active', content: '钥匙在钟楼出现过', updatedAt: '2026-08-13' },
    ],
    pendingCandidates: [candidate({ id: 'c1' })],
    apiUrl: 'https://example.test/chat',
    apiKey: 'sk-test',
    model: 'deepseek-test',
  };
  const messages = Analyzer.buildAnalysisMessages(input);
  const combined = messages.map(message => message.content).join('\n');
  assert.match(combined, /strict JSON|严格 JSON/i);
  assert.match(combined, /禁止.*猜测.*事实/);
  assert.match(combined, /shouldSuggest/);
  assert.match(combined, /candidates/);
  for (const fragment of ['去旧港', '此前两人正在追查钥匙', '深夜', '阿宁害怕深水', '钥匙在钟楼出现过', '阿宁在旧港发现了密道']) {
    assert.match(combined, new RegExp(fragment));
  }
  assert.doesNotMatch(combined, /旧伤已经痊愈/);

  const request = Analyzer.buildAnalysisRequest(input);
  assert.equal(request.url, 'https://example.test/chat');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers.Authorization, 'Bearer sk-test');
  const body = JSON.parse(request.options.body);
  assert.equal(body.stream, false);
  assert.equal(body.model, 'deepseek-test');
  assert.deepEqual(body.messages, JSON.parse(JSON.stringify(messages)));
});

test('parser accepts direct JSON, one markdown fence repair, and balanced object extraction', () => {
  const { Analyzer } = loadMemory();
  const direct = Analyzer.parseAnalysisResponse(JSON.stringify({ shouldSuggest: true, candidates: [candidate()] }), {
    validSourceMessageIds: ['u1', 'a1'],
  });
  assert.equal(direct.ok, true);
  assert.equal(direct.candidates.length, 1);

  const fenced = Analyzer.parseAnalysisResponse('```json\n{"shouldSuggest":true,"candidates":[]}\n```');
  assert.equal(fenced.ok, true);

  const extracted = Analyzer.parseAnalysisResponse('分析如下： {"shouldSuggest":false,"candidates":[]} 完毕');
  assert.equal(extracted.ok, true);
  assert.equal(extracted.shouldSuggest, false);

  const malformed = Analyzer.parseAnalysisResponse('```json\n{broken}\n``` and {still broken}');
  assert.equal(malformed.ok, false);
  assert.equal(malformed.error, 'INVALID_ANALYSIS_JSON');
});

test('parser caps output and filters malformed candidates without mutating formal memories', () => {
  const { Analyzer } = loadMemory();
  const memories = [
    { id: 'h1', type: 'history_event', status: 'active', content: '阿宁接下任务' },
    { id: 'k1', type: 'key_info', status: 'active', content: '阿宁持有钥匙' },
  ];
  const before = JSON.stringify(memories);
  const candidates = [
    candidate({ content: '第一条有效事件' }),
    candidate({ memoryType: 'unknown', content: '未知类型' }),
    candidate({ content: '' }),
    candidate({ operation: 'scene_patch', memoryType: undefined, content: undefined, scenePatch: { unknown: 'x' } }),
    candidate({ operation: 'resolve', memoryType: 'history_event', content: undefined, targetMemoryIds: ['h1'], resultStatus: 'resolved' }),
    candidate({ operation: 'update', targetMemoryIds: ['missing'], content: '不存在目标' }),
    candidate({ sourceMessageIds: ['missing-message'], content: '来源不存在' }),
    candidate({ content: '第二条有效事件' }),
    candidate({ content: '第三条有效事件' }),
    candidate({ content: '第四条应被截断' }),
  ];
  const parsed = Analyzer.parseAnalysisResponse(JSON.stringify({ shouldSuggest: true, candidates }), {
    memories,
    validSourceMessageIds: ['u1', 'a1'],
  });
  assert.equal(parsed.ok, true);
  assert.deepEqual(Array.from(parsed.candidates, item => item.content), ['第一条有效事件', '第二条有效事件', '第三条有效事件']);
  assert.equal(JSON.stringify(memories), before);
});

test('AI parsing requires nonempty source IDs and every source must belong to the analysis snapshot', () => {
  const { Analyzer } = loadMemory();
  const candidates = [
    candidate({ id: 'missing-source', sourceMessageIds: undefined, content: '缺失来源' }),
    candidate({ id: 'empty-source', sourceMessageIds: [], content: '空来源' }),
    candidate({ id: 'unknown-source', sourceMessageIds: ['u1', 'missing'], content: '不存在来源' }),
    candidate({ id: 'valid-source', sourceMessageIds: ['u1', 'a1'], content: '合法来源' }),
  ];
  const parsed = Analyzer.parseAnalysisResponse(JSON.stringify({ shouldSuggest: true, candidates }), {
    validSourceMessageIds: ['u1', 'a1'],
  });
  assert.equal(parsed.ok, true);
  assert.deepEqual(Array.from(parsed.candidates, item => item.id), ['valid-source']);
});

test('deduplication independently rejects empty or nonexistent AI sources before comparing content', () => {
  const { Analyzer } = loadMemory();
  const result = Analyzer.deduplicateCandidates({
    candidates: [
      candidate({ id: 'missing-source', sourceMessageIds: undefined, content: '甲发生变化' }),
      candidate({ id: 'empty-source', sourceMessageIds: [], content: '乙发生变化' }),
      candidate({ id: 'unknown-source', sourceMessageIds: ['missing'], content: '丙发生变化' }),
      candidate({ id: 'valid-source', sourceMessageIds: ['u1', 'a1'], content: '丁发生变化' }),
    ],
    memories: [], pendingCandidates: [], validSourceMessageIds: ['u1', 'a1'],
  });
  assert.deepEqual(Array.from(result, item => item.id), ['valid-source']);
});

test('deduplication discards equivalent text and also compares pending candidates', () => {
  const { Analyzer } = loadMemory();
  const result = Analyzer.deduplicateCandidates({
    candidates: [
      candidate({ id: 'c1', content: '阿宁，持有赤铜钥匙！', memoryType: 'key_info' }),
      candidate({ id: 'c2', content: '陆衡进入钟楼', memoryType: 'history_event' }),
    ],
    memories: [{ id: 'k1', type: 'key_info', status: 'active', content: '阿宁持有赤铜钥匙。' }],
    pendingCandidates: [candidate({ id: 'pending', content: '陆衡进入钟楼。' })],
  });
  assert.equal(result.length, 0);
});

test('medium similarity becomes an update only for the same type with named entity overlap', () => {
  const { Analyzer } = loadMemory();
  const [converted] = Analyzer.deduplicateCandidates({
    candidates: [candidate({ memoryType: 'key_info', content: '阿宁保管赤铜钥匙藏在外套口袋' })],
    memories: [{ id: 'k1', type: 'key_info', status: 'active', content: '阿宁保管赤铜钥匙藏在外套内袋' }],
    pendingCandidates: [],
  });
  assert.equal(converted.operation, 'update');
  assert.deepEqual(Array.from(converted.targetMemoryIds), ['k1']);
  assert.equal(converted.oldContent, '阿宁保管赤铜钥匙藏在外套内袋');

  const unrelated = Analyzer.deduplicateCandidates({
    candidates: [candidate({ memoryType: 'history_event', content: '北港钟楼守卫已经全部撤离' })],
    memories: [{ id: 'h1', type: 'history_event', status: 'active', content: '南港钟楼守卫已经全部撤离' }],
    pendingCandidates: [],
  });
  assert.equal(unrelated[0].operation, 'add');
});

test('explicit and ambiguous conflicts are preserved for review without invalidating old facts', () => {
  const { Analyzer } = loadMemory();
  const memories = [{ id: 'k1', type: 'key_info', status: 'active', content: '阿宁持有赤铜钥匙' }];
  const results = Analyzer.deduplicateCandidates({
    candidates: [
      candidate({ memoryType: 'key_info', content: '阿宁不再持有赤铜钥匙，钥匙已经交给陆衡' }),
      candidate({ memoryType: 'key_info', content: '阿宁可能仍然持有赤铜钥匙' }),
    ],
    memories,
    pendingCandidates: [],
  });
  assert.equal(results[0].conflict, true);
  assert.equal(results[0].oldContent, '阿宁持有赤铜钥匙');
  assert.match(results[0].content, /不再持有/);
  assert.equal(results[1].possibleConflict, true);
  assert.equal(memories[0].status, 'active');
});

test('conflict oldContent comes from the highest-similarity same-entity memory, not array order', () => {
  const { Analyzer } = loadMemory();
  const result = Analyzer.deduplicateCandidates({
    candidates: [candidate({
      id: 'conflict', memoryType: 'key_info',
      content: '阿宁不再把银色王冠藏在房间里并交给陆衡',
    })],
    memories: [
      { id: 'first-low', type: 'key_info', status: 'active', content: '阿宁持有赤铜钥匙' },
      { id: 'second-high', type: 'key_info', status: 'active', content: '阿宁把银色王冠藏在房间里并独自保管' },
    ],
    pendingCandidates: [], validSourceMessageIds: ['u1', 'a1'],
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].conflict, true);
  assert.equal(result[0].oldContent, '阿宁把银色王冠藏在房间里并独自保管');
});

test('medium-similarity same-type same-entity pending memory prevents a second add', () => {
  const { Analyzer } = loadMemory();
  const result = Analyzer.deduplicateCandidates({
    candidates: [candidate({
      id: 'incoming', memoryType: 'key_info', content: '阿宁保管赤铜钥匙藏在外套口袋',
    })],
    memories: [],
    pendingCandidates: [candidate({
      id: 'pending', memoryType: 'key_info', content: '阿宁保管赤铜钥匙藏在外套内袋',
    })],
    validSourceMessageIds: ['u1', 'a1'],
  });
  assert.equal(result.length, 0);
});

test('deduplication preserves a valid contentless resolve candidate and all of its metadata', () => {
  const { Analyzer } = loadMemory();
  const resolve = {
    id: 'resolve-1',
    operation: 'resolve',
    memoryType: 'key_info',
    targetMemoryIds: ['k1'],
    resultStatus: 'resolved',
    sourceMessageIds: ['u1', 'a1'],
    reason: '任务已经完成',
    source: 'analysis',
    conflict: false,
    possibleConflict: true,
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
  };
  const result = Analyzer.deduplicateCandidates({ candidates: [resolve], memories: [], pendingCandidates: [] });
  assert.equal(result.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(result[0])), resolve);
});

test('resolve candidates deduplicate against an identical pending resolve', () => {
  const { Analyzer } = loadMemory();
  const incoming = {
    id: 'incoming', operation: 'resolve', memoryType: 'key_info', targetMemoryIds: ['k1'],
    resultStatus: 'resolved', sourceMessageIds: ['u1', 'a1'],
  };
  const pending = {
    id: 'pending', operation: 'resolve', memoryType: 'key_info', targetMemoryIds: ['k1'],
    resultStatus: 'resolved', sourceMessageIds: ['old-u', 'old-a'],
  };
  assert.equal(Analyzer.deduplicateCandidates({
    candidates: [incoming], memories: [], pendingCandidates: [pending]
  }).length, 0);
});

test('resolve deduplication treats reordered target IDs as the same stable key', () => {
  const { Analyzer } = loadMemory();
  const incoming = {
    id: 'incoming', operation: 'resolve', memoryType: 'key_info', targetMemoryIds: ['k2', 'k1'],
    resultStatus: 'invalidated', sourceMessageIds: ['u1', 'a1'],
  };
  const pending = {
    id: 'pending', operation: 'resolve', memoryType: 'key_info', targetMemoryIds: ['k1', 'k2'],
    resultStatus: 'invalidated', sourceMessageIds: ['old-u', 'old-a'],
  };
  assert.equal(Analyzer.deduplicateCandidates({
    candidates: [incoming], memories: [], pendingCandidates: [pending]
  }).length, 0);
});

test('resolve candidates with different targets or statuses are never mistaken for duplicates', () => {
  const { Analyzer } = loadMemory();
  const pending = {
    id: 'pending', operation: 'resolve', memoryType: 'key_info', targetMemoryIds: ['k1'],
    resultStatus: 'resolved', sourceMessageIds: ['old-u', 'old-a'],
  };
  const candidates = [
    { id: 'different-target', operation: 'resolve', memoryType: 'key_info', targetMemoryIds: ['k2'], resultStatus: 'resolved', sourceMessageIds: ['u1', 'a1'] },
    { id: 'different-status', operation: 'resolve', memoryType: 'key_info', targetMemoryIds: ['k1'], resultStatus: 'invalidated', sourceMessageIds: ['u1', 'a1'] },
  ];
  const result = Analyzer.deduplicateCandidates({ candidates, memories: [], pendingCandidates: [pending] });
  assert.deepEqual(Array.from(result, item => item.id), ['different-target', 'different-status']);
});

test('analyzeTurn injects fetch settings and returns filtered candidates without throwing', async () => {
  const { Analyzer } = loadMemory();
  const calls = [];
  const input = {
    apiUrl: 'https://example.test/chat', apiKey: 'sk-test', model: 'deepseek-test',
    recentMessages: [{ id: 'u1', role: 'user', content: '继续' }, { id: 'a1', role: 'assistant', content: '阿宁抵达旧港' }],
    validSourceMessageIds: ['u1', 'a1'], memories: [], pendingCandidates: [],
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ shouldSuggest: true, candidates: [candidate()] }) } }] }) };
    },
  };
  const result = await Analyzer.analyzeTurn(input);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://example.test/chat');
  assert.equal(JSON.parse(calls[0].options.body).stream, false);
  assert.equal(result.ok, true);
  assert.equal(result.candidates.length, 1);

  const failed = await Analyzer.analyzeTurn({ ...input, fetchImpl: async () => ({ ok: false, status: 429 }) });
  assert.equal(failed.ok, false);
  assert.equal(failed.error, 'ANALYSIS_REQUEST_FAILED');
});

test('analyzeTurn accepts the shared routed request without legacy provider credentials', async () => {
  const { Analyzer } = loadMemory();
  let routedRequest;
  const result = await Analyzer.analyzeTurn({
    recentMessages: [{ id: 'u1', role: 'user', content: '继续' }, { id: 'a1', role: 'assistant', content: '阿宁抵达旧港' }],
    validSourceMessageIds: ['u1', 'a1'], memories: [], pendingCandidates: [],
    requestImpl: async request => {
      routedRequest = request;
      return { content: JSON.stringify({ shouldSuggest: true, candidates: [candidate()] }) };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.candidates.length, 1);
  assert.ok(routedRequest.messages.some(message => message.content.includes('STORY_CONTEXT_BEGIN')));
  assert.ok(Object.prototype.hasOwnProperty.call(routedRequest, 'signal'));
});

test('analyzeTurn times out a never-settling fetch, aborts it, and ignores a late rejection', async () => {
  const { Analyzer } = loadMemory();
  let rejectLate;
  let capturedSignal;
  const startedAt = Date.now();
  const result = await Analyzer.analyzeTurn({
    apiUrl: 'https://example.test/chat', apiKey: 'sk-test', model: 'deepseek-test', timeoutMs: 15,
    recentMessages: [{ id: 'u1', role: 'user', content: '继续' }, { id: 'a1', role: 'assistant', content: '阿宁离开旧港' }],
    memories: [], pendingCandidates: [], validSourceMessageIds: ['u1', 'a1'],
    fetchImpl(_url, options) {
      capturedSignal = options.signal;
      return new Promise((_resolve, reject) => { rejectLate = reject; });
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'ANALYSIS_TIMEOUT');
  assert.ok(Date.now() - startedAt < 500);
  assert.equal(capturedSignal.aborted, true);
  rejectLate(new Error('late network rejection'));
  await new Promise(resolve => setImmediate(resolve));
});

test('analyzeTurn deadline includes a response json body that resolves after the timeout', async () => {
  const { Analyzer } = loadMemory();
  let capturedSignal;
  const result = await Analyzer.analyzeTurn({
    apiUrl: 'https://example.test/chat', apiKey: 'sk-test', model: 'deepseek-test', timeoutMs: 10,
    recentMessages: [{ id: 'u1', role: 'user', content: '继续' }, { id: 'a1', role: 'assistant', content: '阿宁离开旧港' }],
    memories: [], pendingCandidates: [], validSourceMessageIds: ['u1', 'a1'],
    fetchImpl: async (_url, options) => {
      capturedSignal = options.signal;
      return {
        ok: true,
        json: () => new Promise(resolve => setTimeout(() => resolve({
          choices: [{ message: { content: JSON.stringify({ shouldSuggest: true, candidates: [candidate()] }) } }],
        }), 40)),
      };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'ANALYSIS_TIMEOUT');
  assert.equal(capturedSignal.aborted, true);
});

test('analyzeTurn deadline releases a never-settling response json body and ignores its late resolve', async () => {
  const { Analyzer } = loadMemory();
  let resolveLate;
  let capturedSignal;
  const work = Analyzer.analyzeTurn({
    apiUrl: 'https://example.test/chat', apiKey: 'sk-test', model: 'deepseek-test', timeoutMs: 10,
    recentMessages: [{ id: 'u1', role: 'user', content: '继续' }, { id: 'a1', role: 'assistant', content: '阿宁离开旧港' }],
    memories: [], pendingCandidates: [], validSourceMessageIds: ['u1', 'a1'],
    fetchImpl: async (_url, options) => {
      capturedSignal = options.signal;
      return { ok: true, json: () => new Promise(resolve => { resolveLate = resolve; }) };
    },
  });
  const result = await work;
  assert.equal(result.ok, false);
  assert.equal(result.error, 'ANALYSIS_TIMEOUT');
  assert.equal(capturedSignal.aborted, true);
  resolveLate({ choices: [{ message: { content: JSON.stringify({ shouldSuggest: true, candidates: [candidate()] }) } }] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(result.ok, false);
});

test('analyzeTurn accepts a response whose json body completes within the shared deadline', async () => {
  const { Analyzer } = loadMemory();
  const result = await Analyzer.analyzeTurn({
    apiUrl: 'https://example.test/chat', apiKey: 'sk-test', model: 'deepseek-test', timeoutMs: 100,
    recentMessages: [{ id: 'u1', role: 'user', content: '继续' }, { id: 'a1', role: 'assistant', content: '阿宁离开旧港' }],
    memories: [], pendingCandidates: [], validSourceMessageIds: ['u1', 'a1'],
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({ shouldSuggest: true, candidates: [candidate()] }) } }] }),
    }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.candidates.length, 1);
});
