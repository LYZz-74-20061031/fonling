(function (global) {
  'use strict';

  const MEMORY_SCHEMA_VERSION = 2;
  const PINNED_MEMORY_CHAR_BUDGET = 4000;
  const MEMORY_TYPES = Object.freeze(['history_event', 'key_info']);
  const CANDIDATE_OPERATIONS = Object.freeze(['add', 'update', 'merge', 'resolve', 'scene_patch']);
  const SCENE_KEYS = Object.freeze([
    'time',
    'location',
    'presentCharacters',
    'currentGoal',
    'currentConflict',
    'characterStates',
    'environment',
    'notes',
  ]);
  const SCENE_METADATA_KEYS = Object.freeze(['updatedAt']);
  const NORMALIZED_SCENE_KEYS = Object.freeze([...SCENE_KEYS, ...SCENE_METADATA_KEYS]);
  const ARRAY_SCENE_KEYS = Object.freeze(['presentCharacters']);
  const EMPTY_SCENE = Object.freeze({
    time: '',
    location: '',
    presentCharacters: Object.freeze([]),
    currentGoal: '',
    currentConflict: '',
    characterStates: '',
    environment: '',
    notes: '',
    updatedAt: '',
  });

  function cleanString(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function timestamp(now) {
    if (typeof now === 'string' && now.trim()) return now;
    const date = now instanceof Date ? now : new Date(now === undefined ? Date.now() : now);
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
  }

  function createId(prefix) {
    const safePrefix = cleanString(prefix) || 'id';
    const cryptoApi = global.crypto;
    const suffix = cryptoApi && typeof cryptoApi.randomUUID === 'function'
      ? cryptoApi.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    return `${safePrefix}_${suffix}`;
  }

  function ensureMessageIds(messages, createIdFn) {
    if (!Array.isArray(messages)) return [];
    const generate = typeof createIdFn === 'function' ? createIdFn : createId;
    const reserved = new Set(messages
      .filter(isRecord)
      .map(message => cleanString(message.id))
      .filter(Boolean));
    const used = new Set();

    messages.forEach(message => {
      if (!isRecord(message)) return;
      const existing = cleanString(message.id);
      if (existing && !used.has(existing)) {
        message.id = existing;
        used.add(existing);
        return;
      }

      let candidate = cleanString(generate('message')) || createId('message');
      const base = candidate;
      let suffix = 2;
      while (reserved.has(candidate) || used.has(candidate)) {
        candidate = `${base}_${suffix}`;
        suffix += 1;
      }
      message.id = candidate;
      reserved.add(candidate);
      used.add(candidate);
    });

    return messages;
  }

  function memoryStatusIsValid(type, status) {
    if (status === 'active') return true;
    if (type === 'history_event') return status === 'archived';
    return status === 'resolved' || status === 'invalidated';
  }

  function normalizeMemory(value) {
    if (!isRecord(value)) return null;
    const type = cleanString(value.type);
    const content = cleanString(value.content);
    const status = value.status === undefined ? 'active' : cleanString(value.status);
    if (!MEMORY_TYPES.includes(type) || !content || !memoryStatusIsValid(type, status)) return null;

    const createdAt = typeof value.createdAt === 'string' && value.createdAt.trim()
      ? value.createdAt
      : timestamp();
    const updatedAt = typeof value.updatedAt === 'string' && value.updatedAt.trim()
      ? value.updatedAt
      : createdAt;

    const memory = {
      id: cleanString(value.id) || createId('memory'),
      type,
      content,
      status,
      pinned: value.pinned === true,
      createdAt,
      updatedAt,
    };
    if (Object.prototype.hasOwnProperty.call(value, 'source')) {
      if (typeof value.source !== 'string') return null;
      memory.source = value.source.trim();
    }
    if (Object.prototype.hasOwnProperty.call(value, 'sourceMessageIds')) {
      const sourceMessageIds = normalizeIdArray(value.sourceMessageIds);
      if (sourceMessageIds === null) return null;
      memory.sourceMessageIds = sourceMessageIds;
    }
    return memory;
  }

  function createMemory(input, now) {
    if (!isRecord(input)) return null;
    const at = timestamp(now);
    return normalizeMemory({
      ...input,
      id: cleanString(input.id) || createId('memory'),
      status: input.status === undefined ? 'active' : input.status,
      pinned: input.pinned === true,
      createdAt: typeof input.createdAt === 'string' && input.createdAt.trim() ? input.createdAt : at,
      updatedAt: typeof input.updatedAt === 'string' && input.updatedAt.trim() ? input.updatedAt : at,
    });
  }

  function normalizeStringArray(value) {
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) return null;
    return value.map(cleanString).filter(Boolean);
  }

  function normalizeIdArray(value) {
    const normalized = normalizeStringArray(value);
    return normalized === null ? null : [...new Set(normalized)];
  }

  function normalizeSceneValue(key, value) {
    if (ARRAY_SCENE_KEYS.includes(key)) return normalizeStringArray(value);
    return typeof value === 'string' ? value.trim() : null;
  }

  function hasOnlyKeys(value, keys) {
    return Object.keys(value).every(key => keys.includes(key));
  }

  function normalizeScene(value) {
    if (!isRecord(value) || !hasOnlyKeys(value, NORMALIZED_SCENE_KEYS)) return null;
    const normalized = {};

    for (const key of NORMALIZED_SCENE_KEYS) {
      const rawValue = Object.prototype.hasOwnProperty.call(value, key) ? value[key] : EMPTY_SCENE[key];
      const normalizedValue = normalizeSceneValue(key, rawValue);
      if (normalizedValue === null) return null;
      normalized[key] = normalizedValue;
    }

    return normalized;
  }

  function normalizeScenePatch(value) {
    if (!isRecord(value) || !Object.keys(value).length || !hasOnlyKeys(value, SCENE_KEYS)) return null;
    const normalized = {};

    for (const key of Object.keys(value)) {
      const normalizedValue = normalizeSceneValue(key, value[key]);
      if (normalizedValue === null) return null;
      normalized[key] = normalizedValue;
    }

    return normalized;
  }

  function normalizeTargetIds(value) {
    if (!Array.isArray(value)) return [];
    return normalizeIdArray(value);
  }

  function candidateFieldsAreValid(candidate) {
    if (candidate.operation === 'scene_patch') return candidate.scenePatch !== null;
    const targetCount = candidate.targetMemoryIds.length;
    if (candidate.operation === 'add') return Boolean(candidate.content);
    if (candidate.operation === 'update') return Boolean(candidate.content) && targetCount === 1;
    if (candidate.operation === 'merge') return Boolean(candidate.content) && targetCount >= 2;
    if (candidate.operation === 'resolve') {
      if (targetCount < 1) return false;
      if (candidate.memoryType === 'history_event') return candidate.resultStatus === 'archived';
      return candidate.resultStatus === 'resolved' || candidate.resultStatus === 'invalidated';
    }
    return false;
  }

  function normalizeCandidate(value) {
    if (!isRecord(value)) return null;
    const operation = cleanString(value.operation);
    if (!CANDIDATE_OPERATIONS.includes(operation)) return null;

    const createdAt = typeof value.createdAt === 'string' && value.createdAt.trim()
      ? value.createdAt
      : timestamp();
    const updatedAt = typeof value.updatedAt === 'string' && value.updatedAt.trim()
      ? value.updatedAt
      : createdAt;
    const candidate = {
      id: cleanString(value.id) || createId('candidate'),
      operation,
      status: value.status === undefined ? 'pending' : cleanString(value.status),
      sourceMessageIds: value.sourceMessageIds === undefined ? [] : normalizeIdArray(value.sourceMessageIds),
      conflict: value.conflict === undefined ? false : value.conflict,
      possibleConflict: value.possibleConflict === undefined ? false : value.possibleConflict,
      createdAt,
      updatedAt,
    };
    if (candidate.status !== 'pending'
      || candidate.sourceMessageIds === null
      || typeof candidate.conflict !== 'boolean'
      || typeof candidate.possibleConflict !== 'boolean') return null;

    for (const field of ['reason', 'source', 'oldContent']) {
      if (!Object.prototype.hasOwnProperty.call(value, field)) continue;
      if (typeof value[field] !== 'string') return null;
      candidate[field] = value[field].trim();
    }

    if (operation === 'scene_patch') {
      candidate.scenePatch = normalizeScenePatch(value.scenePatch);
    } else {
      candidate.memoryType = cleanString(value.memoryType) || cleanString(value.type);
      if (!MEMORY_TYPES.includes(candidate.memoryType)) return null;
      candidate.content = cleanString(value.content);
      candidate.targetMemoryIds = normalizeTargetIds(value.targetMemoryIds);
      if (candidate.targetMemoryIds === null) return null;
      if (Object.prototype.hasOwnProperty.call(value, 'pinned')) {
        if (typeof value.pinned !== 'boolean') return null;
        candidate.pinned = value.pinned;
      }
      if (operation === 'resolve') candidate.resultStatus = cleanString(value.resultStatus);
    }

    return candidateFieldsAreValid(candidate) ? candidate : null;
  }

  function createCandidate(input, now) {
    if (!isRecord(input)) return null;
    const at = timestamp(now);
    return normalizeCandidate({
      ...input,
      id: cleanString(input.id) || createId('candidate'),
      createdAt: typeof input.createdAt === 'string' && input.createdAt.trim() ? input.createdAt : at,
      updatedAt: typeof input.updatedAt === 'string' && input.updatedAt.trim() ? input.updatedAt : at,
    });
  }

  function applyScenePatch(scene, patch, now) {
    if (!isRecord(scene)) return null;
    const normalizedPatch = normalizeScenePatch(patch);
    if (!normalizedPatch) return null;

    const normalizedScene = normalizeScene(scene);
    if (!normalizedScene) return null;

    return {
      ...normalizedScene,
      ...normalizedPatch,
      updatedAt: timestamp(now),
    };
  }

  function failedMemoryOperation(memories, error) {
    return { ok: false, memories, error };
  }

  function getPinnedCharacterCount(memories) {
    if (!Array.isArray(memories)) return 0;
    return memories.reduce((total, memory) => (
      memory && memory.pinned === true && typeof memory.content === 'string'
        ? total + memory.content.trim().length
        : total
    ), 0);
  }

  function pinnedBudgetAllows(memories, previousMemories) {
    const nextCount = getPinnedCharacterCount(memories);
    if (nextCount <= PINNED_MEMORY_CHAR_BUDGET) return true;
    return Array.isArray(previousMemories) && nextCount <= getPinnedCharacterCount(previousMemories);
  }

  function addMemory(memories, input, now) {
    if (!Array.isArray(memories)) return failedMemoryOperation(memories, 'INVALID_MEMORY_LIST');
    const memory = createMemory(input, now);
    if (!memory) return failedMemoryOperation(memories, 'INVALID_MEMORY');
    if (memories.some(item => item && item.id === memory.id)) {
      return failedMemoryOperation(memories, 'DUPLICATE_MEMORY_ID');
    }
    const proposed = [...memories, memory];
    if (!pinnedBudgetAllows(proposed, memories)) return failedMemoryOperation(memories, 'PINNED_BUDGET_EXCEEDED');
    return { ok: true, memories: proposed };
  }

  function updateMemory(memories, id, patch, now) {
    if (!Array.isArray(memories)) return failedMemoryOperation(memories, 'INVALID_MEMORY_LIST');
    const index = memories.findIndex(item => item && item.id === id);
    if (index < 0) return failedMemoryOperation(memories, 'MEMORY_NOT_FOUND');
    if (!isRecord(patch)) return failedMemoryOperation(memories, 'INVALID_MEMORY');
    const original = memories[index];
    const updated = normalizeMemory({
      ...original,
      type: Object.prototype.hasOwnProperty.call(patch, 'type') ? patch.type : original.type,
      content: Object.prototype.hasOwnProperty.call(patch, 'content') ? patch.content : original.content,
      status: Object.prototype.hasOwnProperty.call(patch, 'status') ? patch.status : original.status,
      pinned: Object.prototype.hasOwnProperty.call(patch, 'pinned') ? patch.pinned : original.pinned,
      id: original.id,
      createdAt: original.createdAt,
      updatedAt: timestamp(now),
    });
    if (!updated) return failedMemoryOperation(memories, 'INVALID_MEMORY');
    const proposed = memories.map((item, itemIndex) => itemIndex === index ? updated : item);
    if (!pinnedBudgetAllows(proposed, memories)) return failedMemoryOperation(memories, 'PINNED_BUDGET_EXCEEDED');
    return { ok: true, memories: proposed };
  }

  function removeMemory(memories, id) {
    if (!Array.isArray(memories)) return failedMemoryOperation(memories, 'INVALID_MEMORY_LIST');
    if (!memories.some(item => item && item.id === id)) return failedMemoryOperation(memories, 'MEMORY_NOT_FOUND');
    return { ok: true, memories: memories.filter(item => item && item.id !== id) };
  }

  function setMemoryStatus(memories, id, status, now) {
    if (!Array.isArray(memories)) return failedMemoryOperation(memories, 'INVALID_MEMORY_LIST');
    const memory = memories.find(item => item && item.id === id);
    if (!memory) return failedMemoryOperation(memories, 'MEMORY_NOT_FOUND');
    if (!memoryStatusIsValid(memory.type, cleanString(status))) {
      return failedMemoryOperation(memories, 'INVALID_MEMORY_STATUS');
    }
    return updateMemory(memories, id, { status }, now);
  }

  function failedSnapshotOperation(snapshot, error) {
    return { ok: false, snapshot, error };
  }

  function candidateSnapshotIsValid(snapshot) {
    return isRecord(snapshot)
      && Array.isArray(snapshot.memories)
      && Array.isArray(snapshot.memoryCandidates)
      && normalizeScene(snapshot.currentScene) !== null;
  }

  function combineSourceMessageIds() {
    const combined = [];
    for (const value of arguments) {
      if (!Array.isArray(value)) continue;
      value.forEach(id => {
        const normalized = cleanString(id);
        if (normalized && !combined.includes(normalized)) combined.push(normalized);
      });
    }
    return combined;
  }

  function createUniqueMergeMemoryId(memories, mergedTargetIds, makeId) {
    const reserved = new Set(memories
      .filter(memory => memory && !mergedTargetIds.has(memory.id))
      .map(memory => cleanString(memory.id))
      .filter(Boolean));
    for (let attempt = 0; attempt < 32; attempt += 1) {
      let generated = '';
      try { generated = cleanString(makeId('memory')); } catch (error) { generated = ''; }
      if (generated && !reserved.has(generated)) return generated;
    }
    return '';
  }

  function prepareCandidate(candidate, editedCandidate) {
    if (editedCandidate === undefined || editedCandidate === null) return normalizeCandidate(candidate);
    if (!isRecord(editedCandidate)) return null;
    const proposed = { ...candidate, ...editedCandidate, id: candidate.id, operation: candidate.operation };
    if (candidate.operation === 'scene_patch'
      && Object.prototype.hasOwnProperty.call(editedCandidate, 'scenePatch')) {
      proposed.scenePatch = editedCandidate.scenePatch;
    }
    return normalizeCandidate(proposed);
  }

  function desiredPinned(candidate, editedCandidate, fallback) {
    if (isRecord(editedCandidate) && Object.prototype.hasOwnProperty.call(editedCandidate, 'pinned')) {
      return editedCandidate.pinned === true;
    }
    if (Object.prototype.hasOwnProperty.call(candidate, 'pinned')) return candidate.pinned === true;
    return fallback === true;
  }

  function confirmCandidate(snapshot, candidateId, editedCandidate, options) {
    if (!candidateSnapshotIsValid(snapshot)) return failedSnapshotOperation(snapshot, 'INVALID_SNAPSHOT');
    const candidateIndex = snapshot.memoryCandidates.findIndex(item => item && item.id === candidateId);
    if (candidateIndex < 0) return failedSnapshotOperation(snapshot, 'CANDIDATE_NOT_FOUND');
    const originalCandidate = snapshot.memoryCandidates[candidateIndex];
    const candidate = prepareCandidate(originalCandidate, editedCandidate);
    if (!candidate) return failedSnapshotOperation(snapshot, 'INVALID_CANDIDATE');

    const config = options || {};
    const at = timestamp(config.now);
    const makeId = typeof config.createId === 'function' ? config.createId : createId;
    let proposedMemories = snapshot.memories;
    let proposedScene = snapshot.currentScene;

    if (candidate.operation === 'scene_patch') {
      proposedScene = applyScenePatch(snapshot.currentScene, candidate.scenePatch, at);
      if (!proposedScene) return failedSnapshotOperation(snapshot, 'INVALID_SCENE_PATCH');
    } else if (candidate.operation === 'add') {
      const memoryInput = {
        id: makeId('memory'),
        type: candidate.memoryType,
        content: candidate.content,
        pinned: desiredPinned(candidate, editedCandidate, false),
        sourceMessageIds: combineSourceMessageIds(candidate.sourceMessageIds),
      };
      if (Object.prototype.hasOwnProperty.call(candidate, 'source')) memoryInput.source = candidate.source;
      const added = addMemory(snapshot.memories, memoryInput, at);
      if (!added.ok) return failedSnapshotOperation(snapshot, added.error);
      proposedMemories = added.memories;
    } else {
      const targets = candidate.targetMemoryIds.map(id => snapshot.memories.find(memory => memory && memory.id === id));
      if (targets.some(target => !target)) return failedSnapshotOperation(snapshot, 'MEMORY_NOT_FOUND');

      if (candidate.operation === 'update') {
        const target = targets[0];
        const replacement = normalizeMemory({
          ...target,
          type: candidate.memoryType,
          content: candidate.content,
          status: memoryStatusIsValid(candidate.memoryType, target.status) ? target.status : 'active',
          pinned: desiredPinned(candidate, editedCandidate, target.pinned),
          sourceMessageIds: combineSourceMessageIds(target.sourceMessageIds, candidate.sourceMessageIds),
          updatedAt: at,
        });
        if (!replacement) return failedSnapshotOperation(snapshot, 'INVALID_MEMORY');
        proposedMemories = snapshot.memories.map(memory => memory.id === target.id ? replacement : memory);
      } else if (candidate.operation === 'merge') {
        if (targets.some(target => target.type !== candidate.memoryType)) {
          return failedSnapshotOperation(snapshot, 'INCOMPATIBLE_MEMORY_TYPE');
        }
        const targetIds = new Set(candidate.targetMemoryIds);
        const replacementId = createUniqueMergeMemoryId(snapshot.memories, targetIds, makeId);
        if (!replacementId) return failedSnapshotOperation(snapshot, 'MEMORY_ID_GENERATION_FAILED');
        const mergeInput = {
          id: replacementId,
          type: candidate.memoryType,
          content: candidate.content,
          pinned: desiredPinned(candidate, editedCandidate, targets.some(target => target.pinned)),
          sourceMessageIds: combineSourceMessageIds(...targets.map(target => target.sourceMessageIds), candidate.sourceMessageIds),
        };
        if (Object.prototype.hasOwnProperty.call(candidate, 'source')) mergeInput.source = candidate.source;
        const replacement = createMemory(mergeInput, at);
        if (!replacement) return failedSnapshotOperation(snapshot, 'INVALID_MEMORY');
        proposedMemories = snapshot.memories.filter(memory => !targetIds.has(memory.id)).concat(replacement);
      } else if (candidate.operation === 'resolve') {
        if (targets.some(target => target.type !== candidate.memoryType
          || !memoryStatusIsValid(target.type, candidate.resultStatus))) {
          return failedSnapshotOperation(snapshot, 'INVALID_MEMORY_STATUS');
        }
        const targetIds = new Set(candidate.targetMemoryIds);
        proposedMemories = snapshot.memories.map(memory => {
          if (!targetIds.has(memory.id)) return memory;
          return normalizeMemory({
            ...memory,
            status: candidate.resultStatus,
            sourceMessageIds: combineSourceMessageIds(memory.sourceMessageIds, candidate.sourceMessageIds),
            updatedAt: at,
          });
        });
      }

      if (!pinnedBudgetAllows(proposedMemories, snapshot.memories)) {
        return failedSnapshotOperation(snapshot, 'PINNED_BUDGET_EXCEEDED');
      }
    }

    return {
      ok: true,
      snapshot: {
        memories: proposedMemories,
        currentScene: proposedScene,
        memoryCandidates: snapshot.memoryCandidates.filter((_, index) => index !== candidateIndex),
      },
    };
  }

  function dismissCandidateBatch(snapshot, candidateIds) {
    if (!candidateSnapshotIsValid(snapshot)) return failedSnapshotOperation(snapshot, 'INVALID_SNAPSHOT');
    const normalizedIds = normalizeIdArray(candidateIds);
    if (normalizedIds === null || !normalizedIds.length) return failedSnapshotOperation(snapshot, 'INVALID_CANDIDATE_IDS');
    const selected = new Set(normalizedIds);
    if (normalizedIds.some(id => !snapshot.memoryCandidates.some(candidate => candidate && candidate.id === id))) {
      return failedSnapshotOperation(snapshot, 'CANDIDATE_NOT_FOUND');
    }
    return {
      ok: true,
      snapshot: {
        memories: snapshot.memories,
        currentScene: snapshot.currentScene,
        memoryCandidates: snapshot.memoryCandidates.filter(candidate => !selected.has(candidate.id)),
      },
    };
  }

  function dismissCandidate(snapshot, candidateId) {
    return dismissCandidateBatch(snapshot, [candidateId]);
  }

  function clearConversationMemoryArtifacts(state) {
    const source = isRecord(state) ? state : {};
    return {
      ...source,
      messages: [],
      summary: '',
      memoryCandidates: [],
      memoryAnalysis: { analyzedTurnKeys: [], lastFailure: null, activeCharacter: null },
      memoryRequestTraces: {},
    };
  }

  function removeArtifactsAfterMessageIds(state, retainedMessageIds) {
    const source = isRecord(state) ? state : {};
    const retained = new Set(Array.isArray(retainedMessageIds)
      ? retainedMessageIds.map(cleanString).filter(Boolean)
      : []);
    const candidates = Array.isArray(source.memoryCandidates) ? source.memoryCandidates : [];
    const analysis = isRecord(source.memoryAnalysis) ? source.memoryAnalysis : {};
    const analyzedTurnKeys = Array.isArray(analysis.analyzedTurnKeys)
      ? analysis.analyzedTurnKeys.filter(key => {
        if (typeof key !== 'string') return true;
        const separator = key.includes('::') ? '::' : (key.includes('|') ? '|' : '');
        if (!separator) return true;
        const messageIds = key.split(separator).map(cleanString).filter(Boolean);
        return messageIds.length > 0 && messageIds.every(id => retained.has(id));
      })
      : [];
    const traces = isRecord(source.memoryRequestTraces) ? source.memoryRequestTraces : {};
    const retainedTraces = {};
    Object.keys(traces).forEach(messageId => {
      if (retained.has(messageId)) retainedTraces[messageId] = traces[messageId];
    });

    return {
      ...source,
      memoryCandidates: candidates.filter(candidate => {
        const sourceIds = candidate && Array.isArray(candidate.sourceMessageIds)
          ? candidate.sourceMessageIds.map(cleanString).filter(Boolean)
          : [];
        return sourceIds.length === 0 || sourceIds.some(id => retained.has(id));
      }),
      memoryAnalysis: { ...analysis, analyzedTurnKeys },
      memoryRequestTraces: retainedTraces,
    };
  }

  global.FonlingMemory = global.FonlingMemory || {};
  global.FonlingMemory.Model = {
    MEMORY_SCHEMA_VERSION,
    PINNED_MEMORY_CHAR_BUDGET,
    EMPTY_SCENE,
    createId,
    ensureMessageIds,
    createMemory,
    createCandidate,
    normalizeScene,
    normalizeMemory,
    normalizeCandidate,
    applyScenePatch,
    addMemory,
    updateMemory,
    removeMemory,
    setMemoryStatus,
    getPinnedCharacterCount,
    confirmCandidate,
    dismissCandidate,
    dismissCandidateBatch,
    clearConversationMemoryArtifacts,
    removeArtifactsAfterMessageIds,
  };
})(globalThis);
