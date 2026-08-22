const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadContext() {
  const sandbox = { console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync('js/memory/memory-context.js', 'utf8'), sandbox, {
    filename: 'memory-context.js',
  });
  return sandbox.FonlingMemory.Context;
}

function memory(overrides) {
  return {
    id: 'memory_default',
    type: 'key_info',
    content: '默认记忆',
    status: 'active',
    pinned: false,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function scene(overrides) {
  return {
    time: '', location: '', presentCharacters: [], currentGoal: '', currentConflict: '',
    characterStates: '', environment: '', notes: '', updatedAt: '',
    ...overrides,
  };
}

test('selects valid pinned memories and excludes inactive key information', () => {
  const Context = loadContext();
  const selected = Context.selectMemoriesForContext({
    memories: [
      memory({ id: 'pin_history', type: 'history_event', content: '阿宁取得钥匙', pinned: true }),
      memory({ id: 'pin_key', content: '阿宁害怕深海', pinned: true }),
      memory({ id: 'resolved', content: '旧身份', status: 'resolved', pinned: true }),
      memory({ id: 'invalidated', content: '错误传闻', status: 'invalidated', pinned: true }),
    ],
    currentScene: scene({ location: '码头' }),
    userText: '现在怎么办？',
    recentMessages: [],
  });

  assert.deepEqual(selected.pinned.map(item => item.id), ['pin_history', 'pin_key']);
  assert.deepEqual(selected.trace.pinnedMemoryIds, ['pin_history', 'pin_key']);
  assert.equal(selected.related.some(item => item.id === 'resolved'), false);
  assert.equal(selected.related.some(item => item.id === 'invalidated'), false);
});

test('requires a direct Chinese or ASCII keyword hit before selecting archived history', () => {
  const Context = loadContext();
  const archived = memory({
    id: 'archive', type: 'history_event', status: 'archived',
    content: '阿宁在旧码头交出了 MoonKey',
  });

  const miss = Context.selectMemoriesForContext({
    memories: [archived], currentScene: scene(), userText: '继续前进', recentMessages: [],
  });
  assert.equal(miss.related.length, 0);

  const chineseHit = Context.selectMemoriesForContext({
    memories: [archived], currentScene: scene(), userText: '回到旧码头', recentMessages: [],
  });
  assert.deepEqual(Array.from(chineseHit.related, item => item.id), ['archive']);

  const asciiHit = Context.selectMemoriesForContext({
    memories: [archived], currentScene: scene(), userText: 'Use MoonKey now', recentMessages: [],
  });
  assert.deepEqual(Array.from(asciiHit.related, item => item.id), ['archive']);
});

test('always injects pinned archived history even without a direct keyword hit', () => {
  const Context = loadContext();
  const selected = Context.selectMemoriesForContext({
    memories: [memory({
      id: 'pinned_archive', type: 'history_event', status: 'archived', pinned: true,
      content: '很久以前失落的王冠被沉入湖底',
    })],
    currentScene: scene({ location: '沙漠' }),
    userText: '继续向北走',
    recentMessages: [],
  });
  assert.deepEqual(Array.from(selected.pinned, item => item.id), ['pinned_archive']);
  assert.deepEqual(Array.from(selected.trace.pinnedMemoryIds), ['pinned_archive']);
});

test('ranks user, scene, and recent-message matches deterministically before recency bonuses', () => {
  const Context = loadContext();
  const selected = Context.selectMemoriesForContext({
    memories: [
      memory({ id: 'recent_only', content: '风暴正在逼近', updatedAt: '2026-08-14T03:00:00.000Z' }),
      memory({ id: 'recent_message', content: '铁门需要密码', updatedAt: '2026-08-14T02:00:00.000Z' }),
      memory({ id: 'scene_match', content: '阿宁熟悉北门', updatedAt: '2026-08-14T01:00:00.000Z' }),
      memory({ id: 'user_match', content: '银钥匙能开启地下室', updatedAt: '2026-08-14T00:00:00.000Z' }),
    ],
    currentScene: scene({ location: '月港仓库', presentCharacters: ['阿宁'] }),
    userText: '用银钥匙开门',
    recentMessages: [{ role: 'assistant', content: '铁门就在面前' }],
  });

  assert.deepEqual(
    Array.from(selected.related.slice(0, 3), item => item.id),
    ['user_match', 'scene_match', 'recent_message'],
  );
  assert.deepEqual(
    Array.from(selected.trace.relatedMemoryIds),
    Array.from(selected.related, item => item.id),
  );
});

test('places the complete current scene before ordinary memory messages', () => {
  const Context = loadContext();
  const currentScene = scene({
    time: '深夜', location: '月港', presentCharacters: ['阿宁', '顾川'], currentGoal: '找到钥匙',
    currentConflict: '守卫封锁出口', characterStates: '阿宁受伤', environment: '暴雨',
    notes: '钟声响过三次', updatedAt: '2026-08-14T04:00:00.000Z',
  });
  const built = Context.buildMemoryContextMessages({
    memories: [memory({ id: 'related', content: '钥匙藏在钟楼' })],
    currentScene,
    userText: '寻找钥匙',
    recentMessages: [],
  });

  assert.match(built.messages[0].content, /^当前场景：/);
  for (const value of ['深夜', '月港', '阿宁、顾川', '找到钥匙', '守卫封锁出口', '阿宁受伤', '暴雨', '钟声响过三次']) {
    assert.ok(built.messages[0].content.includes(value), `scene must include ${value}`);
  }
  assert.match(built.messages[1].content, /^相关关键信息：/);
  assert.equal(built.trace.sceneUpdatedAt, currentScene.updatedAt);
  assert.equal(built.trace.usedSummary, false);
});

test('enforces the structured context budget and fills spare capacity with newest active history', () => {
  const Context = loadContext();
  const memories = [];
  for (let index = 0; index < 8; index += 1) {
    memories.push(memory({
      id: `history_${index}`,
      type: 'history_event',
      content: `第${index}条历史` + '长'.repeat(1800),
      updatedAt: `2026-08-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
    }));
  }
  const built = Context.buildMemoryContextMessages({
    memories,
    currentScene: scene({ location: '空港' }),
    userText: '无直接关键词',
    recentMessages: [],
  });

  assert.ok(built.usedCharacters <= Context.MEMORY_CONTEXT_CHAR_BUDGET);
  assert.equal(built.messages.reduce((sum, item) => sum + item.content.length, 0), built.usedCharacters);
  assert.ok(built.trace.relatedMemoryIds.length > 0);
  assert.ok(built.trace.relatedMemoryIds.length <= 5);
  assert.equal(built.trace.relatedMemoryIds[0], 'history_7');
});

test('reports over-budget pinned data instead of silently truncating it', () => {
  const Context = loadContext();
  assert.throws(() => Context.selectMemoriesForContext({
    memories: [memory({ id: 'too_large', content: 'A'.repeat(4001), pinned: true })],
    currentScene: scene(),
    userText: '',
    recentMessages: [],
  }), error => error && error.code === 'PINNED_BUDGET_EXCEEDED');
});

test('counts pinned archived history against the pinned budget without requiring a hit', () => {
  const Context = loadContext();
  assert.throws(() => Context.selectMemoriesForContext({
    memories: [memory({
      id: 'archived_too_large', type: 'history_event', status: 'archived', pinned: true,
      content: '旧'.repeat(4001),
    })],
    currentScene: scene(),
    userText: '',
    recentMessages: [],
  }), error => error && error.code === 'PINNED_BUDGET_EXCEEDED');
});
