(function (global) {
  'use strict';
  const Model = global.FonlingMemory && global.FonlingMemory.Model;
  if (!Model) throw new Error('FonlingMemory.Model must be loaded before FonlingMemory.Controller');
  const DefaultAnalyzer = global.FonlingMemory && global.FonlingMemory.Analyzer;

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function createMemoryController(options) {
    const opts = options || {};
    const getState = opts.getState;
    const save = opts.save;
    const getCharacterName = opts.getCharacterName || function () { return ''; };
    const ui = opts.ui;
    const now = typeof opts.now === 'function' ? opts.now : function () { return new Date().toISOString(); };
    const analyzer = opts.analyzer || DefaultAnalyzer;
    const loadCharacterSnapshot = opts.loadCharacterSnapshot;
    const saveCharacterSnapshot = opts.saveCharacterSnapshot;
    const getAnalysisConfig = typeof opts.getAnalysisConfig === 'function'
      ? opts.getAnalysisConfig
      : function () { return {}; };
    const analysisQueues = new Map();
    const analysisEpochs = new Map();

    function getAnalysisEpoch(characterName) {
      return analysisEpochs.get(characterName) || 0;
    }

    function analysisEpochIsCurrent(characterName, expectedEpoch) {
      return getAnalysisEpoch(characterName) === expectedEpoch;
    }

    function invalidateAnalysis(characterName) {
      const name = typeof characterName === 'string' && characterName.trim()
        ? characterName.trim()
        : getCharacterName();
      if (!name) return 0;
      const next = getAnalysisEpoch(name) + 1;
      analysisEpochs.set(name, next);
      return next;
    }

    function snapshot() {
      const state = getState();
      return {
        characterName: getCharacterName(),
        snapshotIdentity: state.memorySnapshotIdentity || '',
        memories: clone(state.memories || []),
        currentScene: clone(state.currentScene || Model.EMPTY_SCENE),
        memoryCandidates: clone(state.memoryCandidates || []),
        memoryAnalysis: clone(state.memoryAnalysis || {}),
      };
    }
    function sync() { const next = snapshot(); ui.render(next); return next; }
    function storageWarning(saved, restoredMessage) {
      if (saved && saved.quotaExceeded === true) {
        return { quotaExceeded: true, message: '存储空间不足，请立即导出备份' };
      }
      return saved && saved.rolledBack === false
        ? '保存失败，本地存储可能不完整，请立即导出备份。'
        : restoredMessage;
    }
    function persist(field, proposed, previous) {
      const state = getState();
      state[field] = proposed;
      let result;
      try { result = save(); } catch (error) { result = { ok: false, rolledBack: false }; }
      if (!result || result.ok !== true) {
        state[field] = previous;
        ui.showStorageWarning(storageWarning(result, '保存失败，原数据已恢复。'));
        sync();
        return { ok: false, error: 'STORAGE_SAVE_FAILED', rolledBack: !result || result.rolledBack !== false };
      }
      sync();
      return { ok: true };
    }
    function commitMemory(operation) {
      const state = getState();
      const previous = state.memories;
      const result = operation(previous);
      if (!result.ok) {
        ui.showStorageWarning(result.error === 'PINNED_BUDGET_EXCEEDED'
          ? '常驻记忆超过4000字，请精简'
          : '记忆内容无效，未保存');
        sync();
        return result;
      }
      const saved = persist('memories', result.memories, previous);
      return saved.ok ? result : saved;
    }
    function addMemory(input) { return commitMemory(memories => Model.addMemory(memories, input, now())); }
    function updateMemory(id, patch) { return commitMemory(memories => Model.updateMemory(memories, id, patch, now())); }
    function deleteMemory(id) { return commitMemory(memories => Model.removeMemory(memories, id)); }
    function setMemoryStatus(id, status) { return commitMemory(memories => Model.setMemoryStatus(memories, id, status, now())); }
    function togglePinned(id) {
      const memory = (getState().memories || []).find(item => item.id === id);
      if (!memory) return { ok: false, memories: getState().memories, error: 'MEMORY_NOT_FOUND' };
      return updateMemory(id, { pinned: !memory.pinned });
    }
    function patchScene(patch) {
      const state = getState();
      const previous = state.currentScene;
      const proposed = Model.applyScenePatch(previous, patch, now());
      if (!proposed) return { ok: false, error: 'INVALID_SCENE_PATCH' };
      return persist('currentScene', proposed, previous);
    }
    function clearScene() {
      const state = getState();
      return persist('currentScene', clone(Model.EMPTY_SCENE), state.currentScene);
    }
    function decisionSnapshot(state) {
      return {
        memories: state.memories || [],
        currentScene: state.currentScene || Model.EMPTY_SCENE,
        memoryCandidates: state.memoryCandidates || [],
      };
    }
    function actionIsStale(expectedContext) {
      if (!expectedContext) return false;
      const state = getState();
      const currentIdentity = state.memorySnapshotIdentity || '';
      return expectedContext.characterName !== getCharacterName()
        || expectedContext.snapshotIdentity !== currentIdentity;
    }
    function rejectStaleAction() {
      sync();
      return { ok: false, error: 'STALE_CHARACTER' };
    }
    function commitCandidateDecision(operation) {
      const state = getState();
      const previous = decisionSnapshot(state);
      const result = operation(previous);
      if (!result.ok) {
        ui.showStorageWarning(result.error === 'PINNED_BUDGET_EXCEEDED'
          ? '常驻记忆超过4000字，请精简'
          : '候选记忆无效，未保存');
        sync();
        return result;
      }

      state.memories = result.snapshot.memories;
      state.currentScene = result.snapshot.currentScene;
      state.memoryCandidates = result.snapshot.memoryCandidates;
      let saved;
      try { saved = save(); } catch (error) { saved = { ok: false, rolledBack: false }; }
      if (!saved || saved.ok !== true) {
        state.memories = previous.memories;
        state.currentScene = previous.currentScene;
        state.memoryCandidates = previous.memoryCandidates;
        ui.showStorageWarning(storageWarning(saved, '保存失败，候选记忆已保留。'));
        sync();
        return { ok: false, error: 'STORAGE_SAVE_FAILED', rolledBack: !saved || saved.rolledBack !== false };
      }
      sync();
      return result;
    }
    function confirmCandidate(id, edited, expectedContext) {
      if (actionIsStale(expectedContext)) return rejectStaleAction();
      return commitCandidateDecision(previous => Model.confirmCandidate(previous, id, edited, { now: now() }));
    }
    function dismissCandidate(id, expectedContext) {
      if (actionIsStale(expectedContext)) return rejectStaleAction();
      return commitCandidateDecision(previous => Model.dismissCandidate(previous, id));
    }
    function dismissAllCandidates(candidateIds, expectedContext) {
      if (actionIsStale(expectedContext)) return rejectStaleAction();
      const ids = Array.isArray(candidateIds)
        ? candidateIds.slice()
        : (getState().memoryCandidates || []).map(candidate => candidate.id);
      if (!ids.length) return { ok: true, snapshot: decisionSnapshot(getState()) };
      return commitCandidateDecision(previous => Model.dismissCandidateBatch(previous, ids));
    }

    function getTurnKey(userMessageId, assistantMessageId) {
      const userId = typeof userMessageId === 'string' ? userMessageId.trim() : '';
      const assistantId = typeof assistantMessageId === 'string' ? assistantMessageId.trim() : '';
      return userId && assistantId ? `${userId}::${assistantId}` : '';
    }

    function loadAnalysisSnapshot(characterName) {
      if (typeof loadCharacterSnapshot === 'function') {
        try {
          const loaded = loadCharacterSnapshot(characterName);
          return loaded && typeof loaded === 'object' ? clone(loaded) : null;
        } catch (_) { return null; }
      }
      if (getCharacterName() !== characterName) return null;
      try { return clone(getState()); } catch (_) { return null; }
    }

    function saveAnalysisSnapshot(characterName, value) {
      if (typeof saveCharacterSnapshot !== 'function') return { ok: false, rolledBack: true };
      try {
        const result = saveCharacterSnapshot(characterName, clone(value));
        if (result === true) return { ok: true, rolledBack: true };
        return result && typeof result === 'object' ? result : { ok: false, rolledBack: true };
      } catch (_) {
        return { ok: false, rolledBack: false };
      }
    }

    function normalizedAnalysis(value) {
      const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
      return {
        analyzedTurnKeys: Array.isArray(source.analyzedTurnKeys)
          ? source.analyzedTurnKeys.filter(key => typeof key === 'string' && key.trim()).map(key => key.trim())
          : [],
        lastFailure: source.lastFailure === undefined ? null : clone(source.lastFailure),
        activeCharacter: source.activeCharacter === undefined ? null : source.activeCharacter,
      };
    }

    function renderAnalysisSnapshot(characterName, value) {
      if (getCharacterName() !== characterName || !ui || typeof ui.render !== 'function') return;
      ui.render({
        characterName,
        snapshotIdentity: value.memorySnapshotIdentity || '',
        memories: clone(value.memories || []),
        currentScene: clone(value.currentScene || Model.EMPTY_SCENE),
        memoryCandidates: clone(value.memoryCandidates || []),
        memoryAnalysis: clone(value.memoryAnalysis || {}),
      });
    }

    function showAnalysisFailure(characterName, message) {
      if (getCharacterName() !== characterName || !ui || typeof ui.showAnalysisFailure !== 'function') return;
      ui.showAnalysisFailure(message);
    }

    function findCompletedTurn(value, userMessageId, assistantMessageId) {
      const messages = value && Array.isArray(value.messages) ? value.messages : [];
      const userIndex = messages.findIndex(message => message && message.id === userMessageId && message.role === 'user');
      const assistantIndex = messages.findIndex(message => message && message.id === assistantMessageId && message.role === 'assistant');
      if (userIndex < 0 || assistantIndex <= userIndex) return null;
      const userMessage = messages[userIndex];
      const assistantMessage = messages[assistantIndex];
      if (typeof userMessage.content !== 'string' || typeof assistantMessage.content !== 'string' || !assistantMessage.content.trim()) return null;
      return { messages, userMessage, assistantMessage, userIndex, assistantIndex };
    }

    function validateAnalysisCandidates(candidates, value) {
      if (!Array.isArray(candidates)) return null;
      const messages = Array.isArray(value.messages) ? value.messages : [];
      const messageIds = new Set(messages.map(message => message && message.id).filter(Boolean));
      const memories = Array.isArray(value.memories) ? value.memories : [];
      const memoryById = new Map(memories.map(memory => [memory && memory.id, memory]));
      const normalized = [];
      for (const rawCandidate of candidates) {
        const candidate = Model.normalizeCandidate(rawCandidate);
        if (!candidate) return null;
        if (!Array.isArray(candidate.sourceMessageIds) || !candidate.sourceMessageIds.length) return null;
        if (candidate.sourceMessageIds.some(id => !messageIds.has(id))) return null;
        if (candidate.operation === 'update' || candidate.operation === 'merge' || candidate.operation === 'resolve') {
          const targets = candidate.targetMemoryIds.map(id => memoryById.get(id));
          if (targets.some(target => !target || target.type !== candidate.memoryType)) return null;
        }
        normalized.push(candidate);
      }
      return normalized.slice(0, 3);
    }

    function persistAnalysisFailure(characterName, turnKey, error, expectedEpoch) {
      if (!analysisEpochIsCurrent(characterName, expectedEpoch)) {
        return { ok: true, skipped: 'STALE_ANALYSIS_EPOCH' };
      }
      const latest = loadAnalysisSnapshot(characterName);
      if (!latest) return { ok: false, error: 'CHARACTER_SNAPSHOT_UNAVAILABLE' };
      const analysis = normalizedAnalysis(latest.memoryAnalysis);
      analysis.lastFailure = {
        time: now(),
        turnKey,
        message: '记忆整理失败，可稍后手动重试。',
      };
      analysis.activeCharacter = null;
      latest.memoryAnalysis = analysis;
      if (!analysisEpochIsCurrent(characterName, expectedEpoch)) {
        return { ok: true, skipped: 'STALE_ANALYSIS_EPOCH' };
      }
      const saved = saveAnalysisSnapshot(characterName, latest);
      if (!saved || saved.ok !== true) {
        if (getCharacterName() === characterName && ui && typeof ui.showStorageWarning === 'function') {
          ui.showStorageWarning(storageWarning(saved, '记忆整理状态保存失败，请及时导出备份。'));
        }
        return { ok: false, error: 'ANALYSIS_FAILURE_SAVE_FAILED' };
      }
      renderAnalysisSnapshot(characterName, latest);
      showAnalysisFailure(characterName, analysis.lastFailure.message);
      return { ok: false, error: typeof error === 'string' && error ? error : 'ANALYSIS_FAILED' };
    }

    async function runAnalysis(characterName, request) {
      if (!analysisEpochIsCurrent(characterName, request.analysisEpoch)) {
        return { ok: true, skipped: 'STALE_ANALYSIS_EPOCH' };
      }
      const initial = loadAnalysisSnapshot(characterName);
      if (!initial) return { ok: false, error: 'CHARACTER_SNAPSHOT_UNAVAILABLE' };
      const turnKey = getTurnKey(request.userMessageId, request.assistantMessageId);
      const turn = findCompletedTurn(initial, request.userMessageId, request.assistantMessageId);
      if (!turnKey || !turn) return { ok: false, error: 'TURN_NOT_FOUND' };
      const analysis = normalizedAnalysis(initial.memoryAnalysis);
      if (analysis.analyzedTurnKeys.includes(turnKey)) return { ok: true, skipped: 'ALREADY_ANALYZED' };
      if (!request.force) {
        if (!analyzer || typeof analyzer.shouldAnalyzeTurn !== 'function' || !analyzer.shouldAnalyzeTurn({
          turnKey,
          userText: turn.userMessage.content,
          assistantText: turn.assistantMessage.content,
          analyzedTurnKeys: analysis.analyzedTurnKeys,
        })) return { ok: true, skipped: 'TRIGGER_NOT_MET' };
      }
      if (!analyzer || typeof analyzer.analyzeTurn !== 'function') {
        return persistAnalysisFailure(characterName, turnKey, 'ANALYZER_UNAVAILABLE', request.analysisEpoch);
      }

      const captured = clone(initial);
      const config = getAnalysisConfig(captured) || {};
      const recentMessages = turn.messages.slice(Math.max(0, turn.assistantIndex - 13), turn.assistantIndex + 1);
      let result;
      try {
        result = await analyzer.analyzeTurn(Object.assign({}, config, {
          recentMessages,
          summary: captured.summary || '',
          currentScene: captured.currentScene || Model.EMPTY_SCENE,
          memories: captured.memories || [],
          pendingCandidates: captured.memoryCandidates || [],
          validSourceMessageIds: recentMessages.map(message => message && message.id).filter(Boolean),
        }));
      } catch (_) {
        result = { ok: false, error: 'ANALYSIS_REQUEST_FAILED' };
      }
      if (!analysisEpochIsCurrent(characterName, request.analysisEpoch)) {
        return { ok: true, skipped: 'STALE_ANALYSIS_EPOCH' };
      }
      if (!result || result.ok !== true) {
        return persistAnalysisFailure(characterName, turnKey, result && result.error, request.analysisEpoch);
      }

      const latest = loadAnalysisSnapshot(characterName);
      if (!latest || !findCompletedTurn(latest, request.userMessageId, request.assistantMessageId)) {
        return { ok: true, skipped: 'TURN_REMOVED' };
      }
      const latestAnalysis = normalizedAnalysis(latest.memoryAnalysis);
      if (latestAnalysis.analyzedTurnKeys.includes(turnKey)) return { ok: true, skipped: 'ALREADY_ANALYZED' };
      const normalizedCandidates = validateAnalysisCandidates(result.candidates, latest);
      if (normalizedCandidates === null) return persistAnalysisFailure(characterName, turnKey, 'INVALID_ANALYSIS_RESULT', request.analysisEpoch);
      const deduplicate = analyzer && typeof analyzer.deduplicateCandidates === 'function'
        ? analyzer.deduplicateCandidates
        : DefaultAnalyzer && DefaultAnalyzer.deduplicateCandidates;
      const deduplicated = typeof deduplicate === 'function'
        ? deduplicate({ candidates: normalizedCandidates, memories: latest.memories || [], pendingCandidates: latest.memoryCandidates || [] })
        : normalizedCandidates;
      const finalCandidates = validateAnalysisCandidates(deduplicated, latest);
      if (finalCandidates === null) return persistAnalysisFailure(characterName, turnKey, 'INVALID_ANALYSIS_RESULT', request.analysisEpoch);
      const existingIds = new Set((latest.memoryCandidates || []).map(candidate => candidate && candidate.id).filter(Boolean));
      finalCandidates.forEach(candidate => {
        if (existingIds.has(candidate.id)) candidate.id = Model.createId('candidate');
        existingIds.add(candidate.id);
      });
      latest.memoryCandidates = (Array.isArray(latest.memoryCandidates) ? latest.memoryCandidates : []).concat(finalCandidates);
      latestAnalysis.analyzedTurnKeys = latestAnalysis.analyzedTurnKeys.concat(turnKey).slice(-500);
      latestAnalysis.lastFailure = null;
      latestAnalysis.activeCharacter = null;
      latest.memoryAnalysis = latestAnalysis;
      if (!analysisEpochIsCurrent(characterName, request.analysisEpoch)) {
        return { ok: true, skipped: 'STALE_ANALYSIS_EPOCH' };
      }
      const saved = saveAnalysisSnapshot(characterName, latest);
      if (!saved || saved.ok !== true) {
        if (getCharacterName() === characterName && ui && typeof ui.showStorageWarning === 'function') {
          ui.showStorageWarning(storageWarning(saved, '记忆整理结果保存失败，候选未写入。'));
        }
        return { ok: false, error: 'ANALYSIS_SAVE_FAILED' };
      }
      renderAnalysisSnapshot(characterName, latest);
      return { ok: true, candidates: finalCandidates };
    }

    function enqueueAnalysis(characterName, task) {
      const previous = analysisQueues.get(characterName) || Promise.resolve();
      const next = previous.catch(function () {}).then(task).catch(function () {
        return { ok: false, error: 'ANALYSIS_FAILED' };
      });
      analysisQueues.set(characterName, next);
      next.then(function () {
        if (analysisQueues.get(characterName) === next) analysisQueues.delete(characterName);
      });
      return next;
    }

    function considerTurn(turn) {
      const request = turn && typeof turn === 'object' ? clone(turn) : {};
      const characterName = typeof request.characterName === 'string' && request.characterName.trim()
        ? request.characterName.trim()
        : getCharacterName();
      if (!characterName) return Promise.resolve({ ok: false, error: 'CHARACTER_REQUIRED' });
      request.analysisEpoch = getAnalysisEpoch(characterName);
      return enqueueAnalysis(characterName, async function () {
        try { return await runAnalysis(characterName, request); }
        catch (_) {
          if (!analysisEpochIsCurrent(characterName, request.analysisEpoch)) {
            return { ok: true, skipped: 'STALE_ANALYSIS_EPOCH' };
          }
          return persistAnalysisFailure(
            characterName,
            getTurnKey(request.userMessageId, request.assistantMessageId),
            'ANALYSIS_FAILED',
            request.analysisEpoch
          );
        }
      });
    }

    function analyzeRecent(options) {
      const config = options && typeof options === 'object' ? options : {};
      const characterName = getCharacterName();
      const value = loadAnalysisSnapshot(characterName);
      const messages = value && Array.isArray(value.messages) ? value.messages : [];
      let assistantIndex = -1;
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (messages[index] && messages[index].role === 'assistant' && typeof messages[index].content === 'string' && messages[index].content.trim()) {
          assistantIndex = index;
          break;
        }
      }
      let userIndex = -1;
      for (let index = assistantIndex - 1; index >= 0; index -= 1) {
        if (messages[index] && messages[index].role === 'user') { userIndex = index; break; }
      }
      if (assistantIndex < 0 || userIndex < 0) return Promise.resolve({ ok: false, error: 'TURN_NOT_FOUND' });
      return considerTurn({
        characterName,
        userMessageId: messages[userIndex].id,
        assistantMessageId: messages[assistantIndex].id,
        force: config.force === true,
      });
    }
    return {
      sync, addMemory, updateMemory, deleteMemory, setMemoryStatus, togglePinned, patchScene, clearScene,
      confirmCandidate, dismissCandidate, dismissAllCandidates,
      getTurnKey, considerTurn, analyzeRecent, invalidateAnalysis,
    };
  }

  global.FonlingMemory.Controller = { createMemoryController };
})(globalThis);
