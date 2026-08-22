const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function extract(name) {
  const html = fs.readFileSync('index.html', 'utf8');
  const fn = html.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`))?.[0];
  assert.ok(fn, `${name} must exist`); return fn;
}
function harness(saveResult = { ok: false, rolledBack: true }) {
  const calls = [];
  const state = { currentCharacter: 'Mira', currentRole: 'Mira', roles: [{ name: 'Mira' }, { name: 'Ari' }], messages: [{ _roleName: 'Mira', content: 'draft' }] };
  const context = {
    state, loadedCharacterSettings: { kept: true }, LS: { CURRENT_CHAR: 'current' },
    PRESET_COLORS: ['#ff6b6b', '#00d4aa'], addSystemMsg() { calls.push('system'); },
    saveCurrentCharacter() { calls.push('save'); return saveResult; },
    localStorage: { removeItem() { calls.push('remove-current'); } }, showLoginScreen() { calls.push('login'); },
    renderRoles() { calls.push('roles'); }, renderMessages() { calls.push('messages'); }, updateIdentityBar() { calls.push('identity'); }, updateBubbleColor() { calls.push('bubble'); },
    reportSaveFailure(result) { calls.push(result && result.quotaExceeded ? 'quota-warning' : 'warning'); },
    characterMutationIsBlocked() { if (!state.isStreaming) return false; calls.push('system'); return true; },
  };
  const code = ['switchCharacter', 'addRole', 'deleteRole', 'updateRoleBio', 'renameRole', 'switchToRole', 'switchToMain'].map(extract).join('\n');
  vm.runInNewContext(`${code}; this.api={switchCharacter,addRole,deleteRole,updateRoleBio,renameRole,switchToRole,switchToMain}`, context);
  return { ...context, calls };
}

test('switchCharacter does not leave the current character when save fails', () => {
  const app = harness(); app.api.switchCharacter();
  assert.equal(app.state.currentCharacter, 'Mira');
  assert.deepEqual(app.calls, ['save', 'warning']);
  assert.deepEqual(app.loadedCharacterSettings, { kept: true });
});

test('character switching is refused while a reply placeholder is streaming', () => {
  const app = harness({ ok: true, rolledBack: true });
  app.state.isStreaming = true;
  app.state.messages.push({ role: 'assistant', content: '', _streaming: true });
  app.api.switchCharacter();
  assert.equal(app.state.currentCharacter, 'Mira');
  assert.equal(app.calls.includes('save'), false);
  assert.equal(app.state.messages.at(-1)._streaming, true);
});

test('renameRole restores role, selection, and message names when save fails', () => {
  const app = harness(); app.api.renameRole(0, 'Nora');
  assert.equal(app.state.roles[0].name, 'Mira');
  assert.equal(app.state.currentRole, 'Mira');
  assert.equal(app.state.messages[0]._roleName, 'Mira');
  assert.deepEqual(app.calls, ['save', 'roles', 'messages', 'identity', 'warning']);
});

test('renameRole rollback restores only values changed by that rename', () => {
  const app = harness();
  app.state.currentRole = 'Ari';
  app.state.messages.push({ _roleName: 'Ari', content: 'already Ari' });
  app.api.renameRole(0, 'Ari');
  assert.equal(app.state.roles[0].name, 'Mira');
  assert.equal(app.state.currentRole, 'Ari');
  assert.deepEqual(app.state.messages.map(message => message._roleName), ['Mira', 'Ari']);
  assert.deepEqual(app.calls, ['save', 'roles', 'messages', 'identity', 'warning']);
});

test('add role rolls back state and visible roles when save fails', () => {
  const app = harness();
  app.api.addRole();
  assert.deepEqual(app.state.roles, [{ name: 'Mira' }, { name: 'Ari' }]);
  assert.equal(app.state.currentRole, 'Mira');
  assert.deepEqual(app.calls, ['save', 'warning', 'roles']);
});

test('delete role restores role, selection, messages, and identity when save fails', () => {
  const app = harness();
  app.api.deleteRole(0);
  assert.deepEqual(app.state.roles, [{ name: 'Mira' }, { name: 'Ari' }]);
  assert.equal(app.state.currentRole, 'Mira');
  assert.deepEqual(app.calls, ['save', 'warning', 'roles', 'messages', 'identity', 'bubble']);
});

test('bio edit restores the old value and visible input when save fails', () => {
  const app = harness();
  app.state.roles[0].bio = 'old bio';
  app.api.updateRoleBio(0, 'new bio');
  assert.equal(app.state.roles[0].bio, 'old bio');
  assert.deepEqual(app.calls, ['save', 'warning', 'roles']);
});

test('role mutations keep their successful behavior when save succeeds', () => {
  const added = harness({ ok: true, rolledBack: true });
  added.api.addRole();
  assert.equal(added.state.roles.length, 3);
  assert.equal(added.state.roles[2].color, '#ff6b6b');
  assert.equal(added.state.roles[2].name, '');
  assert.equal(added.state.roles[2].bio, '');
  assert.deepEqual(added.calls, ['save', 'roles']);

  const removed = harness({ ok: true, rolledBack: true });
  removed.api.deleteRole(0);
  assert.deepEqual(removed.state.roles, [{ name: 'Ari' }]);
  assert.equal(removed.state.currentRole, null);
  assert.deepEqual(removed.calls, ['save', 'roles', 'messages', 'identity', 'bubble']);

  const bio = harness({ ok: true, rolledBack: true });
  bio.state.roles[0].bio = 'old bio';
  bio.api.updateRoleBio(0, 'new bio');
  assert.equal(bio.state.roles[0].bio, 'new bio');
  assert.deepEqual(bio.calls, ['save', 'roles']);
});

test('switchToRole and switchToMain restore selection and stop UI when save fails', () => {
  const role = harness(); role.api.switchToRole('Ari');
  assert.equal(role.state.currentRole, 'Mira'); assert.deepEqual(role.calls, ['save', 'roles', 'identity', 'warning']);
  const main = harness(); main.api.switchToMain();
  assert.equal(main.state.currentRole, 'Mira'); assert.deepEqual(main.calls, ['save', 'roles', 'identity', 'warning']);
});
