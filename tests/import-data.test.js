const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadImportData() {
  const html = fs.readFileSync('index.html', 'utf8');
  const fn = html.match(/function importData\(file\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(fn, 'importData must exist in index.html');

  const state = {
    apiKey: '',
    systemPrompt: '',
    style: '',
    bgImage: '',
    summary: '',
    historyEvents: [],
    currentState: '',
    userIdentity: '',
    messages: [],
    keyInfo: ['导入前的旧关键信息'],
    roles: [{ name: '旧身份', bio: '不应保留', color: '#000000' }],
    currentRole: '旧身份',
  };

  class FakeFileReader {
    readAsText(file) {
      this.onload({ target: { result: file.contents } });
    }
  }

  const context = {
    state,
    FileReader: FakeFileReader,
    saveCurrentCharacter() {},
    syncSettingsUI() {},
    updateIdentityBar() {},
    applyBackground() {},
    renderMessages() {},
    settingsOverlay: { classList: { remove() {} } },
    addSystemMsg() {},
  };
  vm.runInNewContext(`${fn}; this.importData = importData;`, context);
  return context;
}

test('restores key information and role identity data from an exported backup', () => {
  const context = loadImportData();
  const backup = {
    settings: {
      apiKey: 'backup-key',
      systemPrompt: '备份人设',
      style: '备份风格',
      bgImage: '',
      summary: '备份摘要',
      historyEvents: ['备份历史事件'],
      currentState: '备份当下状态',
      userIdentity: '备份用户身份',
      keyInfo: ['阿宁知道密道的位置'],
      roles: [{ name: '阿宁', bio: '主角的盟友', color: '#FF6B6B' }],
      currentRole: '阿宁',
    },
    messages: [{ role: 'user', content: '测试消息' }],
  };

  context.importData({ contents: JSON.stringify(backup) });

  assert.equal(JSON.stringify(context.state.keyInfo), JSON.stringify(backup.settings.keyInfo));
  assert.equal(JSON.stringify(context.state.roles), JSON.stringify(backup.settings.roles));
  assert.equal(context.state.currentRole, '阿宁');
});
