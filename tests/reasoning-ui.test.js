const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadController() {
  const sandbox = { globalThis: null };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  if (fs.existsSync('js/model/reasoning-ui.js')) {
    vm.runInContext(fs.readFileSync('js/model/reasoning-ui.js', 'utf8'), sandbox);
  }
  return sandbox.FonlingModels && sandbox.FonlingModels.ReasoningUI;
}

test('Air reasoning state is active while streaming and collapsed when complete', () => {
  const ReasoningUI = loadController();
  assert.ok(ReasoningUI, 'FonlingModels.ReasoningUI must be loaded');
  const controller = ReasoningUI.createController();

  controller.begin('assistant-1');
  assert.deepEqual(JSON.parse(JSON.stringify(controller.snapshot('assistant-1'))), {
    reasoning: '',
    status: 'active',
    expanded: true,
  });
  controller.update('assistant-1', '先核对关系。');
  controller.complete('assistant-1');

  assert.deepEqual(JSON.parse(JSON.stringify(controller.snapshot('assistant-1'))), {
    reasoning: '先核对关系。',
    status: 'complete',
    expanded: false,
  });
  controller.toggle('assistant-1');
  assert.equal(controller.snapshot('assistant-1').expanded, true);
});

test('reasoning state is removable, clearable, and isolated from message data', () => {
  const ReasoningUI = loadController();
  assert.ok(ReasoningUI, 'FonlingModels.ReasoningUI must be loaded');
  const controller = ReasoningUI.createController();
  const message = { id: 'assistant-1', role: 'assistant', content: '正式回答' };

  controller.begin(message.id);
  controller.update(message.id, '临时思考');
  assert.deepEqual(message, { id: 'assistant-1', role: 'assistant', content: '正式回答' });
  controller.remove(message.id);
  assert.equal(controller.snapshot(message.id), null);

  controller.begin('assistant-2');
  controller.update('assistant-2', '另一次思考');
  controller.clear();
  assert.equal(controller.snapshot('assistant-2'), null);
});
