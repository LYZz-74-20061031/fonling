(function (global) {
  'use strict';

  const namespace = global.FonlingChapter = global.FonlingChapter || {};
  const DEFAULT_BUDGET = 6000;

  function cleanString(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function byEndedNewest(first, second) {
    const timeDifference = cleanString(second.endedAt).localeCompare(cleanString(first.endedAt));
    if (timeDifference !== 0) return timeDifference;
    return cleanString(first.id).localeCompare(cleanString(second.id));
  }

  function transcriptAfterRolling(chapter) {
    const messages = Array.isArray(chapter.messages) ? chapter.messages : [];
    const throughId = cleanString(chapter.rollingSummaryThroughMessageId);
    let start = 0;
    if (throughId) {
      const throughIndex = messages.findIndex(message => message && message.id === throughId);
      if (throughIndex >= 0) start = throughIndex + 1;
    }
    return messages.slice(start).map(message => {
      const speaker = cleanString(message && message.speakerName) || (message && message.role === 'user' ? '用户' : 'AI');
      return `${speaker}：${cleanString(message && message.content)}`;
    }).filter(Boolean).join('\n');
  }

  function transitionText(chapter) {
    return [cleanString(chapter.rollingSummary), transcriptAfterRolling(chapter)].filter(Boolean).join('\n');
  }

  function tokens(value) {
    const text = cleanString(value).toLowerCase();
    const result = new Set();
    const words = text.match(/[a-z0-9_]{2,}|[\u3400-\u9fff]+/g) || [];
    words.forEach(word => {
      if (/^[\u3400-\u9fff]+$/.test(word)) {
        if (word.length === 1) result.add(word);
        for (let index = 0; index < word.length - 1; index += 1) result.add(word.slice(index, index + 2));
      } else {
        result.add(word);
      }
    });
    return result;
  }

  function relevance(text, queryTokens) {
    if (queryTokens.size === 0) return 0;
    const own = tokens(text);
    let score = 0;
    queryTokens.forEach(token => { if (own.has(token)) score += 1; });
    return score;
  }

  function buildNarrativeContext(source, options) {
    const state = source && typeof source === 'object' ? source : {};
    const input = options || {};
    const budget = Number.isFinite(input.budget) && input.budget > 0 ? Math.floor(input.budget) : DEFAULT_BUDGET;
    const chapters = Array.isArray(state.chapters) ? state.chapters.filter(Boolean) : [];
    const trace = {
      chapterSummaryIds: [],
      usedActiveChapterRollingSummary: false,
      usedUnchapteredSummary: false,
    };
    const selected = [];
    let usedCharacters = 0;

    function appendSegment(segment, mandatory) {
      if (!segment || !cleanString(segment.text)) return false;
      const prefix = selected.length === 0 ? '剧情摘要层：\n' : '\n\n';
      const rendered = `${prefix}${segment.label}\n${cleanString(segment.text)}`;
      const remaining = budget - usedCharacters;
      if (remaining <= prefix.length + segment.label.length + 1) return false;
      let accepted = rendered;
      if (rendered.length > remaining) {
        if (!mandatory) return false;
        accepted = rendered.slice(0, remaining);
      }
      selected.push(accepted);
      usedCharacters += accepted.length;
      if (segment.chapterId && !trace.chapterSummaryIds.includes(segment.chapterId)) {
        trace.chapterSummaryIds.push(segment.chapterId);
      }
      if (segment.kind === 'active') trace.usedActiveChapterRollingSummary = true;
      if (segment.kind === 'unchaptered') trace.usedUnchapteredSummary = true;
      return true;
    }

    const active = cleanString(state.activeChapterId)
      ? chapters.find(chapter => chapter.id === state.activeChapterId && chapter.status === 'active')
      : null;
    if (active && cleanString(active.rollingSummary)) {
      appendSegment({
        kind: 'active',
        chapterId: active.id,
        label: `当前章节《${cleanString(active.name)}》内部摘要：`,
        text: active.rollingSummary,
      }, true);
    }

    const pending = chapters
      .filter(chapter => chapter.status === 'ended' && !cleanString(chapter.summary && chapter.summary.confirmedText))
      .sort(byEndedNewest);
    pending.forEach(chapter => {
      appendSegment({
        kind: 'transition',
        chapterId: chapter.id,
        label: `待确认章节《${cleanString(chapter.name)}》过渡摘要：`,
        text: transitionText(chapter),
      }, true);
    });

    const confirmed = chapters
      .filter(chapter => chapter.status === 'ended' && cleanString(chapter.summary && chapter.summary.confirmedText))
      .sort(byEndedNewest);
    const latest = confirmed[0];
    if (latest) {
      appendSegment({
        kind: 'confirmed',
        chapterId: latest.id,
        label: `上回剧情《${cleanString(latest.name)}》：`,
        text: latest.summary.confirmedText,
      }, true);
    }

    if (cleanString(state.summary)) {
      appendSegment({ kind: 'unchaptered', label: '章节外剧情摘要：', text: state.summary }, false);
    }

    const queryText = [
      cleanString(state.userText),
      cleanString(state.currentSceneText),
      ...(Array.isArray(state.recentMessages) ? state.recentMessages.slice(-6).map(message => cleanString(message && message.content)) : []),
    ].join(' ');
    const queryTokens = tokens(queryText);
    confirmed.slice(1).map(chapter => ({
      chapter,
      score: relevance(chapter.summary.confirmedText, queryTokens),
    })).filter(item => item.score > 0)
      .sort((first, second) => second.score - first.score || byEndedNewest(first.chapter, second.chapter))
      .forEach(item => {
        appendSegment({
          kind: 'confirmed',
          chapterId: item.chapter.id,
          label: `相关旧章节《${cleanString(item.chapter.name)}》：`,
          text: item.chapter.summary.confirmedText,
        }, false);
      });

    const content = selected.join('');
    return {
      messages: content ? [{ role: 'system', content }] : [],
      trace,
      usedCharacters: content.length,
    };
  }

  function buildCompactionPlan(source, options) {
    const state = source && typeof source === 'object' ? source : {};
    const input = options || {};
    const maximum = Number.isInteger(input.maximum) ? input.maximum : 30;
    const keep = Number.isInteger(input.keep) ? input.keep : 14;
    const messages = Array.isArray(state.messages) ? state.messages : [];
    if (messages.length <= maximum) return null;
    const retired = messages.slice(0, Math.max(0, messages.length - keep));
    if (retired.length === 0) return null;
    const chapters = new Map((Array.isArray(state.chapters) ? state.chapters : []).map(chapter => [chapter.id, chapter]));
    const grouped = new Map();
    retired.forEach(message => {
      const ownerKey = cleanString(message && message.chapterId) || 'unchaptered';
      if (ownerKey !== 'unchaptered' && !chapters.has(ownerKey)) {
        const error = new Error('待压缩消息引用了不存在的章节');
        error.code = 'UNKNOWN_MESSAGE_CHAPTER';
        throw error;
      }
      if (!grouped.has(ownerKey)) grouped.set(ownerKey, []);
      grouped.get(ownerKey).push(message);
    });
    const groups = Array.from(grouped.entries()).map(([ownerKey, ownerMessages]) => {
      const owner = ownerKey === 'unchaptered' ? null : chapters.get(ownerKey);
      const discardOnly = Boolean(owner && owner.status === 'ended' && cleanString(owner.summary && owner.summary.confirmedText));
      return {
        ownerKey,
        chapterId: owner ? owner.id : null,
        messages: ownerMessages.map(message => ({
          id: message.id,
          role: message.role,
          content: cleanString(message.content),
          ...(message.chapterId ? { chapterId: message.chapterId } : {}),
        })),
        baseSummary: owner ? cleanString(owner.rollingSummary) : cleanString(state.summary),
        discardOnly,
        needsSummary: !discardOnly,
        throughMessageId: cleanString(ownerMessages[ownerMessages.length - 1] && ownerMessages[ownerMessages.length - 1].id),
      };
    });
    return {
      retiredMessageIds: retired.map(message => message && message.id).filter(Boolean),
      groups,
      keep,
    };
  }

  function applyCompactionResults(source, plan, summaries) {
    if (!plan || !Array.isArray(plan.groups)) throw new Error('缺少压缩计划');
    const results = summaries && typeof summaries === 'object' ? summaries : {};
    plan.groups.forEach(group => {
      if (group.needsSummary && !cleanString(results[group.ownerKey])) {
        const error = new Error(`缺少 ${group.ownerKey} 的有效摘要`);
        error.code = 'COMPACTION_SUMMARY_REQUIRED';
        throw error;
      }
    });
    const next = JSON.parse(JSON.stringify(source && typeof source === 'object' ? source : {}));
    const retiredIds = new Set(plan.retiredMessageIds || []);
    next.messages = (Array.isArray(next.messages) ? next.messages : []).filter(message => !retiredIds.has(message && message.id));
    plan.groups.forEach(group => {
      if (group.discardOnly) return;
      const summary = cleanString(results[group.ownerKey]);
      if (group.ownerKey === 'unchaptered') {
        next.summary = summary;
        return;
      }
      const chapter = (Array.isArray(next.chapters) ? next.chapters : []).find(item => item && item.id === group.chapterId);
      if (!chapter) {
        const error = new Error('压缩目标章节已经不存在');
        error.code = 'CHAPTER_NOT_FOUND';
        throw error;
      }
      chapter.rollingSummary = summary;
      chapter.rollingSummaryThroughMessageId = group.throughMessageId;
      chapter.revision = (Number.isInteger(chapter.revision) ? chapter.revision : 0) + 1;
    });
    return next;
  }

  namespace.Context = {
    DEFAULT_BUDGET,
    transitionText,
    buildNarrativeContext,
    buildCompactionPlan,
    applyCompactionResults,
  };
})(globalThis);
