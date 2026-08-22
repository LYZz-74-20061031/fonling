(function (global) {
  'use strict';

  const PINNED_MEMORY_CHAR_BUDGET = 4000;
  const MEMORY_CONTEXT_CHAR_BUDGET = 8000;
  const MEMORY_TYPES = new Set(['history_event', 'key_info']);

  function cleanString(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function createBudgetError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  function tokenize(value) {
    const text = cleanString(value);
    const tokens = new Set();
    const chineseRuns = text.match(/[\u3400-\u9fff]+/g) || [];
    chineseRuns.forEach(run => {
      if (run.length === 1) tokens.add(run);
      for (let index = 0; index < run.length - 1; index += 1) {
        tokens.add(run.slice(index, index + 2));
      }
    });
    const asciiWords = text.toLowerCase().match(/[a-z0-9_]+/g) || [];
    asciiWords.forEach(word => tokens.add(word));
    return tokens;
  }

  function countHits(memoryTokens, textTokens) {
    let hits = 0;
    memoryTokens.forEach(token => {
      if (textTokens.has(token)) hits += 1;
    });
    return hits;
  }

  function sceneValues(scene) {
    if (!scene || typeof scene !== 'object' || Array.isArray(scene)) return [];
    return [
      scene.time,
      scene.location,
      Array.isArray(scene.presentCharacters) ? scene.presentCharacters.join(' ') : '',
      scene.currentGoal,
      scene.currentConflict,
      scene.characterStates,
      scene.environment,
      scene.notes,
    ].map(cleanString).filter(Boolean);
  }

  function formatScene(scene) {
    if (!scene || typeof scene !== 'object' || Array.isArray(scene)) return '';
    const fields = [
      ['时间', scene.time],
      ['地点', scene.location],
      ['在场角色', Array.isArray(scene.presentCharacters) ? scene.presentCharacters.map(cleanString).filter(Boolean).join('、') : ''],
      ['当前目标', scene.currentGoal],
      ['当前冲突', scene.currentConflict],
      ['角色状态', scene.characterStates],
      ['环境', scene.environment],
      ['备注', scene.notes],
    ];
    return fields
      .map(([label, value]) => [label, cleanString(value)])
      .filter(([, value]) => value)
      .map(([label, value]) => `${label}：${value}`)
      .join('\n');
  }

  function formatMemory(memory) {
    const content = memory && cleanString(memory.content);
    return content ? `- ${content}` : '';
  }

  function validMemory(memory) {
    if (!memory || typeof memory !== 'object' || Array.isArray(memory)) return false;
    if (!cleanString(memory.id) || !MEMORY_TYPES.has(cleanString(memory.type)) || !cleanString(memory.content)) return false;
    const status = cleanString(memory.status) || 'active';
    if (memory.type === 'history_event') return status === 'active' || status === 'archived';
    return status === 'active' || status === 'resolved' || status === 'invalidated';
  }

  function compareUpdatedAndId(left, right) {
    const leftUpdated = cleanString(left.updatedAt);
    const rightUpdated = cleanString(right.updatedAt);
    if (leftUpdated !== rightUpdated) return leftUpdated > rightUpdated ? -1 : 1;
    const leftId = cleanString(left.id);
    const rightId = cleanString(right.id);
    if (leftId === rightId) return 0;
    return leftId < rightId ? -1 : 1;
  }

  function makeMessages(sceneText, pinned, related) {
    const messages = [];
    if (sceneText) messages.push({ role: 'system', content: `当前场景：\n${sceneText}` });

    const pinnedText = pinned.map(formatMemory).filter(Boolean).join('\n');
    if (pinnedText) messages.push({ role: 'system', content: `固定记忆：\n${pinnedText}` });

    const relatedKeyInfo = related.filter(memory => memory.type === 'key_info');
    const keyText = relatedKeyInfo.map(formatMemory).filter(Boolean).join('\n');
    if (keyText) messages.push({ role: 'system', content: `相关关键信息：\n${keyText}` });

    const relatedHistory = related.filter(memory => memory.type === 'history_event');
    const historyText = relatedHistory.map(formatMemory).filter(Boolean).join('\n');
    if (historyText) messages.push({ role: 'system', content: `相关及近期历史事件：\n${historyText}` });
    return messages;
  }

  function messageCharacters(messages) {
    return messages.reduce((total, message) => total + message.content.length, 0);
  }

  function selectMemoriesForContext(input) {
    const source = input && typeof input === 'object' ? input : {};
    const memories = Array.isArray(source.memories) ? source.memories.filter(validMemory) : [];
    const userTokens = tokenize(source.userText);
    const sceneText = formatScene(source.currentScene);
    const sceneTokens = tokenize(sceneValues(source.currentScene).join(' '));
    const recentText = Array.isArray(source.recentMessages)
      ? source.recentMessages.map(message => message && message.content).map(cleanString).filter(Boolean).join(' ')
      : '';
    const recentTokens = tokenize(recentText);

    const pinned = memories.filter(memory => {
      if (memory.pinned !== true) return false;
      if (memory.type === 'key_info') return memory.status === 'active';
      return memory.type === 'history_event';
    }).sort(compareUpdatedAndId);
    const eligibleOrdinary = memories.filter(memory => {
      if (memory.pinned === true) return false;
      if (memory.type === 'key_info') return memory.status === 'active';
      if (memory.status === 'active') return true;
      return memory.status === 'archived' && countHits(tokenize(memory.content), userTokens) > 0;
    });
    const pinnedCharacters = pinned.reduce((total, memory) => total + cleanString(memory.content).length, 0);
    if (pinnedCharacters > PINNED_MEMORY_CHAR_BUDGET) {
      throw createBudgetError('PINNED_BUDGET_EXCEEDED', 'Pinned memories exceed the 4000 character budget.');
    }

    const ordinary = eligibleOrdinary;
    const activeOrdinaryByDate = ordinary
      .filter(memory => memory.status === 'active')
      .slice()
      .sort(compareUpdatedAndId);
    const newestCount = activeOrdinaryByDate.length ? Math.max(1, Math.ceil(activeOrdinaryByDate.length * 0.2)) : 0;
    const newestIds = new Set(activeOrdinaryByDate.slice(0, newestCount).map(memory => memory.id));
    const recentHistoryIds = new Set(activeOrdinaryByDate
      .filter(memory => memory.type === 'history_event')
      .slice(0, 5)
      .map(memory => memory.id));

    const ranked = ordinary.map(memory => {
      const memoryTokens = tokenize(memory.content);
      const score = countHits(memoryTokens, userTokens) * 8
        + countHits(memoryTokens, sceneTokens) * 5
        + countHits(memoryTokens, recentTokens) * 3
        + (newestIds.has(memory.id) ? 2 : 0)
        + (recentHistoryIds.has(memory.id) ? 1 : 0);
      return { memory, score };
    }).filter(item => item.score > 0)
      .sort((left, right) => right.score - left.score || compareUpdatedAndId(left.memory, right.memory));

    let requiredMessages = makeMessages(sceneText, pinned, []);
    let usedCharacters = messageCharacters(requiredMessages);
    if (usedCharacters > MEMORY_CONTEXT_CHAR_BUDGET) {
      throw createBudgetError('MEMORY_CONTEXT_BUDGET_EXCEEDED', 'Required scene and pinned memories exceed the context budget.');
    }

    const related = [];
    ranked.forEach(item => {
      const proposed = related.concat(item.memory);
      const proposedMessages = makeMessages(sceneText, pinned, proposed);
      const proposedCharacters = messageCharacters(proposedMessages);
      if (proposedCharacters <= MEMORY_CONTEXT_CHAR_BUDGET) {
        related.push(item.memory);
        requiredMessages = proposedMessages;
        usedCharacters = proposedCharacters;
      }
    });

    const currentScene = source.currentScene && typeof source.currentScene === 'object' ? source.currentScene : {};
    return {
      pinned,
      related,
      sceneText,
      usedCharacters,
      trace: {
        pinnedMemoryIds: pinned.map(memory => memory.id),
        relatedMemoryIds: related.map(memory => memory.id),
        sceneUpdatedAt: cleanString(currentScene.updatedAt),
        usedSummary: false,
      },
    };
  }

  function buildMemoryContextMessages(input) {
    const selected = selectMemoriesForContext(input);
    const messages = makeMessages(selected.sceneText, selected.pinned, selected.related);
    return { ...selected, messages, usedCharacters: messageCharacters(messages) };
  }

  global.FonlingMemory = global.FonlingMemory || {};
  global.FonlingMemory.Context = {
    PINNED_MEMORY_CHAR_BUDGET,
    MEMORY_CONTEXT_CHAR_BUDGET,
    selectMemoriesForContext,
    formatScene,
    formatMemory,
    buildMemoryContextMessages,
  };
})(typeof window !== 'undefined' ? window : globalThis);
