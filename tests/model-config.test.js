const test = require('node:test');
const assert = require('node:assert/strict');

const Config = require('../js/model/model-config.js');

function memoryStorage(initial) {
  const entries = new Map(Object.entries(initial || {}));
  return {
    entries,
    getItem(key) { return entries.has(key) ? entries.get(key) : null; },
    setItem(key, value) { entries.set(key, String(value)); },
    removeItem(key) { entries.delete(key); },
  };
}

test('default model config is independent, cost protected, and uses GLM free chat', () => {
  const first = Config.createDefaultConfig();
  const second = Config.createDefaultConfig();

  assert.equal(first.version, Config.CONFIG_VERSION);
  assert.equal(first.defaultProvider, 'glm');
  assert.equal(first.glmApiKey, '');
  assert.equal(first.deepseekApiKey, '');
  assert.deepEqual(first.costPolicy, {
    airRequiresExplicitAction: true,
    freeRetryLimit: 1,
    automaticTasksUseFreeGlm: true,
  });
  assert.equal(Config.MODELS.glm.free, 'glm-4.7-flash');
  assert.equal(Config.MODELS.glm.air, 'glm-4.5-air');
  assert.equal(Config.MODELS.deepseek.chat, 'deepseek-v4-flash');

  first.costPolicy.freeRetryLimit = 99;
  first.connectionTests.glm.status = 'success';
  assert.equal(second.costPolicy.freeRetryLimit, 1);
  assert.equal(second.connectionTests.glm.status, 'untested');
});

test('normalizeConfig accepts only supported values and returns a defensive copy', () => {
  const input = {
    version: 99,
    defaultProvider: 'unknown',
    glmApiKey: '  glm-secret  ',
    deepseekApiKey: '  ds-secret  ',
    costPolicy: { airRequiresExplicitAction: false, freeRetryLimit: 7 },
    connectionTests: {
      glm: { status: 'success', checkedAt: '2026-08-23T08:00:00.000Z', message: 'ok' },
      deepseek: { status: 'invented', checkedAt: 123 },
    },
  };

  const normalized = Config.normalizeConfig(input);
  assert.equal(normalized.version, Config.CONFIG_VERSION);
  assert.equal(normalized.defaultProvider, 'glm');
  assert.equal(normalized.glmApiKey, 'glm-secret');
  assert.equal(normalized.deepseekApiKey, 'ds-secret');
  assert.deepEqual(normalized.costPolicy, Config.createDefaultConfig().costPolicy);
  assert.deepEqual(normalized.connectionTests.glm, {
    status: 'success', checkedAt: '2026-08-23T08:00:00.000Z', message: 'ok',
  });
  assert.deepEqual(normalized.connectionTests.deepseek, {
    status: 'untested', checkedAt: '', message: '',
  });

  input.connectionTests.glm.message = 'changed';
  assert.equal(normalized.connectionTests.glm.message, 'ok');
});

test('loadConfig returns defaults for missing or corrupt storage without writing', () => {
  const missing = memoryStorage();
  assert.deepEqual(Config.loadConfig(missing), Config.createDefaultConfig());
  assert.equal(missing.entries.size, 0);

  const corrupt = memoryStorage({ [Config.STORAGE_KEY]: '{not-json' });
  assert.deepEqual(Config.loadConfig(corrupt), Config.createDefaultConfig());
  assert.equal(corrupt.entries.get(Config.STORAGE_KEY), '{not-json');
});

test('saveConfig restores the previous raw value when a storage write fails after mutation', () => {
  const previousRaw = JSON.stringify({ version: 1, defaultProvider: 'glm', glmApiKey: 'old' });
  const storage = memoryStorage({ [Config.STORAGE_KEY]: previousRaw });
  const originalSet = storage.setItem;
  let writes = 0;
  storage.setItem = function (key, value) {
    writes += 1;
    originalSet.call(storage, key, value);
    if (writes === 1) throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
  };

  const result = Config.saveConfig(storage, { ...Config.createDefaultConfig(), glmApiKey: 'new' });
  assert.equal(result.ok, false);
  assert.equal(result.config.glmApiKey, 'old');
  assert.equal(storage.entries.get(Config.STORAGE_KEY), previousRaw);
  assert.equal(result.rollbackError, null);
});

test('saveConfig removes a newly-created key when the first save fails', () => {
  const storage = memoryStorage();
  const originalSet = storage.setItem;
  storage.setItem = function (key, value) {
    originalSet.call(storage, key, value);
    throw new Error('write failed');
  };

  const result = Config.saveConfig(storage, { ...Config.createDefaultConfig(), glmApiKey: 'new' });
  assert.equal(result.ok, false);
  assert.equal(result.config.glmApiKey, '');
  assert.equal(storage.entries.has(Config.STORAGE_KEY), false);
});

test('legacy DeepSeek key is adopted only when the global key is empty', () => {
  const empty = Config.createDefaultConfig();
  const adopted = Config.adoptLegacyDeepSeekKey(empty, '  legacy-key  ');
  assert.equal(adopted.migrated, true);
  assert.equal(adopted.config.deepseekApiKey, 'legacy-key');
  assert.equal(empty.deepseekApiKey, '');

  const configured = { ...Config.createDefaultConfig(), deepseekApiKey: 'global-key' };
  const ignored = Config.adoptLegacyDeepSeekKey(configured, 'legacy-key');
  assert.equal(ignored.migrated, false);
  assert.equal(ignored.config.deepseekApiKey, 'global-key');

  const blank = Config.adoptLegacyDeepSeekKey(empty, '   ');
  assert.equal(blank.migrated, false);
});

test('migrateLegacyDeepSeekKey persists atomically and keeps the old config on failure', () => {
  const storage = memoryStorage();
  const current = Config.createDefaultConfig();
  const successful = Config.migrateLegacyDeepSeekKey(storage, current, 'legacy-key');
  assert.equal(successful.ok, true);
  assert.equal(successful.migrated, true);
  assert.equal(Config.loadConfig(storage).deepseekApiKey, 'legacy-key');

  const failingStorage = memoryStorage();
  failingStorage.setItem = function () { throw new Error('blocked'); };
  const failed = Config.migrateLegacyDeepSeekKey(failingStorage, current, 'legacy-key');
  assert.equal(failed.ok, false);
  assert.equal(failed.migrated, false);
  assert.equal(failed.config.deepseekApiKey, '');
});
