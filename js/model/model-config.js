(function (global) {
  'use strict';

  const CONFIG_VERSION = 1;
  const STORAGE_KEY = 'fonling_model_config_v1';
  const PROVIDERS = Object.freeze({
    GLM: 'glm',
    DEEPSEEK: 'deepseek',
  });
  const MODELS = Object.freeze({
    glm: Object.freeze({
      free: 'glm-4.7-flash',
      air: 'glm-4.5-air',
    }),
    deepseek: Object.freeze({
      chat: 'deepseek-v4-flash',
    }),
  });
  const TEST_STATUSES = Object.freeze([
    'untested',
    'testing',
    'success',
    'invalid_key',
    'rate_limited',
    'unavailable',
    'error',
  ]);

  function cleanString(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function createDefaultConnectionTest() {
    return { status: 'untested', checkedAt: '', message: '' };
  }

  function createDefaultConfig() {
    return {
      version: CONFIG_VERSION,
      defaultProvider: PROVIDERS.GLM,
      glmApiKey: '',
      deepseekApiKey: '',
      costPolicy: {
        airRequiresExplicitAction: true,
        freeRetryLimit: 1,
        automaticTasksUseFreeGlm: true,
      },
      connectionTests: {
        glm: createDefaultConnectionTest(),
        deepseek: createDefaultConnectionTest(),
      },
    };
  }

  function normalizeConnectionTest(value) {
    if (!isRecord(value) || !TEST_STATUSES.includes(value.status)) {
      return createDefaultConnectionTest();
    }
    return {
      status: value.status,
      checkedAt: cleanString(value.checkedAt),
      message: cleanString(value.message),
    };
  }

  function normalizeConfig(value) {
    const source = isRecord(value) ? value : {};
    const defaults = createDefaultConfig();
    return {
      version: CONFIG_VERSION,
      defaultProvider: source.defaultProvider === PROVIDERS.DEEPSEEK
        ? PROVIDERS.DEEPSEEK
        : PROVIDERS.GLM,
      glmApiKey: cleanString(source.glmApiKey),
      deepseekApiKey: cleanString(source.deepseekApiKey),
      costPolicy: { ...defaults.costPolicy },
      connectionTests: {
        glm: normalizeConnectionTest(source.connectionTests && source.connectionTests.glm),
        deepseek: normalizeConnectionTest(source.connectionTests && source.connectionTests.deepseek),
      },
    };
  }

  function readRaw(storage) {
    if (!storage || typeof storage.getItem !== 'function') return null;
    try {
      return storage.getItem(STORAGE_KEY);
    } catch (_) {
      return null;
    }
  }

  function configFromRaw(raw) {
    if (typeof raw !== 'string' || !raw) return createDefaultConfig();
    try {
      return normalizeConfig(JSON.parse(raw));
    } catch (_) {
      return createDefaultConfig();
    }
  }

  function loadConfig(storage) {
    return configFromRaw(readRaw(storage));
  }

  function restoreRaw(storage, previousRaw) {
    if (previousRaw === null) {
      storage.removeItem(STORAGE_KEY);
    } else {
      storage.setItem(STORAGE_KEY, previousRaw);
    }
  }

  function saveConfig(storage, value) {
    const normalized = normalizeConfig(value);
    if (!storage || typeof storage.setItem !== 'function' || typeof storage.removeItem !== 'function') {
      return {
        ok: false,
        config: createDefaultConfig(),
        error: new Error('Model configuration storage is unavailable.'),
        rollbackError: null,
      };
    }

    const previousRaw = readRaw(storage);
    const previousConfig = configFromRaw(previousRaw);
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(normalized));
      return { ok: true, config: normalizeConfig(normalized), error: null, rollbackError: null };
    } catch (error) {
      let rollbackError = null;
      try {
        restoreRaw(storage, previousRaw);
      } catch (restoreError) {
        rollbackError = restoreError;
      }
      return { ok: false, config: previousConfig, error, rollbackError };
    }
  }

  function adoptLegacyDeepSeekKey(config, legacyKey) {
    const current = normalizeConfig(config);
    const candidate = cleanString(legacyKey);
    if (!candidate || current.deepseekApiKey) {
      return { migrated: false, config: current };
    }
    current.deepseekApiKey = candidate;
    return { migrated: true, config: current };
  }

  function migrateLegacyDeepSeekKey(storage, config, legacyKey) {
    const adopted = adoptLegacyDeepSeekKey(config, legacyKey);
    if (!adopted.migrated) {
      return { ok: true, migrated: false, config: adopted.config, error: null, rollbackError: null };
    }
    const saved = saveConfig(storage, adopted.config);
    if (!saved.ok) {
      return {
        ok: false,
        migrated: false,
        config: normalizeConfig(config),
        error: saved.error,
        rollbackError: saved.rollbackError,
      };
    }
    return { ...saved, migrated: true };
  }

  const api = Object.freeze({
    CONFIG_VERSION,
    STORAGE_KEY,
    PROVIDERS,
    MODELS,
    TEST_STATUSES,
    createDefaultConfig,
    normalizeConfig,
    loadConfig,
    saveConfig,
    adoptLegacyDeepSeekKey,
    migrateLegacyDeepSeekKey,
  });

  global.FonlingModels = global.FonlingModels || {};
  global.FonlingModels.Config = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
