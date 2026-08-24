const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadContext() {
  const sandbox = { globalThis: null };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync('js/memory/memory-context.js', 'utf8'), sandbox);
  return sandbox.FonlingMemory.Context;
}

test('an explicit Air memory budget can select more relevant context than the ordinary default', () => {
  const context = loadContext();
  const memories = Array.from({ length: 5 }, (_, index) => ({
    id: `memory-${index}`,
    type: 'history_event',
    status: 'active',
    updatedAt: `2026-08-${String(20 - index).padStart(2, '0')}T00:00:00.000Z`,
    content: `石门线索${index}：` + '相关剧情'.repeat(850),
  }));
  const input = {
    memories,
    userText: '石门线索',
    currentScene: {},
    recentMessages: [],
  };

  const ordinary = context.buildMemoryContextMessages(input);
  const air = context.buildMemoryContextMessages({ ...input, budget: 12000 });

  assert.ok(ordinary.usedCharacters <= 8000);
  assert.ok(air.usedCharacters <= 12000);
  assert.ok(air.usedCharacters > ordinary.usedCharacters);
  assert.ok(air.related.length > ordinary.related.length);
});
