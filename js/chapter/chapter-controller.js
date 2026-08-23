(function (global) {
  'use strict';
  const namespace = global.FonlingChapter = global.FonlingChapter || {}; const Model = namespace.Model;
  if (!Model) throw new Error('FonlingChapter.Model is required');
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function clean(value) { return typeof value === 'string' ? value.trim() : ''; }
  function chapterStateOf(state) { return { chapterSchemaVersion: state.chapterSchemaVersion, chapters: state.chapters, activeChapterId: state.activeChapterId }; }
  function mergeChapterState(state, chapters) { return { ...state, chapterSchemaVersion: chapters.chapterSchemaVersion, chapters: chapters.chapters, activeChapterId: chapters.activeChapterId }; }
  function activeChapterBoundary(source) {
    const state = source && typeof source === 'object' ? source : {};
    const chapterState = Model.normalizeState(chapterStateOf(state));
    const active = Model.getActiveChapter(chapterState);
    if (!active) return { active: null, pendingMessages: [], canCancel: false, canEnd: false };
    const archivedIds = new Set(active.messages.map(message => message.id));
    const recentMessages = Array.isArray(state.messages) ? state.messages.filter(Boolean) : [];
    const pendingMessages = recentMessages.filter(message => clean(message.chapterId) === active.id && !archivedIds.has(clean(message.id)));
    const latest = recentMessages[recentMessages.length - 1] || null;
    const latestIsArchivedAssistant = Boolean(latest && latest.role === 'assistant' && clean(latest.chapterId) === active.id && archivedIds.has(clean(latest.id)));
    return {
      active,
      pendingMessages,
      canCancel: active.messages.length === 0 && pendingMessages.length === 0,
      canEnd: Model.canEndActiveChapter(chapterState) && pendingMessages.length === 0 && latestIsArchivedAssistant,
    };
  }
  function boundaryError(code, message) { const error = new Error(message || code); error.code = code; return error; }
  function createChapterController(options) {
    const input = options || {}; if (typeof input.getState !== 'function' || typeof input.replaceState !== 'function') throw new Error('Chapter controller requires state accessors');
    const save = typeof input.save === 'function' ? input.save : () => ({ ok: true, rolledBack: true }); const refresh = typeof input.refresh === 'function' ? input.refresh : () => {}; const now = typeof input.now === 'function' ? input.now : () => new Date().toISOString(); const id = typeof input.createId === 'function' ? input.createId : () => Model.createId('chapter'); const assistantName = typeof input.getAssistantName === 'function' ? input.getAssistantName : () => 'AI';
    function errorResult(error) { return { ok: false, changed: false, code: error && error.code || 'CHAPTER_OPERATION_FAILED', error }; }
    function commit(next, previous) { input.replaceState(next); let result; try { result = save(); } catch (error) { result = { ok: false, rolledBack: false, error }; } if (!result || result.ok !== true) { input.replaceState(previous); refresh(); return { ok: false, changed: false, code: 'SAVE_FAILED', saveResult: result }; } refresh(); return { ok: true, changed: true, saveResult: result }; }
    function mutate(operation) { const previous = clone(input.getState()); try { return commit(mergeChapterState(previous, operation(chapterStateOf(previous))), previous); } catch (error) { return errorResult(error); } }
    function start(name) { return mutate(state => Model.startChapter(state, name, { id: id(), now: now() })); }
    function cancel() {
      const previous = clone(input.getState());
      try {
        const boundary = activeChapterBoundary(previous);
        if (!boundary.active) return errorResult(boundaryError('NO_ACTIVE_CHAPTER'));
        if (boundary.pendingMessages.length) return errorResult(boundaryError('CHAPTER_PENDING_TURN', '请先完成或重试当前回复'));
        if (!boundary.canCancel) return errorResult(boundaryError('CHAPTER_NOT_EMPTY'));
        return commit(mergeChapterState(previous, Model.cancelActiveChapter(chapterStateOf(previous))), previous);
      } catch (error) { return errorResult(error); }
    }
    function rename(chapterId, name) { return mutate(state => Model.renameChapter(state, chapterId, name)); }
    function buildCompletedTurnState(source, user, assistant) {
      const state = clone(source); const userOwner = user && typeof user.chapterId === 'string' ? user.chapterId : ''; const assistantOwner = assistant && typeof assistant.chapterId === 'string' ? assistant.chapterId : '';
      if (!userOwner && !assistantOwner) return { state, changed: false };
      if (!userOwner || userOwner !== assistantOwner || userOwner !== state.activeChapterId) { const error = new Error('对话章节归属不一致'); error.code = 'CHAPTER_OWNERSHIP_MISMATCH'; throw error; }
      const chapters = Model.appendCompletedTurn(chapterStateOf(state), user, assistant, { userSpeakerName: user._roleName || '主控', assistantSpeakerName: assistantName() });
      return { state: mergeChapterState(state, chapters), changed: true };
    }
    function archiveCompletedTurn(user, assistant) { const previous = clone(input.getState()); try { const prepared = buildCompletedTurnState(previous, user, assistant); return prepared.changed ? commit(prepared.state, previous) : { ok: true, changed: false }; } catch (error) { return errorResult(error); } }
    function replaceAssistant(previousId, replacement) { return mutate(state => Model.replaceAssistantMessage(state, previousId, { id: replacement && replacement.id, content: replacement && replacement.content, speakerName: replacement && replacement.speakerName || assistantName() })); }
    function canBacktrack(message) { const state = input.getState(); return Boolean(message && message.role === 'assistant' && state.activeChapterId && message.chapterId === state.activeChapterId); }
    function truncateAfter(messageId) { return mutate(state => Model.truncateActiveChapterAfter(state, messageId)); }
    function canEnd() { return activeChapterBoundary(input.getState()).canEnd; }
    function end(options) {
      const boundary = activeChapterBoundary(input.getState());
      if (boundary.pendingMessages.length) return errorResult(boundaryError('CHAPTER_PENDING_TURN', '请先完成或重试当前回复'));
      if (!boundary.canEnd) return errorResult(boundaryError('CHAPTER_INCOMPLETE', '章节至少需要一轮完整对话，并停在已完成的回复上'));
      const value = options || {};
      return mutate(state => Model.endActiveChapter(state, { now: now(), sourceSceneText: value.sourceSceneText }));
    }
    function confirmSummary(chapterId, text) { return mutate(state => Model.confirmSummary(state, chapterId, text, now())); }
    return { start, cancel, rename, buildCompletedTurnState, archiveCompletedTurn, replaceAssistant, canBacktrack, truncateAfter, canEnd, end, confirmSummary };
  }
  function buildFinalSummaryMessages(chapter) {
    if (!chapter || chapter.status !== 'ended') throw new Error('Final summary requires an ended chapter');
    const context = namespace.Context;
    const transition = context && typeof context.transitionText === 'function' ? context.transitionText(chapter) : clean(chapter.rollingSummary);
    const messages = [{
      role: 'system',
      content: '你是章节总结编辑。请将本章压缩为 600–1000 个中文字，硬上限 1200 字。必须覆盖重要事件、人物与关系变化、关键承诺或信息、章节结束状态，以及未解决冲突或伏笔；删除对白复述、过程动作和无关细节。只输出完整摘要正文，不要标题、解释或字数说明。'
    }];
    if (transition) messages.push({ role: 'system', content: '本章已压缩内容与尚未压缩原文：\n' + transition });
    if (clean(chapter.summary && chapter.summary.sourceSceneText)) messages.push({ role: 'system', content: '章节结束时的当前场景：\n' + clean(chapter.summary.sourceSceneText) });
    else if (clean(chapter.summary && chapter.summary.confirmedText)) messages.push({ role: 'system', content: '上一版已确认摘要（作为结束状态与伏笔的重写参考，不要遗漏其中仍有效的信息）：\n' + clean(chapter.summary.confirmedText) });
    return messages;
  }
  function validateFinalSummary(value) {
    const text = clean(value);
    if (!text) return { ok: false, code: 'EMPTY_CHAPTER_SUMMARY', text: '' };
    if (text.length > 1200) return { ok: false, code: 'CHAPTER_SUMMARY_TOO_LONG', text };
    return { ok: true, code: '', text };
  }
  function summaryRequestMatches(request, current) {
    return Boolean(request && current && current.chapter
      && request.characterName === current.characterName
      && request.chapterId === current.chapter.id
      && request.revision === current.chapter.revision
      && request.epoch === current.epoch
      && current.chapter.status === 'ended');
  }
  namespace.Controller = { createChapterController, chapterStateOf, mergeChapterState, activeChapterBoundary, buildFinalSummaryMessages, validateFinalSummary, summaryRequestMatches };
})(globalThis);
