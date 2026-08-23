(function (global) {
  'use strict';

  const CHAPTER_SCHEMA_VERSION = 1;
  const CHAPTER_STATUSES = Object.freeze(['active', 'ended']);
  const DRAFT_STATUSES = Object.freeze(['none', 'generating', 'ready', 'failed']);
  let sequence = 0;

  function clean(value) { return typeof value === 'string' ? value.trim() : ''; }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function fail(code, message) { const error = new Error(message || code); error.code = code; throw error; }
  function createId(prefix) {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') return `${prefix || 'chapter'}_${global.crypto.randomUUID()}`;
    sequence += 1;
    return `${prefix || 'chapter'}_${Date.now()}_${sequence}`;
  }
  function emptySummary() {
    return { confirmedText: '', confirmedAt: '', draftStatus: 'none', draftText: '', generatedAt: '', lastFailure: null, sourceSceneText: '' };
  }
  function createEmptyState() { return { chapterSchemaVersion: CHAPTER_SCHEMA_VERSION, chapters: [], activeChapterId: null }; }
  function normalizeSummary(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const status = DRAFT_STATUSES.includes(source.draftStatus) ? source.draftStatus : 'none';
    const summary = {
      confirmedText: clean(source.confirmedText),
      confirmedAt: clean(source.confirmedAt),
      draftStatus: status,
      draftText: status === 'ready' ? clean(source.draftText) : '',
      generatedAt: clean(source.generatedAt),
      lastFailure: status === 'failed' && source.lastFailure != null ? clone(source.lastFailure) : null,
      sourceSceneText: clean(source.sourceSceneText),
    };
    if (status === 'ready' && (!summary.draftText || !summary.generatedAt)) fail('INVALID_SUMMARY_STATE', '待确认摘要缺少正文或生成时间');
    if (status === 'failed' && (!summary.lastFailure || typeof summary.lastFailure !== 'object' || Array.isArray(summary.lastFailure))) fail('INVALID_SUMMARY_STATE', '失败摘要缺少错误信息');
    if (summary.confirmedText && !summary.confirmedAt) fail('INVALID_SUMMARY_STATE', '已确认摘要缺少确认时间');
    return summary;
  }
  function normalizeMessage(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_CHAPTER_MESSAGE', '章节消息格式无效');
    const message = { id: clean(value.id), role: value.role, speakerName: clean(value.speakerName), content: clean(value.content) };
    if (!message.id || !['user', 'assistant'].includes(message.role) || !message.content) fail('INVALID_CHAPTER_MESSAGE', '章节消息缺少必要内容');
    return message;
  }
  function hasCompleteTurns(messages) {
    if (!Array.isArray(messages) || messages.length < 2 || messages.length % 2) return false;
    return messages.every((message, index) => message && message.role === (index % 2 ? 'assistant' : 'user'));
  }
  function normalizeState(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    if (Number(source.chapterSchemaVersion) > CHAPTER_SCHEMA_VERSION) fail('UNSUPPORTED_CHAPTER_SCHEMA', '不支持更高版本的章节数据');
    const chapterIds = new Set(); const messageIds = new Set();
    const chapters = (Array.isArray(source.chapters) ? source.chapters : []).map(value => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_CHAPTER', '章节格式无效');
      const id = clean(value.id); const name = clean(value.name); const status = value.status;
      if (!id) fail('CHAPTER_ID_REQUIRED');
      if (chapterIds.has(id)) fail('DUPLICATE_CHAPTER_ID');
      if (!name) fail('CHAPTER_NAME_REQUIRED');
      if (!CHAPTER_STATUSES.includes(status)) fail('INVALID_CHAPTER_STATUS');
      chapterIds.add(id);
      const messages = (Array.isArray(value.messages) ? value.messages : []).map(normalizeMessage);
      messages.forEach(message => { if (messageIds.has(message.id)) fail('DUPLICATE_MESSAGE_ID'); messageIds.add(message.id); });
      const endedAt = clean(value.endedAt);
      if (status === 'ended' && (!endedAt || !hasCompleteTurns(messages))) fail('INVALID_ENDED_CHAPTER');
      if (status === 'active' && endedAt) fail('INVALID_ACTIVE_CHAPTER');
      const summary = normalizeSummary(value.summary);
      if (status === 'active' && (summary.confirmedText || summary.confirmedAt || summary.draftStatus !== 'none' || summary.draftText || summary.generatedAt || summary.lastFailure || summary.sourceSceneText)) fail('INVALID_SUMMARY_STATE', '活动章节不能包含最终摘要状态');
      if (status === 'ended' && !summary.confirmedText && summary.draftStatus === 'none') fail('INVALID_SUMMARY_STATE', '已结束章节必须有确认摘要或待处理摘要');
      return {
        id, name, status,
        revision: Number.isInteger(value.revision) && value.revision > 0 ? value.revision : 1,
        startedAt: clean(value.startedAt), endedAt: status === 'ended' ? endedAt : '', messages,
        rollingSummary: clean(value.rollingSummary),
        rollingSummaryThroughMessageId: clean(value.rollingSummaryThroughMessageId),
        summary,
      };
    });
    const active = chapters.filter(chapter => chapter.status === 'active');
    if (active.length > 1) fail('MULTIPLE_ACTIVE_CHAPTERS');
    const activeChapterId = clean(source.activeChapterId) || null;
    if ((activeChapterId && (active.length !== 1 || active[0].id !== activeChapterId)) || (!activeChapterId && active.length)) fail('INVALID_ACTIVE_CHAPTER');
    return { chapterSchemaVersion: CHAPTER_SCHEMA_VERSION, chapters, activeChapterId };
  }
  function nextDefaultName(value) {
    const chapters = value && Array.isArray(value.chapters) ? value.chapters : [];
    return `第 ${chapters.filter(chapter => chapter && CHAPTER_STATUSES.includes(chapter.status)).length + 1} 章`;
  }
  function getActiveChapter(state) { return state.activeChapterId ? state.chapters.find(chapter => chapter.id === state.activeChapterId) || null : null; }
  function updateChapter(state, id, updater) {
    let found = false;
    const chapters = state.chapters.map(chapter => { if (chapter.id !== id) return chapter; found = true; return updater(chapter); });
    if (!found) fail('CHAPTER_NOT_FOUND');
    return { ...state, chapters };
  }
  function startChapter(value, name, options) {
    const state = normalizeState(value); const input = options || {}; const chapterName = clean(name);
    if (state.activeChapterId) fail('ACTIVE_CHAPTER_EXISTS');
    if (!chapterName) fail('CHAPTER_NAME_REQUIRED');
    const id = clean(input.id) || createId('chapter');
    if (state.chapters.some(chapter => chapter.id === id)) fail('DUPLICATE_CHAPTER_ID');
    const chapter = { id, name: chapterName, status: 'active', revision: 1, startedAt: clean(input.now) || new Date().toISOString(), endedAt: '', messages: [], rollingSummary: '', rollingSummaryThroughMessageId: '', summary: emptySummary() };
    return { ...state, chapters: state.chapters.concat(chapter), activeChapterId: id };
  }
  function cancelActiveChapter(value) {
    const state = normalizeState(value); const active = getActiveChapter(state);
    if (!active) fail('NO_ACTIVE_CHAPTER');
    if (active.messages.length) fail('CHAPTER_NOT_EMPTY');
    return { ...state, chapters: state.chapters.filter(chapter => chapter.id !== active.id), activeChapterId: null };
  }
  function snapshot(message, speakerName, forcedRole) {
    return normalizeMessage({ id: message && message.id, role: forcedRole || message && message.role, speakerName, content: message && message.content });
  }
  function appendCompletedTurn(value, userMessage, assistantMessage, options) {
    const state = normalizeState(value); const active = getActiveChapter(state); const input = options || {};
    if (!active) fail('NO_ACTIVE_CHAPTER');
    if (!userMessage || userMessage.role !== 'user' || !assistantMessage || assistantMessage.role !== 'assistant') fail('INVALID_CHAPTER_TURN');
    const user = snapshot(userMessage, input.userSpeakerName || userMessage._roleName || '主控');
    const assistant = snapshot(assistantMessage, input.assistantSpeakerName || assistantMessage.speakerName || 'AI');
    const ids = new Set(state.chapters.flatMap(chapter => chapter.messages.map(message => message.id)));
    if (ids.has(user.id) || ids.has(assistant.id) || user.id === assistant.id) fail('DUPLICATE_MESSAGE_ID');
    return updateChapter(state, active.id, chapter => ({ ...chapter, revision: chapter.revision + 1, messages: chapter.messages.concat(user, assistant) }));
  }
  function canEndActiveChapter(value) { try { const state = normalizeState(value); const active = getActiveChapter(state); return Boolean(active && hasCompleteTurns(active.messages)); } catch (_) { return false; } }
  function endActiveChapter(value, options) {
    const state = normalizeState(value); const active = getActiveChapter(state); const input = options || {};
    if (!active) fail('NO_ACTIVE_CHAPTER');
    if (!hasCompleteTurns(active.messages)) fail('CHAPTER_INCOMPLETE');
    const next = updateChapter(state, active.id, chapter => ({ ...chapter, status: 'ended', revision: chapter.revision + 1, endedAt: clean(input.now) || new Date().toISOString(), summary: { ...chapter.summary, draftStatus: 'generating', draftText: '', generatedAt: '', lastFailure: null, sourceSceneText: clean(input.sourceSceneText) } }));
    return { ...next, activeChapterId: null };
  }
  function renameChapter(value, id, name) {
    const state = normalizeState(value); const nextName = clean(name); if (!nextName) fail('CHAPTER_NAME_REQUIRED');
    return updateChapter(state, clean(id), chapter => ({ ...chapter, name: nextName, revision: chapter.revision + (chapter.name === nextName ? 0 : 1) }));
  }
  function replaceAssistantMessage(value, previousId, replacement) {
    const state = normalizeState(value); const active = getActiveChapter(state);
    if (!active) {
      const endedOwns = state.chapters.some(chapter => chapter.status === 'ended' && chapter.messages.some(message => message.id === previousId));
      fail(endedOwns ? 'CHAPTER_ENDED' : 'NO_ACTIVE_CHAPTER');
    }
    const index = active.messages.findIndex(message => message.id === previousId);
    if (index < 0) fail('MESSAGE_OUTSIDE_ACTIVE_CHAPTER');
    if (active.messages[index].role !== 'assistant') fail('NOT_ASSISTANT_MESSAGE');
    const nextMessage = snapshot(replacement, replacement && replacement.speakerName || active.messages[index].speakerName, 'assistant');
    const duplicate = state.chapters.some(chapter => chapter.messages.some((message, messageIndex) => message.id === nextMessage.id && !(chapter.id === active.id && messageIndex === index)));
    if (duplicate) fail('DUPLICATE_MESSAGE_ID');
    return updateChapter(state, active.id, chapter => ({ ...chapter, revision: chapter.revision + 1, messages: chapter.messages.map((message, messageIndex) => messageIndex === index ? nextMessage : message) }));
  }
  function truncateActiveChapterAfter(value, messageId) {
    const state = normalizeState(value); const active = getActiveChapter(state); if (!active) fail('NO_ACTIVE_CHAPTER');
    const index = active.messages.findIndex(message => message.id === messageId); if (index < 0) fail('MESSAGE_OUTSIDE_ACTIVE_CHAPTER');
    if (index === active.messages.length - 1) return state;
    return updateChapter(state, active.id, chapter => ({ ...chapter, revision: chapter.revision + 1, messages: chapter.messages.slice(0, index + 1) }));
  }
  function setSummaryState(value, chapterId, updater) {
    const state = normalizeState(value);
    return updateChapter(state, chapterId, chapter => {
      if (chapter.status !== 'ended') fail('CHAPTER_NOT_ENDED');
      return { ...chapter, revision: chapter.revision + 1, summary: updater(chapter.summary) };
    });
  }
  function beginSummary(value, chapterId) { return setSummaryState(value, chapterId, summary => ({ ...summary, draftStatus: 'generating', draftText: '', generatedAt: '', lastFailure: null })); }
  function setSummaryDraft(value, chapterId, text, at) {
    const draftText = clean(text); if (!draftText) fail('SUMMARY_REQUIRED');
    return setSummaryState(value, chapterId, summary => ({ ...summary, draftStatus: 'ready', draftText, generatedAt: clean(at) || new Date().toISOString(), lastFailure: null }));
  }
  function setSummaryFailure(value, chapterId, failure) { return setSummaryState(value, chapterId, summary => ({ ...summary, draftStatus: 'failed', draftText: '', lastFailure: clone(failure || { message: '生成失败' }) })); }
  function confirmSummary(value, chapterId, text, at) {
    const confirmedText = clean(text); if (!confirmedText) fail('SUMMARY_REQUIRED');
    return setSummaryState(value, chapterId, summary => ({ ...summary, confirmedText, confirmedAt: clean(at) || new Date().toISOString(), draftStatus: 'none', draftText: '', generatedAt: '', lastFailure: null, sourceSceneText: '' }));
  }
  function recoverInterruptedSummaries(value, requestIsTracked, at) {
    const state = normalizeState(value); const tracked = typeof requestIsTracked === 'function' ? requestIsTracked : () => false; let changed = false;
    const chapters = state.chapters.map(chapter => {
      if (chapter.status !== 'ended' || chapter.summary.draftStatus !== 'generating' || tracked(chapter)) return chapter;
      changed = true;
      return {
        ...chapter,
        revision: chapter.revision + 1,
        summary: {
          ...chapter.summary,
          draftStatus: 'failed',
          draftText: '',
          lastFailure: {
            code: 'CHAPTER_SUMMARY_INTERRUPTED',
            message: '摘要生成已中断，请重新生成或手动填写',
            at: clean(at) || new Date().toISOString(),
          },
        },
      };
    });
    return { changed, state: changed ? { ...state, chapters } : state };
  }
  function clearNarrativeState(value, emptyScene) {
    const source = value && typeof value === 'object' ? value : {};
    return {
      ...source,
      messages: [],
      summary: '',
      chapterSchemaVersion: CHAPTER_SCHEMA_VERSION,
      chapters: [],
      activeChapterId: null,
      memories: [],
      currentScene: clone(emptyScene && typeof emptyScene === 'object' ? emptyScene : {}),
      memoryCandidates: [],
      memoryAnalysis: { analyzedTurnKeys: [], lastFailure: null, activeCharacter: null },
      memoryRequestTraces: {},
      currentRole: null,
      summarising: false,
      memorySnapshotIdentity: (Number(source.memorySnapshotIdentity) || 0) + 1,
    };
  }

  global.FonlingChapter = global.FonlingChapter || {};
  global.FonlingChapter.Model = { CHAPTER_SCHEMA_VERSION, CHAPTER_STATUSES, DRAFT_STATUSES, createId, emptySummary, createEmptyState, normalizeSummary, normalizeMessage, normalizeState, nextDefaultName, getActiveChapter, startChapter, cancelActiveChapter, appendCompletedTurn, canEndActiveChapter, endActiveChapter, renameChapter, replaceAssistantMessage, truncateActiveChapterAfter, beginSummary, setSummaryDraft, setSummaryFailure, confirmSummary, recoverInterruptedSummaries, clearNarrativeState };
})(globalThis);
