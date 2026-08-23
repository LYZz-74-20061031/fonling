(function (global) {
  'use strict';
  const namespace = global.FonlingChapter = global.FonlingChapter || {}; const Model = namespace.Model;
  if (!Model) throw new Error('FonlingChapter.Model is required');
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function clean(value) { return typeof value === 'string' ? value.trim() : ''; }
  function unsupported(reason, error) { return { supported: false, reason: reason || 'INVALID_CHAPTER_DATA', diagnostics: [{ path: 'chapters', message: error && error.message || '章节数据无效' }] }; }
  function normalizeMessages(messages, chapterState) {
    const chapters = new Map(chapterState.chapters.map(chapter => [chapter.id, chapter]));
    const sourceMessages = Array.isArray(messages) ? clone(messages) : [];
    let pendingActiveMessageCount = 0;
    return sourceMessages.map((message, index) => {
      if (!message || typeof message !== 'object' || Array.isArray(message)) return message;
      const chapterId = clean(message.chapterId);
      if (!chapterId) { delete message.chapterId; return message; }
      const chapter = chapters.get(chapterId); if (!chapter) { const e = new Error('消息引用了不存在的章节'); e.code = 'UNKNOWN_MESSAGE_CHAPTER'; throw e; }
      const archived = chapter.messages.find(item => item.id === clean(message.id));
      if (archived && (archived.role !== message.role || archived.content !== clean(message.content))) { const e = new Error('主聊天消息与章节原文不一致'); e.code = 'CHAPTER_MESSAGE_MISMATCH'; throw e; }
      if (!archived) {
        const isRetryableTail = chapter.status === 'active' && chapter.id === chapterState.activeChapterId
          && message.role === 'user' && index === sourceMessages.length - 1 && pendingActiveMessageCount === 0;
        if (!isRetryableTail) { const e = new Error('章节消息未包含在只读原文中'); e.code = 'CHAPTER_MESSAGE_NOT_ARCHIVED'; throw e; }
        pendingActiveMessageCount += 1;
      }
      return message;
    });
  }
  function migrateCharacterData(settings, messages) {
    const source = settings && typeof settings === 'object' && !Array.isArray(settings) ? clone(settings) : {}; const originalMessages = Array.isArray(messages) ? clone(messages) : [];
    if (Number(source.chapterSchemaVersion) > Model.CHAPTER_SCHEMA_VERSION) return unsupported('UNSUPPORTED_CHAPTER_SCHEMA');
    const legacy = !(Number(source.chapterSchemaVersion) >= Model.CHAPTER_SCHEMA_VERSION);
    try {
      const chapterState = legacy ? Model.createEmptyState() : Model.normalizeState(source); const nextMessages = normalizeMessages(originalMessages, chapterState); const nextSettings = { ...source, ...chapterState };
      return { supported: true, changed: legacy || JSON.stringify(nextSettings) !== JSON.stringify(source) || JSON.stringify(nextMessages) !== JSON.stringify(originalMessages), diagnostics: [], settings: nextSettings, messages: nextMessages };
    } catch (error) { return unsupported(error && error.code, error); }
  }
  function serializeChapterState(value) { const state = Model.normalizeState(value); return clone({ chapterSchemaVersion: state.chapterSchemaVersion, chapters: state.chapters, activeChapterId: state.activeChapterId }); }
  function estimateSerializedBytes(value) { try { const text = JSON.stringify(value); return text ? text.length * 2 : 0; } catch (_) { return 0; } }
  namespace.Storage = { migrateCharacterData, serializeChapterState, estimateSerializedBytes };
})(globalThis);
