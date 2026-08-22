const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadRenameRole(currentRole) {
  const html = fs.readFileSync('index.html', 'utf8');
  const fn = html.match(/function renameRole\(index, newName\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(fn, 'renameRole must exist in index.html');

  const calls = [];
  const state = {
    roles: [{ name: '阿宁', bio: '盟友', color: '#FF6B6B' }],
    currentRole,
    messages: [
      { role: 'user', content: '旧身份消息', _roleName: '阿宁' },
      { role: 'assistant', content: '回复' },
    ],
  };
  const context = {
    state,
    saveCurrentCharacter() { calls.push('save'); return { ok: true, rolledBack: true }; },
    renderRoles() { calls.push('roles'); },
    renderMessages() { calls.push('messages'); },
    updateIdentityBar() { calls.push('identity'); },
    characterMutationIsBlocked() { return false; },
  };
  vm.runInNewContext(`${fn}; this.renameRole = renameRole;`, context);
  return { ...context, calls };
}

test('renaming the selected role preserves selection and message identity', () => {
  const context = loadRenameRole('阿宁');

  context.renameRole(0, '  宁姐  ');

  assert.equal(context.state.roles[0].name, '宁姐');
  assert.equal(context.state.currentRole, '宁姐');
  assert.equal(context.state.messages[0]._roleName, '宁姐');
  assert.deepEqual(context.calls, ['save', 'roles', 'messages', 'identity']);
});

test('renaming an unselected role does not change the selected role', () => {
  const context = loadRenameRole('主控同伴');

  context.renameRole(0, '宁姐');

  assert.equal(context.state.roles[0].name, '宁姐');
  assert.equal(context.state.currentRole, '主控同伴');
  assert.equal(context.state.messages[0]._roleName, '宁姐');
});
