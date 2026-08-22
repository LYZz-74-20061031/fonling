(function (global) {
  'use strict';

  const Model = global.FonlingMemory && global.FonlingMemory.Model;
  if (!Model) throw new Error('FonlingMemory.Model must be loaded before FonlingMemory.Storage');

  const MEMORY_FIELDS = [
    'memorySchemaVersion',
    'memories',
    'currentScene',
    'memoryCandidates',
    'memoryAnalysis',
    'memoryRequestTraces',
  ];

  function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (isRecord(value)) {
      const result = {};
      Object.keys(value).forEach(key => { result[key] = clone(value[key]); });
      return result;
    }
    return value;
  }

  function nowValue(now) {
    const supplied = typeof now === 'function' ? now() : now;
    if (typeof supplied === 'string' && supplied.trim()) return supplied;
    const date = supplied instanceof Date ? supplied : new Date(supplied === undefined ? Date.now() : supplied);
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
  }

  function createEmptyMemoryState() {
    return {
      memorySchemaVersion: Model.MEMORY_SCHEMA_VERSION,
      memories: [],
      currentScene: clone(Model.EMPTY_SCENE),
      memoryCandidates: [],
      memoryAnalysis: {
        analyzedTurnKeys: [],
        lastFailure: null,
        activeCharacter: null,
      },
      memoryRequestTraces: {},
    };
  }

  function diagnostic(diagnostics, path, message) {
    diagnostics.push({ path, message });
  }

  function nextUniqueId(createId, prefix, used) {
    const generate = typeof createId === 'function' ? createId : Model.createId;
    let candidate = '';
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const generated = generate(prefix);
      candidate = typeof generated === 'string' ? generated.trim() : '';
      if (candidate && !used.has(candidate)) {
        used.add(candidate);
        return candidate;
      }
    }
    candidate = Model.createId(prefix);
    const base = candidate;
    let suffix = 2;
    while (used.has(candidate)) {
      candidate = `${base}_${suffix}`;
      suffix += 1;
    }
    used.add(candidate);
    return candidate;
  }

  function normalizeMemories(value, diagnostics, createId, at) {
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
      diagnostic(diagnostics, 'memories', 'Expected an array; ignored invalid value.');
      return [];
    }
    const normalized = [];
    const reservedIds = new Set(value
      .filter(isRecord)
      .map(item => typeof item.id === 'string' ? item.id.trim() : '')
      .filter(Boolean));
    const seenIds = new Set();
    value.forEach((item, index) => {
      const prepared = clone(item);
      if (isRecord(prepared)) {
        const existingId = typeof prepared.id === 'string' ? prepared.id.trim() : '';
        if (!existingId) {
          prepared.id = nextUniqueId(createId, 'memory', reservedIds);
        } else if (seenIds.has(existingId)) {
          prepared.id = nextUniqueId(createId, 'memory', reservedIds);
          diagnostics.push({ code: 'duplicate_id', path: `memories[${index}].id`, message: 'Replaced duplicate memory ID.' });
        } else {
          prepared.id = existingId;
        }
        if (typeof prepared.createdAt !== 'string' || !prepared.createdAt.trim()) prepared.createdAt = at;
        if (typeof prepared.updatedAt !== 'string' || !prepared.updatedAt.trim()) prepared.updatedAt = prepared.createdAt;
      }
      const memory = Model.normalizeMemory(prepared);
      if (memory) {
        normalized.push(memory);
        seenIds.add(memory.id);
      }
      else diagnostic(diagnostics, `memories[${index}]`, 'Ignored invalid memory.');
    });
    return normalized;
  }

  function normalizeCandidates(value, diagnostics, createId, at) {
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
      diagnostic(diagnostics, 'memoryCandidates', 'Expected an array; ignored invalid value.');
      return [];
    }
    const normalized = [];
    const reservedIds = new Set(value
      .filter(isRecord)
      .map(item => typeof item.id === 'string' ? item.id.trim() : '')
      .filter(Boolean));
    const seenIds = new Set();
    value.forEach((item, index) => {
      const prepared = clone(item);
      if (isRecord(prepared)) {
        const existingId = typeof prepared.id === 'string' ? prepared.id.trim() : '';
        if (!existingId) {
          prepared.id = nextUniqueId(createId, 'candidate', reservedIds);
        } else if (seenIds.has(existingId)) {
          prepared.id = nextUniqueId(createId, 'candidate', reservedIds);
          diagnostics.push({ code: 'duplicate_id', path: `memoryCandidates[${index}].id`, message: 'Replaced duplicate candidate ID.' });
        } else {
          prepared.id = existingId;
        }
        if (typeof prepared.createdAt !== 'string' || !prepared.createdAt.trim()) prepared.createdAt = at;
        if (typeof prepared.updatedAt !== 'string' || !prepared.updatedAt.trim()) prepared.updatedAt = prepared.createdAt;
      }
      const candidate = Model.normalizeCandidate(prepared);
      if (candidate) {
        normalized.push(candidate);
        seenIds.add(candidate.id);
      }
      else diagnostic(diagnostics, `memoryCandidates[${index}]`, 'Ignored invalid candidate.');
    });
    return normalized;
  }

  function normalizeAnalysis(value, diagnostics) {
    const fallback = createEmptyMemoryState().memoryAnalysis;
    if (value === undefined) return fallback;
    if (!isRecord(value)) {
      diagnostic(diagnostics, 'memoryAnalysis', 'Expected an object; used defaults.');
      return fallback;
    }

    const analyzedTurnKeys = Array.isArray(value.analyzedTurnKeys)
      ? value.analyzedTurnKeys.filter(item => typeof item === 'string').map(item => item.trim()).filter(Boolean)
      : [];
    if (value.analyzedTurnKeys !== undefined
      && (!Array.isArray(value.analyzedTurnKeys)
        || analyzedTurnKeys.length !== value.analyzedTurnKeys.length)) {
      diagnostic(diagnostics, 'memoryAnalysis.analyzedTurnKeys', 'Ignored invalid turn keys.');
    }
    const activeCharacter = value.activeCharacter === null || typeof value.activeCharacter === 'string'
      ? value.activeCharacter
      : null;
    if (value.activeCharacter !== undefined && activeCharacter === null && value.activeCharacter !== null) {
      diagnostic(diagnostics, 'memoryAnalysis.activeCharacter', 'Ignored invalid active character.');
    }
    return {
      analyzedTurnKeys,
      lastFailure: value.lastFailure === undefined ? null : clone(value.lastFailure),
      activeCharacter: activeCharacter === undefined ? null : activeCharacter,
    };
  }

  function migrateLegacyList(settings, field, type, at, createId, usedIds, diagnostics, target) {
    const value = settings[field];
    if (value === undefined) return;
    if (!Array.isArray(value)) {
      diagnostic(diagnostics, field, 'Expected an array; ignored invalid value.');
      return;
    }
    value.forEach((item, index) => {
      if (typeof item !== 'string' || !item.trim()) {
        diagnostic(diagnostics, `${field}[${index}]`, 'Ignored invalid legacy entry.');
        return;
      }
      target.push({
        id: nextUniqueId(createId, 'memory', usedIds),
        type,
        content: item.trim(),
        status: 'active',
        pinned: false,
        createdAt: at,
        updatedAt: at,
        source: 'migration',
      });
    });
  }

  function normalizeMessages(messages, createId, diagnostics) {
    if (!Array.isArray(messages)) {
      if (messages !== undefined) diagnostic(diagnostics, 'messages', 'Expected an array; used an empty list.');
      return [];
    }
    const valid = [];
    messages.forEach((message, index) => {
      if (isRecord(message)) valid.push(clone(message));
      else diagnostic(diagnostics, `messages[${index}]`, 'Ignored invalid message.');
    });
    Model.ensureMessageIds(valid, createId);
    return valid;
  }

  function migrateCharacterData(settings, messages, options) {
    const sourceSettings = isRecord(settings) ? settings : {};
    const diagnostics = [];
    if (!isRecord(settings) && settings !== undefined) {
      diagnostic(diagnostics, 'settings', 'Expected an object; used defaults.');
    }
    if (Number(sourceSettings.memorySchemaVersion) > Model.MEMORY_SCHEMA_VERSION) {
      return {
        settings: clone(sourceSettings),
        messages: clone(messages),
        changed: false,
        supported: false,
        diagnostics: [{
          code: 'unsupported_future_schema',
          path: 'memorySchemaVersion',
          message: `Memory schema version ${sourceSettings.memorySchemaVersion} is not supported.`,
        }],
      };
    }
    const resultSettings = clone(sourceSettings);
    const opts = isRecord(options) ? options : {};
    const createId = typeof opts.createId === 'function' ? opts.createId : Model.createId;
    const at = nowValue(opts.now);
    const isLegacy = !(Number(sourceSettings.memorySchemaVersion) >= Model.MEMORY_SCHEMA_VERSION);
    const defaults = createEmptyMemoryState();

    resultSettings.memorySchemaVersion = Model.MEMORY_SCHEMA_VERSION;
    resultSettings.memories = normalizeMemories(sourceSettings.memories, diagnostics, createId, at);
    if (Model.getPinnedCharacterCount(resultSettings.memories) > Model.PINNED_MEMORY_CHAR_BUDGET) {
      diagnostics.push({
        code: 'pinned_budget_exceeded',
        path: 'memories',
        message: `Pinned memory content exceeds ${Model.PINNED_MEMORY_CHAR_BUDGET} characters.`,
      });
    }
    const usedMemoryIds = new Set(resultSettings.memories.map(item => item.id));

    if (isLegacy) {
      migrateLegacyList(sourceSettings, 'historyEvents', 'history_event', at, createId, usedMemoryIds, diagnostics, resultSettings.memories);
      migrateLegacyList(sourceSettings, 'keyInfo', 'key_info', at, createId, usedMemoryIds, diagnostics, resultSettings.memories);
    }

    if (isLegacy) {
      resultSettings.currentScene = clone(defaults.currentScene);
      if (sourceSettings.currentState !== undefined) {
        if (typeof sourceSettings.currentState === 'string') {
          resultSettings.currentScene.notes = sourceSettings.currentState.trim();
          if (resultSettings.currentScene.notes) resultSettings.currentScene.updatedAt = at;
        } else {
          diagnostic(diagnostics, 'currentState', 'Ignored invalid legacy scene notes.');
        }
      }
      delete resultSettings.historyEvents;
      delete resultSettings.keyInfo;
      delete resultSettings.currentState;
    } else {
      const scene = Model.normalizeScene(clone(sourceSettings.currentScene));
      if (scene) resultSettings.currentScene = scene;
      else {
        resultSettings.currentScene = clone(defaults.currentScene);
        if (sourceSettings.currentScene !== undefined) {
          diagnostic(diagnostics, 'currentScene', 'Ignored invalid scene; used defaults.');
        }
      }
    }

    resultSettings.memoryCandidates = normalizeCandidates(sourceSettings.memoryCandidates, diagnostics, createId, at);
    resultSettings.memoryAnalysis = normalizeAnalysis(sourceSettings.memoryAnalysis, diagnostics);
    if (sourceSettings.memoryRequestTraces === undefined) {
      resultSettings.memoryRequestTraces = {};
    } else if (isRecord(sourceSettings.memoryRequestTraces)) {
      resultSettings.memoryRequestTraces = clone(sourceSettings.memoryRequestTraces);
    } else {
      resultSettings.memoryRequestTraces = {};
      diagnostic(diagnostics, 'memoryRequestTraces', 'Expected an object; used defaults.');
    }

    const resultMessages = normalizeMessages(messages, createId, diagnostics);
    const changed = JSON.stringify(resultSettings) !== JSON.stringify(sourceSettings)
      || JSON.stringify(resultMessages) !== JSON.stringify(Array.isArray(messages) ? messages : []);

    return {
      settings: resultSettings,
      messages: resultMessages,
      changed,
      supported: true,
      diagnostics,
    };
  }

  function serializeMemoryState(state) {
    const source = isRecord(state) ? state : createEmptyMemoryState();
    const serialized = {};
    MEMORY_FIELDS.forEach(field => { serialized[field] = clone(source[field]); });
    return serialized;
  }

  function estimateSerializedBytes(value) {
    try {
      const serialized = JSON.stringify(value);
      if (typeof serialized !== 'string') return 0;
      if (typeof global.TextEncoder === 'function') return new global.TextEncoder().encode(serialized).length;
      return serialized.length * 2;
    } catch (_) {
      return 0;
    }
  }

  function isQuotaExceededError(error) {
    if (!error || (typeof error !== 'object' && typeof error !== 'function')) return false;
    return error.name === 'QuotaExceededError'
      || error.name === 'NS_ERROR_DOM_QUOTA_REACHED'
      || error.code === 22
      || error.code === 1014;
  }

  global.FonlingMemory = global.FonlingMemory || {};
  global.FonlingMemory.Storage = {
    createEmptyMemoryState,
    migrateCharacterData,
    serializeMemoryState,
    estimateSerializedBytes,
    isQuotaExceededError,
  };
})(globalThis);
