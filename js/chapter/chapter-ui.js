(function (global) {
  'use strict';
  const namespace = global.FonlingChapter = global.FonlingChapter || {};
  function clean(value) { return typeof value === 'string' ? value.trim() : ''; }
  function escapeHtml(value) { return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function activeChapter(snapshot) { return (snapshot.chapters || []).find(chapter => chapter && chapter.id === snapshot.activeChapterId && chapter.status === 'active') || null; }
  function statusText(snapshot) { const active = activeChapter(snapshot || {}); return '当前章节：' + (active ? active.name : '无'); }
  function pendingChapters(snapshot) { return (snapshot.chapters || []).filter(chapter => chapter && chapter.status === 'ended' && chapter.summary && ['generating', 'ready', 'failed'].includes(chapter.summary.draftStatus)); }
  function createChapterUI(options) {
    const input = options || {}; const handlers = {}; let selectedId = ''; let restoreFocusTo = null;
    function emit(name, payload) { return typeof handlers[name] === 'function' ? handlers[name](payload) : undefined; }
    function snapshot() { return typeof input.getSnapshot === 'function' ? input.getSnapshot() : {}; }
    function focusableNodes() {
      if (!input.overlay || typeof input.overlay.querySelectorAll !== 'function') return [];
      return Array.from(input.overlay.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')).filter(node => !node.hidden && node.getAttribute('aria-hidden') !== 'true' && !(node.closest && node.closest('[hidden]')));
    }
    function close() {
      if (!input.overlay) return;
      input.overlay.hidden = true; input.overlay.setAttribute('aria-hidden', 'true'); selectedId = '';
      const target = restoreFocusTo; restoreFocusTo = null;
      if (target && target.isConnected !== false && typeof target.focus === 'function') target.focus();
    }
    function open() {
      if (!input.overlay) return;
      restoreFocusTo = global.document && global.document.activeElement ? global.document.activeElement : input.openButton;
      render(snapshot()); input.overlay.hidden = false; input.overlay.setAttribute('aria-hidden', 'false');
      if (input.closeButton && typeof input.closeButton.focus === 'function') input.closeButton.focus();
      else { const nodes = focusableNodes(); if (nodes[0] && typeof nodes[0].focus === 'function') nodes[0].focus(); }
    }
    function renderDetail(state) {
      if (!input.detail) return;
      const chapter = (state.chapters || []).find(item => item && item.id === selectedId);
      if (!chapter) { input.detail.hidden = true; input.detail.innerHTML = ''; return; }
      input.detail.hidden = false;
      const summary = clean(chapter.summary && (chapter.summary.draftStatus === 'ready' ? chapter.summary.draftText : chapter.summary.confirmedText));
      const raw = (chapter.messages || []).map(message => `${clean(message.speakerName) || (message.role === 'user' ? '用户' : 'AI')}：${clean(message.content)}`).join('\n\n');
      input.detail.innerHTML = `<div class="chapter-detail-head"><button type="button" data-action="close-detail">返回</button><h3>${escapeHtml(chapter.name)}</h3></div><label for="chapterEndedName">章节名称</label><input id="chapterEndedName" value="${escapeHtml(chapter.name)}"><button type="button" data-action="rename-ended" data-chapter-id="${escapeHtml(chapter.id)}">保存名称</button><label for="chapterDetailSummary">章节摘要</label><textarea id="chapterDetailSummary" data-summary-input="${escapeHtml(chapter.id)}" placeholder="填写一份完整章节摘要">${escapeHtml(summary)}</textarea><div class="chapter-actions"><button type="button" data-action="confirm-summary" data-chapter-id="${escapeHtml(chapter.id)}">保存并确认摘要</button><button type="button" data-action="regenerate-summary" data-chapter-id="${escapeHtml(chapter.id)}">重新生成</button></div><details class="chapter-transcript"><summary>阅读原文（${chapter.messages.length} 条）</summary><pre>${escapeHtml(raw || '本章暂无原文')}</pre></details>`;
    }
    function render(state) {
      const active = activeChapter(state);
      const boundary = active && namespace.Controller && typeof namespace.Controller.activeChapterBoundary === 'function'
        ? namespace.Controller.activeChapterBoundary(state)
        : { pendingMessages: [], canCancel: Boolean(active && active.messages.length === 0), canEnd: Boolean(active && active.messages.length) };
      const activeAction = boundary.pendingMessages.length
        ? '<button type="button" disabled>请先完成或重试当前回复</button>'
        : boundary.canEnd
          ? '<button type="button" data-action="end-active" class="danger">结束章节</button>'
          : boundary.canCancel
            ? '<button type="button" data-action="cancel-active" class="danger">取消空章节</button>'
            : '<button type="button" disabled>当前章节边界尚未完成</button>';
      if (input.status) { input.status.textContent = statusText(state); input.status.title = statusText(state); input.status.setAttribute('aria-label', statusText(state)); }
      const pending = pendingChapters(state);
      const failed = pending.some(chapter => chapter.summary.draftStatus === 'failed');
      if (input.promptBar) { input.promptBar.hidden = pending.length === 0 || pending.every(chapter => chapter.summary.draftStatus === 'generating'); if (input.promptText) input.promptText.textContent = failed ? '章节摘要生成失败，请处理' : '有新的章节摘要待确认'; }
      if (input.current) {
        input.current.innerHTML = active
          ? `<div class="chapter-card"><label for="activeChapterName">当前章节</label><input id="activeChapterName" value="${escapeHtml(active.name)}"><p>${active.messages.length} 条原文</p><div class="chapter-actions"><button type="button" data-action="rename-active">保存名称</button>${activeAction}</div></div>`
          : `<div class="chapter-card"><label for="chapterStartName">开始新章节</label><input id="chapterStartName" value="${escapeHtml(namespace.Model ? namespace.Model.nextDefaultName(state) : '第 1 章')}"><button type="button" data-action="start">开始章节（从下一条消息起）</button></div>`;
      }
      if (input.pending) {
        input.pending.innerHTML = pending.length ? pending.map(chapter => {
          const summary = chapter.summary || {}; const text = summary.draftStatus === 'ready' ? summary.draftText : summary.confirmedText;
          const status = summary.draftStatus === 'generating' ? '正在生成摘要…' : summary.draftStatus === 'failed' ? '生成失败，可重试或手动填写' : '待确认';
          return `<article class="chapter-card"><h4>${escapeHtml(chapter.name)}</h4><p>${status}</p><textarea data-summary-input="${escapeHtml(chapter.id)}" placeholder="填写一份完整章节摘要">${escapeHtml(text)}</textarea><div class="chapter-actions"><button type="button" data-action="confirm-summary" data-chapter-id="${escapeHtml(chapter.id)}">确认摘要</button><button type="button" data-action="regenerate-summary" data-chapter-id="${escapeHtml(chapter.id)}">重新生成</button><button type="button" data-action="later">稍后处理</button></div></article>`;
        }).join('') : '<p class="chapter-empty">没有待处理的章节摘要</p>';
      }
      if (input.ended) {
        const ended = (state.chapters || []).filter(chapter => chapter && chapter.status === 'ended').sort((a, b) => clean(b.endedAt).localeCompare(clean(a.endedAt)));
        input.ended.innerHTML = ended.length ? ended.map(chapter => `<button type="button" class="chapter-list-item" data-action="detail" data-chapter-id="${escapeHtml(chapter.id)}"><span>${escapeHtml(chapter.name)}</span><small>${chapter.messages.length} 条 · ${chapter.summary && chapter.summary.confirmedText ? '摘要已确认' : '摘要待确认'}</small></button>`).join('') : '<p class="chapter-empty">还没有已结束章节</p>';
      }
      renderDetail(state);
    }
    function click(event) {
      const button = event.target && event.target.closest ? event.target.closest('[data-action]') : null; if (!button) return;
      const action = button.dataset.action; const chapterId = button.dataset.chapterId || '';
      if (action === 'start') emit('start', { name: clean(input.current.querySelector('#chapterStartName').value) });
      else if (action === 'rename-active') emit('rename-active', { name: clean(input.current.querySelector('#activeChapterName').value) });
      else if (action === 'cancel-active') emit('cancel-active');
      else if (action === 'end-active') emit('end-active');
      else if (action === 'confirm-summary') { const fieldRoot = button.closest('.chapter-card, .chapter-manager-detail') || input.overlay; const field = fieldRoot.querySelector(`[data-summary-input="${chapterId}"]`); emit('confirm-summary', { chapterId, text: clean(field && field.value) }); }
      else if (action === 'regenerate-summary') emit('regenerate-summary', { chapterId });
      else if (action === 'rename-ended') emit('rename-ended', { chapterId, name: clean(input.detail.querySelector('#chapterEndedName').value) });
      else if (action === 'later') close();
      else if (action === 'detail') { selectedId = chapterId; renderDetail(snapshot()); }
      else if (action === 'close-detail') { selectedId = ''; renderDetail(snapshot()); }
    }
    if (input.openButton) input.openButton.addEventListener('click', open);
    if (input.closeButton) input.closeButton.addEventListener('click', close);
    if (input.backdrop) input.backdrop.addEventListener('click', close);
    if (input.promptBar) input.promptBar.addEventListener('click', open);
    if (input.promptBar) input.promptBar.addEventListener('keydown', function(event) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } });
    if (input.overlay) input.overlay.addEventListener('click', click);
    if (global.document && typeof global.document.addEventListener === 'function') global.document.addEventListener('keydown', function(event) {
      if (!input.overlay || input.overlay.hidden) return;
      if (event.key === 'Escape') { event.preventDefault(); close(); return; }
      if (event.key !== 'Tab') return;
      const nodes = focusableNodes();
      if (!nodes.length) { event.preventDefault(); return; }
      const first = nodes[0]; const last = nodes[nodes.length - 1]; const active = global.document.activeElement;
      if (event.shiftKey && (active === first || !input.overlay.contains(active))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (active === last || !input.overlay.contains(active))) { event.preventDefault(); first.focus(); }
    });
    return { on(name, handler) { handlers[name] = handler; }, open, close, render };
  }
  namespace.UI = { statusText, pendingChapters, createChapterUI };
})(globalThis);
