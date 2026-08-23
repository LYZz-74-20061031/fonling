(function (global) {
  'use strict';

  function createMemoryUI(elements) {
    const handlers = {};
    const el = elements || {};
    let snapshot = { memories: [], currentScene: {}, memoryCandidates: [], characterName: '' };
    const memoryDrafts = {};
    const sceneDrafts = {};
    const candidateDrafts = {};
    let restoreFocusTo = null;
    let candidateRestoreFocusTo = null;
    let toastTimer = null;
    let draftIdentity = null;
    let traceRestoreFocusTo = null;
    let storageWarningRestoreFocusTo = null;
    let sourceHighlightTimer = null;
    let highlightedSourceNode = null;

    function currentSnapshot() {
      if (typeof el.getSnapshot === 'function') {
        try {
          const live = el.getSnapshot();
          if (live && typeof live === 'object') return live;
        } catch (_) {}
      }
      return snapshot;
    }

    function clearDrafts() {
      Object.keys(memoryDrafts).forEach(key => { delete memoryDrafts[key]; });
      Object.keys(sceneDrafts).forEach(key => { delete sceneDrafts[key]; });
      Object.keys(candidateDrafts).forEach(key => { delete candidateDrafts[key]; });
      Object.keys(el.manualForms || {}).forEach(function(type) {
        const controls = el.manualForms[type];
        if (controls.input) controls.input.value = '';
        if (controls.form) controls.form.hidden = true;
      });
    }

    function emit(action, payload) {
      let result;
      (handlers[action] || []).forEach(handler => { result = handler(payload); });
      return result;
    }
    function candidateActionPayload(payload) {
      return Object.assign({}, payload, {
        characterName: snapshot.characterName || '',
        snapshotIdentity: snapshot.snapshotIdentity || '',
      });
    }
    function candidateDraftKey(candidateId) {
      return `${snapshot.characterName || ''}::${snapshot.snapshotIdentity || ''}::${candidateId || ''}`;
    }
    function on(action, handler) {
      if (!handlers[action]) handlers[action] = [];
      handlers[action].push(handler);
      return function () { handlers[action] = handlers[action].filter(item => item !== handler); };
    }
    function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }
    function button(text, className, action, payload) {
      const node = document.createElement('button');
      node.type = 'button'; node.className = className || 'memory-action'; node.textContent = text;
      if (action) node.addEventListener('click', function () { emit(action, payload); });
      return node;
    }
    function formatTime(value) {
      if (!value) return '';
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
    }
    function statusLabel(status) {
      return ({ active: '使用中', archived: '已归档', resolved: '已解决', invalidated: '已失效' })[status] || status;
    }
    function renderMemoryList(container, type) {
      clear(container);
      const list = (snapshot.memories || []).filter(memory => memory.type === type);
      if (!list.length) {
        const empty = document.createElement('p'); empty.className = 'memory-empty'; empty.textContent = '还没有记录。'; container.appendChild(empty); return;
      }
      list.forEach(memory => {
        const card = document.createElement('article'); card.className = 'memory-card' + (memory.status === 'active' ? '' : ' is-inactive');
        const content = document.createElement('textarea'); content.value = Object.prototype.hasOwnProperty.call(memoryDrafts, memory.id) ? memoryDrafts[memory.id] : memory.content; content.setAttribute('aria-label', '记忆内容');
        content.addEventListener('input', function () { memoryDrafts[memory.id] = content.value; }); card.appendChild(content);
        const meta = document.createElement('p'); meta.className = 'memory-meta';
        meta.textContent = statusLabel(memory.status) + (memory.source ? ' · 来源：' + memory.source : '') + (memory.updatedAt ? ' · ' + formatTime(memory.updatedAt) : ''); card.appendChild(meta);
        const actions = document.createElement('div'); actions.className = 'memory-card-actions';
        const saveEdit = button('保存编辑', 'memory-primary');
        saveEdit.addEventListener('click', function () {
          const result = emit('updateMemory', { id: memory.id, getPatch: function () { return { content: content.value }; } });
          if (result && result.ok === true) delete memoryDrafts[memory.id];
        });
        actions.appendChild(saveEdit);
        const pinLabel = document.createElement('label'); pinLabel.className = 'memory-pin';
        const pin = document.createElement('input'); pin.type = 'checkbox'; pin.checked = memory.pinned === true;
        pin.addEventListener('change', function () { emit('togglePinned', { id: memory.id }); }); pinLabel.appendChild(pin);
        const pinText = document.createElement('span'); pinText.textContent = '固定'; pinLabel.appendChild(pinText); actions.appendChild(pinLabel);
        if (memory.status !== 'active') actions.appendChild(button('恢复使用', 'memory-action', 'setMemoryStatus', { id: memory.id, status: 'active' }));
        else if (type === 'history_event') actions.appendChild(button('归档', 'memory-action', 'setMemoryStatus', { id: memory.id, status: 'archived' }));
        else {
          actions.appendChild(button('标为已解决', 'memory-action', 'setMemoryStatus', { id: memory.id, status: 'resolved' }));
          actions.appendChild(button('标为失效', 'memory-action', 'setMemoryStatus', { id: memory.id, status: 'invalidated' }));
        }
        if (Array.isArray(memory.sourceMessageIds) && memory.sourceMessageIds.length) {
          const source = button('查看来源', 'memory-action');
          source.addEventListener('click', function () { openSource(memory.sourceMessageIds, 'formal'); });
          actions.appendChild(source);
        }
        const remove = button('删除', 'memory-danger');
        remove.addEventListener('click', function () { if (global.confirm('永久删除这条记忆？此操作无法撤销。')) emit('deleteMemory', { id: memory.id }); });
        actions.appendChild(remove); card.appendChild(actions); container.appendChild(card);
      });
    }
    function renderScene() {
      const scene = snapshot.currentScene || {};
      const fields = el.sceneFields || {};
      Object.keys(fields).forEach(key => {
        fields[key].value = Object.prototype.hasOwnProperty.call(sceneDrafts, key)
          ? sceneDrafts[key]
          : (key === 'presentCharacters' ? (scene[key] || []).join(', ') : (scene[key] || ''));
      });
    }
    function renderPending() {
      if (!el.pendingList) return;
      clear(el.pendingList);
      const candidates = snapshot.memoryCandidates || [];
      const notice = document.createElement('p'); notice.className = 'memory-notice'; notice.textContent = candidates.length ? `还有${candidates.length}条建议等待决定。` : '暂无待确认建议。'; el.pendingList.appendChild(notice);
      candidates.forEach(candidate => el.pendingList.appendChild(renderCandidateCard(candidate)));
      if (candidates.length) el.pendingList.appendChild(createDismissAllButton(candidates));
    }
    function candidateTargets(candidate) {
      const ids = candidate.targetMemoryIds || [];
      return (snapshot.memories || []).filter(memory => ids.includes(memory.id));
    }
    function appendLabeledControl(container, labelText, control) {
      const label = document.createElement('label'); label.className = 'memory-candidate-edit-field';
      const text = document.createElement('span'); text.textContent = labelText; label.appendChild(text); label.appendChild(control);
      container.appendChild(label); return control;
    }
    function renderCandidateSummary(card, candidate) {
      const operationNames = { add: '新增', update: '更新', merge: '合并', resolve: '变更状态', scene_patch: '更新场景' };
      const typeNames = { history_event: '历史事件', key_info: '关键信息' };
      const typeName = candidate.operation === 'scene_patch' ? '当前场景' : (typeNames[candidate.memoryType] || '记忆');
      const operationName = operationNames[candidate.operation] || candidate.operation;
      const title = document.createElement('p'); title.className = 'memory-candidate-operation'; title.textContent = `${typeName} · 建议${operationName}`; card.appendChild(title);
      const targets = candidateTargets(candidate);
      if (targets.length) {
        const old = document.createElement('p'); old.className = 'memory-candidate-old'; old.textContent = '原内容：' + targets.map(memory => memory.content).join(' / '); card.appendChild(old);
      }
      const proposed = document.createElement('p'); proposed.className = 'memory-candidate-proposed';
      if (candidate.operation === 'scene_patch') proposed.textContent = '建议变更：' + Object.keys(candidate.scenePatch || {}).map(key => `${key}=${Array.isArray(candidate.scenePatch[key]) ? candidate.scenePatch[key].join('、') : candidate.scenePatch[key]}`).join('；');
      else if (candidate.operation === 'resolve') proposed.textContent = '建议状态：' + candidate.resultStatus;
      else proposed.textContent = '建议内容：' + candidate.content;
      card.appendChild(proposed);
      if (candidate.conflict || candidate.possibleConflict) {
        const conflict = document.createElement('p'); conflict.className = 'memory-candidate-conflict'; conflict.textContent = candidate.conflict ? '检测到冲突，请仔细核对。' : '可能存在冲突，请核对。'; card.appendChild(conflict);
      }
      if (candidate.reason) { const reason = document.createElement('p'); reason.className = 'memory-meta'; reason.textContent = candidate.reason; card.appendChild(reason); }
      if (Array.isArray(candidate.sourceMessageIds) && candidate.sourceMessageIds.length) {
        const source = button('查看来源', 'memory-action');
        source.addEventListener('click', function () { openSource(candidate.sourceMessageIds, 'candidate'); });
        card.appendChild(source);
      }
    }
    function buildMemoryCandidateEdit(card, candidate) {
      const actionContext = candidateActionPayload({});
      const draftKey = candidateDraftKey(candidate.id);
      const draft = candidateDrafts[draftKey] && candidateDrafts[draftKey].kind === 'memory' ? candidateDrafts[draftKey] : null;
      const form = document.createElement('div'); form.className = 'memory-candidate-edit'; form.hidden = !(draft && draft.open);
      const type = document.createElement('select'); type.dataset.editField = 'memoryType';
      ['history_event', 'key_info'].forEach(value => { const option = document.createElement('option'); option.value = value; option.textContent = value === 'history_event' ? '历史事件' : '关键信息'; type.appendChild(option); });
      type.value = draft ? draft.memoryType : (candidate.memoryType || 'key_info'); appendLabeledControl(form, '记忆类型', type);
      const content = document.createElement('textarea'); content.dataset.editField = 'content'; content.value = draft ? draft.content : (candidate.content || ''); appendLabeledControl(form, '内容', content);
      const pinned = document.createElement('input'); pinned.type = 'checkbox'; pinned.dataset.editField = 'pinned'; pinned.checked = draft ? draft.pinned : candidate.pinned === true; appendLabeledControl(form, '固定记忆', pinned);
      const targets = document.createElement('input'); targets.dataset.editField = 'targetMemoryIds'; targets.value = draft ? draft.targetMemoryIds : (candidate.targetMemoryIds || []).join(', '); appendLabeledControl(form, '目标记忆 ID（逗号分隔）', targets);
      const status = document.createElement('select'); status.dataset.editField = 'resultStatus';
      ['', 'archived', 'resolved', 'invalidated'].forEach(value => { const option = document.createElement('option'); option.value = value; option.textContent = value || '不变'; status.appendChild(option); });
      status.value = draft ? draft.resultStatus : (candidate.resultStatus || ''); appendLabeledControl(form, '结果状态', status);
      function storeDraft(open) {
        candidateDrafts[draftKey] = {
          kind: 'memory', open: open, memoryType: type.value, content: content.value,
          pinned: pinned.checked, targetMemoryIds: targets.value, resultStatus: status.value,
        };
      }
      function restoreCachedDraft() {
        const cached = candidateDrafts[draftKey];
        if (!cached || cached.kind !== 'memory') return;
        type.value = cached.memoryType;
        content.value = cached.content;
        pinned.checked = cached.pinned;
        targets.value = cached.targetMemoryIds;
        status.value = cached.resultStatus;
      }
      type.addEventListener('change', function () { storeDraft(true); });
      content.addEventListener('input', function () { storeDraft(true); });
      pinned.addEventListener('change', function () { storeDraft(true); });
      targets.addEventListener('input', function () { storeDraft(true); });
      targets.addEventListener('change', function () { storeDraft(true); });
      status.addEventListener('change', function () { storeDraft(true); });
      const save = button('保存并确认', 'memory-primary');
      save.addEventListener('click', function () {
        storeDraft(true);
        const result = emit('candidate-edit', Object.assign({}, actionContext, { id: candidate.id, edited: {
          memoryType: type.value, content: content.value, pinned: pinned.checked,
          targetMemoryIds: targets.value.split(/[,，]/).map(value => value.trim()).filter(Boolean), resultStatus: status.value,
        } }));
        if (result && result.ok === true) delete candidateDrafts[draftKey];
      });
      form.appendChild(save); card.appendChild(form);
      return { form, setOpen: function(open) { restoreCachedDraft(); form.hidden = !open; storeDraft(open); } };
    }
    function buildSceneCandidateEdit(card, candidate) {
      const actionContext = candidateActionPayload({});
      const draftKey = candidateDraftKey(candidate.id);
      const draft = candidateDrafts[draftKey] && candidateDrafts[draftKey].kind === 'scene' ? candidateDrafts[draftKey] : null;
      const form = document.createElement('div'); form.className = 'memory-candidate-edit memory-candidate-scene-edit'; form.hidden = !(draft && draft.open);
      const keys = ['time', 'location', 'presentCharacters', 'currentGoal', 'currentConflict', 'characterStates', 'environment', 'notes'];
      const labels = { time: '时间', location: '地点', presentCharacters: '在场角色', currentGoal: '当前目标', currentConflict: '当前冲突', characterStates: '角色状态', environment: '环境', notes: '备注' };
      const controls = {};
      keys.forEach(function(key) {
        const row = document.createElement('div'); row.className = 'memory-candidate-scene-row';
        const input = document.createElement(key === 'presentCharacters' ? 'input' : 'textarea'); input.dataset.sceneField = key;
        const originallyProposed = Boolean(candidate.scenePatch && Object.prototype.hasOwnProperty.call(candidate.scenePatch, key));
        const original = originallyProposed ? candidate.scenePatch[key] : '';
        const fieldDraft = draft && draft.fields && draft.fields[key];
        input.value = fieldDraft ? fieldDraft.value : (Array.isArray(original) ? original.join(', ') : original); appendLabeledControl(row, labels[key], input);
        const clearLabel = document.createElement('label'); clearLabel.className = 'memory-candidate-clear-field';
        const clearInput = document.createElement('input'); clearInput.type = 'checkbox'; clearInput.dataset.clearField = key;
        clearInput.checked = fieldDraft ? fieldDraft.clear : (originallyProposed && (Array.isArray(original) ? original.length === 0 : original === ''));
        const clearText = document.createElement('span'); clearText.textContent = '明确清空此字段'; clearLabel.appendChild(clearInput); clearLabel.appendChild(clearText); row.appendChild(clearLabel);
        controls[key] = { input, clearInput, originallyProposed }; form.appendChild(row);
      });
      function storeDraft(open) {
        const fields = {};
        keys.forEach(function(key) { fields[key] = { value: controls[key].input.value, clear: controls[key].clearInput.checked }; });
        candidateDrafts[draftKey] = { kind: 'scene', open: open, fields: fields };
      }
      function restoreCachedDraft() {
        const cached = candidateDrafts[draftKey];
        if (!cached || cached.kind !== 'scene' || !cached.fields) return;
        keys.forEach(function(key) {
          if (!cached.fields[key]) return;
          controls[key].input.value = cached.fields[key].value;
          controls[key].clearInput.checked = cached.fields[key].clear;
        });
      }
      keys.forEach(function(key) {
        controls[key].input.addEventListener('input', function () { storeDraft(true); });
        controls[key].clearInput.addEventListener('change', function () { storeDraft(true); });
      });
      const save = button('保存并确认', 'memory-primary');
      save.addEventListener('click', function () {
        storeDraft(true);
        const patch = {};
        keys.forEach(function(key) {
          const control = controls[key];
          if (control.clearInput.checked) patch[key] = key === 'presentCharacters' ? [] : '';
          else if (control.input.value.trim()) patch[key] = key === 'presentCharacters' ? control.input.value.split(/[,，]/).map(value => value.trim()).filter(Boolean) : control.input.value;
        });
        const result = emit('candidate-edit', Object.assign({}, actionContext, { id: candidate.id, edited: { scenePatch: patch } }));
        if (result && result.ok === true) delete candidateDrafts[draftKey];
      });
      form.appendChild(save); card.appendChild(form);
      return { form, setOpen: function(open) { restoreCachedDraft(); form.hidden = !open; storeDraft(open); } };
    }
    function renderCandidateCard(candidate) {
      const card = document.createElement('article'); card.className = 'memory-card memory-candidate-card'; card.dataset.candidateId = candidate.id;
      renderCandidateSummary(card, candidate);
      const draftKey = candidateDraftKey(candidate.id);
      const editView = candidate.operation === 'scene_patch' ? buildSceneCandidateEdit(card, candidate) : buildMemoryCandidateEdit(card, candidate);
      const actions = document.createElement('div'); actions.className = 'memory-candidate__actions';
      const confirmPayload = candidateActionPayload({ id: candidate.id });
      const confirm = button('确认记忆', 'memory-primary');
      confirm.addEventListener('click', function () {
        const result = emit('candidate-confirm', confirmPayload);
        if (result && result.ok === true) delete candidateDrafts[draftKey];
      });
      actions.appendChild(confirm);
      const edit = button('修改', 'memory-action'); edit.addEventListener('click', function () { editView.setOpen(editView.form.hidden); }); actions.appendChild(edit);
      const dismissPayload = candidateActionPayload({ id: candidate.id });
      const dismiss = button('不计入', 'memory-danger');
      dismiss.addEventListener('click', function () {
        const result = emit('candidate-dismiss', dismissPayload);
        if (result && result.ok === true) delete candidateDrafts[draftKey];
      });
      actions.appendChild(dismiss); card.appendChild(actions); return card;
    }
    function createDismissAllButton(candidates) {
      const actionContext = candidateActionPayload({});
      const candidateIds = candidates.map(candidate => candidate.id);
      const draftKeys = candidateIds.map(candidateDraftKey);
      const dismissAll = button('全部不计入', 'memory-danger');
      dismissAll.addEventListener('click', function () {
        if (!global.confirm('确定不计入全部候选记忆吗？')) return;
        const result = emit('candidate-dismiss-all', Object.assign({}, actionContext, { ids: candidateIds }));
        if (result && result.ok === true) draftKeys.forEach(key => { delete candidateDrafts[key]; });
      });
      return dismissAll;
    }
    function renderCandidateShell() {
      const candidates = snapshot.memoryCandidates || [];
      if (el.promptBar) el.promptBar.hidden = candidates.length === 0;
      if (el.promptText) el.promptText.textContent = `TA 发现了 ${candidates.length} 条新记忆`;
      if (!el.candidateList) return;
      clear(el.candidateList);
      candidates.forEach(candidate => el.candidateList.appendChild(renderCandidateCard(candidate)));
      if (candidates.length) el.candidateList.appendChild(createDismissAllButton(candidates));
    }
    function render(next) {
      const incoming = next || snapshot;
      const incomingIdentity = `${incoming.characterName || ''}::${incoming.snapshotIdentity || ''}`;
      if (draftIdentity !== null && incomingIdentity !== draftIdentity) {
        clearDrafts();
        clearSourceHighlight();
      }
      draftIdentity = incomingIdentity;
      snapshot = incoming;
      if (el.characterName) el.characterName.textContent = snapshot.characterName || '未选择角色';
      renderMemoryList(el.historyList, 'history_event'); renderMemoryList(el.keyInfoList, 'key_info'); renderScene(); renderPending(); renderCandidateShell();
    }
    function selectTab(tab) {
      const target = tab || 'history';
      (el.tabs || []).forEach(node => { const active = node.dataset.tab === target; node.classList.toggle('active', active); node.setAttribute('aria-selected', String(active)); node.setAttribute('tabindex', active ? '0' : '-1'); });
      (el.panels || []).forEach(node => { node.hidden = node.dataset.panel !== target; });
    }
    function openCenter(tab) {
      restoreFocusTo = document.activeElement;
      if (el.storageSize) {
        let bytes = 0;
        try { bytes = typeof el.getStorageBytes === 'function' ? Number(el.getStorageBytes()) : Number(snapshot.storageBytes); } catch (_) { bytes = 0; }
        if (!Number.isFinite(bytes) || bytes < 0) bytes = 0;
        el.storageSize.textContent = bytes >= 1024
          ? `本角色本地数据约 ${(bytes / 1024).toFixed(1)} KB`
          : `本角色本地数据约 ${Math.round(bytes)} 字节`;
      }
      selectTab(tab); el.overlay.classList.add('active'); el.overlay.setAttribute('aria-hidden', 'false');
      const activeTab = (el.tabs || []).find(node => node.dataset.tab === (tab || 'history')) || (el.tabs || [])[0];
      if (activeTab) activeTab.focus();
    }
    function closeCenter() {
      clearSourceHighlight();
      el.overlay.classList.remove('active'); el.overlay.setAttribute('aria-hidden', 'true');
      if (restoreFocusTo && typeof restoreFocusTo.focus === 'function') restoreFocusTo.focus();
    }
    function openCandidateSheet() {
      if (!el.candidateSheet) return;
      candidateRestoreFocusTo = document.activeElement;
      el.candidateSheet.hidden = false; el.candidateSheet.setAttribute('aria-hidden', 'false');
      const first = candidateFocusable()[0];
      if (first) first.focus();
    }
    function closeCandidateSheet() {
      if (!el.candidateSheet) return;
      el.candidateSheet.hidden = true; el.candidateSheet.setAttribute('aria-hidden', 'true');
      if (candidateRestoreFocusTo && typeof candidateRestoreFocusTo.focus === 'function') candidateRestoreFocusTo.focus();
      candidateRestoreFocusTo = null;
    }
    function candidateFocusable() {
      if (!el.candidateSheet) return [];
      return Array.from(el.candidateSheet.querySelectorAll('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'))
        .filter(node => !(typeof node.closest === 'function' && node.closest('[hidden]')));
    }
    function showMessage(message) {
      if (!el.toast) return;
      el.toast.textContent = message; el.toast.hidden = false; el.toast.setAttribute('role', 'alert'); el.toast.setAttribute('aria-live', 'assertive');
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { el.toast.hidden = true; }, 4500);
    }
    function showAnalysisFailure(message) { showMessage(message || '整理失败，请稍后重试。'); }
    function closeStorageWarning() {
      if (!el.storageWarningOverlay) return;
      el.storageWarningOverlay.hidden = true;
      el.storageWarningOverlay.setAttribute('aria-hidden', 'true');
      if (storageWarningRestoreFocusTo && typeof storageWarningRestoreFocusTo.focus === 'function') storageWarningRestoreFocusTo.focus();
      storageWarningRestoreFocusTo = null;
    }
    function showStorageWarning(details) {
      const value = details && typeof details === 'object' ? details : { message: details };
      const message = value.message || '保存失败，原数据已保留。';
      if (value.quotaExceeded === true && el.storageWarningOverlay) {
        storageWarningRestoreFocusTo = document.activeElement;
        if (el.storageWarningMessage) el.storageWarningMessage.textContent = message;
        el.storageWarningOverlay.hidden = false;
        el.storageWarningOverlay.setAttribute('aria-hidden', 'false');
        if (el.storageWarningExportButton && typeof el.storageWarningExportButton.focus === 'function') el.storageWarningExportButton.focus();
        return;
      }
      showMessage(message);
    }

    function clearSourceHighlight() {
      if (sourceHighlightTimer) clearTimeout(sourceHighlightTimer);
      sourceHighlightTimer = null;
      if (highlightedSourceNode && highlightedSourceNode.classList) highlightedSourceNode.classList.remove('memory-source-highlight');
      highlightedSourceNode = null;
    }
    function openSource(messageId, sourceKind) {
      const ids = (Array.isArray(messageId) ? messageId : [messageId])
        .map(function(value) { return typeof value === 'string' ? value.trim() : ''; })
        .filter(Boolean);
      const live = currentSnapshot();
      let node = null;
      for (let index = 0; index < ids.length && !node; index += 1) {
        const id = ids[index];
        if (typeof el.findMessageNode === 'function') {
          try { node = el.findMessageNode(id); } catch (_) { node = null; }
        } else if (document && typeof document.querySelector === 'function') {
          const escaped = id.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
          try { node = document.querySelector(`[data-message-id="${escaped}"]`); } catch (_) { node = null; }
        }
      }
      if (node) {
        clearSourceHighlight();
        if (typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'center' });
        if (node.classList) node.classList.add('memory-source-highlight');
        highlightedSourceNode = node;
        sourceHighlightTimer = setTimeout(function () {
          if (highlightedSourceNode === node) {
            if (node.classList) node.classList.remove('memory-source-highlight');
            highlightedSourceNode = null;
            sourceHighlightTimer = null;
          }
        }, 1800);
        return 'message';
      }
      const belongsToFormalMemory = (live.memories || []).some(function(memory) {
        return memory && Array.isArray(memory.sourceMessageIds) && ids.some(function(id) { return memory.sourceMessageIds.includes(id); });
      });
      if (sourceKind === 'formal' || (sourceKind !== 'candidate' && belongsToFormalMemory)) {
        showMessage('来源对话已压缩');
        return 'compressed';
      }
      showMessage('来源不可定位');
      return 'unavailable';
    }

    function appendTraceSection(titleText, values) {
      if (!el.traceContent) return;
      const section = document.createElement('section'); section.className = 'memory-trace-section';
      const title = document.createElement('h3'); title.textContent = titleText; section.appendChild(title);
      const list = Array.isArray(values) ? values : [];
      if (!list.length) {
        const empty = document.createElement('p'); empty.className = 'memory-meta'; empty.textContent = '未使用'; section.appendChild(empty);
      } else {
        list.forEach(function(value) {
          const item = document.createElement('p'); item.textContent = value; section.appendChild(item);
        });
      }
      el.traceContent.appendChild(section);
    }

    function formatSceneForTrace(scene) {
      const value = scene && typeof scene === 'object' ? scene : {};
      const labels = { time: '时间', location: '地点', presentCharacters: '在场角色', currentGoal: '当前目标', currentConflict: '当前冲突', characterStates: '角色状态', environment: '环境', notes: '备注' };
      return Object.keys(labels).map(function(key) {
        const field = Array.isArray(value[key]) ? value[key].join('、') : value[key];
        return typeof field === 'string' && field.trim() ? `${labels[key]}：${field.trim()}` : '';
      }).filter(Boolean).join('；');
    }

    function closeTrace() {
      if (!el.traceOverlay) return;
      el.traceOverlay.hidden = true;
      el.traceOverlay.setAttribute('aria-hidden', 'true');
      if (traceRestoreFocusTo && typeof traceRestoreFocusTo.focus === 'function') traceRestoreFocusTo.focus();
      traceRestoreFocusTo = null;
    }

    function openTrace(assistantMessageId) {
      const live = currentSnapshot();
      const trace = live.memoryRequestTraces && live.memoryRequestTraces[assistantMessageId];
      if (!trace || !el.traceOverlay || !el.traceContent) {
        showMessage('本次记忆记录不可用');
        return false;
      }
      const memories = Array.isArray(live.memories) ? live.memories : [];
      const byId = new Map(memories.filter(Boolean).map(memory => [memory.id, memory]));
      const resolveContents = function(ids) {
        return (Array.isArray(ids) ? ids : []).map(function(id) {
          const memory = byId.get(id);
          return memory ? memory.content : `记忆已删除（${id}）`;
        });
      };
      clear(el.traceContent);
      appendTraceSection('固定记忆', resolveContents(trace.pinnedMemoryIds));
      appendTraceSection('相关记忆', resolveContents(trace.relatedMemoryIds));
      appendTraceSection('当前场景', trace.sceneUpdatedAt ? [`场景版本：${trace.sceneUpdatedAt}；${formatSceneForTrace(live.currentScene) || '当前场景为空'}`] : []);
      const chapters = Array.isArray(live.chapters) ? live.chapters : [];
      const chapterById = new Map(chapters.filter(Boolean).map(chapter => [chapter.id, chapter]));
      const chapterSummaries = (Array.isArray(trace.chapterSummaryIds) ? trace.chapterSummaryIds : []).map(function(id) {
        const chapter = chapterById.get(id);
        if (!chapter) return `章节摘要已不存在（${id}）`;
        const confirmed = chapter.summary && typeof chapter.summary.confirmedText === 'string' ? chapter.summary.confirmedText.trim() : '';
        const rolling = typeof chapter.rollingSummary === 'string' ? chapter.rollingSummary.trim() : '';
        return `《${chapter.name || '未命名章节'}》：${confirmed || rolling || '使用了近期章节原文'}`;
      });
      appendTraceSection('章节摘要', chapterSummaries);
      appendTraceSection('摘要使用', [
        trace.usedUnchapteredSummary || trace.usedSummary ? '章节外滚动摘要：已使用' : '章节外滚动摘要：未使用',
        trace.usedActiveChapterRollingSummary ? '当前章节内部摘要：已使用' : '当前章节内部摘要：未使用'
      ]);
      if (el.traceTitle) el.traceTitle.textContent = '本次使用的记忆';
      traceRestoreFocusTo = document.activeElement;
      el.traceOverlay.hidden = false;
      el.traceOverlay.setAttribute('aria-hidden', 'false');
      if (el.traceCloseButton && typeof el.traceCloseButton.focus === 'function') el.traceCloseButton.focus();
      return true;
    }

    (el.tabs || []).forEach(node => node.addEventListener('click', function () { selectTab(node.dataset.tab); }));
    (el.tabs || []).forEach(function(node, index) {
      node.addEventListener('keydown', function(event) {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const offset = event.key === 'ArrowRight' ? 1 : -1;
        const next = el.tabs[(index + offset + el.tabs.length) % el.tabs.length];
        selectTab(next.dataset.tab); next.focus();
      });
    });
    if (el.closeButton) el.closeButton.addEventListener('click', closeCenter);
    if (el.backdrop) el.backdrop.addEventListener('click', closeCenter);
    function setupManualForm(type, trigger) {
      const controls = el.manualForms && el.manualForms[type];
      if (!controls || !controls.form || !controls.input) return;
      function openForm() { controls.form.hidden = false; controls.input.focus(); }
      function cancelForm() { controls.input.value = ''; controls.form.hidden = true; }
      function submitForm(event) {
        if (event && event.preventDefault) event.preventDefault();
        const result = emit('addMemory', { type: type, content: controls.input.value, source: 'manual' });
        if (result && result.ok === true) cancelForm();
      }
      if (trigger) trigger.addEventListener('click', openForm);
      controls.form.addEventListener('submit', submitForm);
      if (controls.cancel) controls.cancel.addEventListener('click', cancelForm);
    }
    setupManualForm('history_event', el.addHistory);
    setupManualForm('key_info', el.addKeyInfo);
    if (el.promptBar) {
      el.promptBar.addEventListener('click', openCandidateSheet);
      el.promptBar.addEventListener('keydown', function(event) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openCandidateSheet(); } });
    }
    if (el.candidateCloseButton) el.candidateCloseButton.addEventListener('click', closeCandidateSheet);
    if (el.candidateBackdrop) el.candidateBackdrop.addEventListener('click', closeCandidateSheet);
    if (el.candidateCenterButton) el.candidateCenterButton.addEventListener('click', function() { closeCandidateSheet(); openCenter('pending'); });
    if (el.traceCloseButton) el.traceCloseButton.addEventListener('click', closeTrace);
    if (el.traceBackdrop) el.traceBackdrop.addEventListener('click', closeTrace);
    if (el.storageWarningCloseButton) el.storageWarningCloseButton.addEventListener('click', closeStorageWarning);
    if (el.storageWarningExportButton) el.storageWarningExportButton.addEventListener('click', function () {
      if (el.exportButton && typeof el.exportButton.click === 'function') el.exportButton.click();
    });
    Object.keys(el.sceneFields || {}).forEach(function(key) { el.sceneFields[key].addEventListener('input', function () { sceneDrafts[key] = el.sceneFields[key].value; }); });
    if (el.saveScene) el.saveScene.addEventListener('click', function () {
      const patch = {}; Object.keys(el.sceneFields || {}).forEach(key => { patch[key] = key === 'presentCharacters' ? el.sceneFields[key].value.split(',').map(item => item.trim()).filter(Boolean) : el.sceneFields[key].value; });
      const result = emit('patchScene', patch);
      if (result && result.ok === true) Object.keys(el.sceneFields || {}).forEach(key => { delete sceneDrafts[key]; });
    });
    if (el.clearScene) el.clearScene.addEventListener('click', function () {
      if (!global.confirm('清空当前场景？')) return;
      const result = emit('clearScene');
      if (result && result.ok === true) {
        Object.keys(sceneDrafts).forEach(key => { delete sceneDrafts[key]; });
        renderScene();
      }
    });
    if (el.analyzeButton) el.analyzeButton.addEventListener('click', function () {
      const button = el.analyzeButton;
      const originalText = button.textContent;
      button.disabled = true;
      button.textContent = '正在整理…';
      let result;
      try { result = emit('manual-analyze', { force: true }); }
      catch (_) { result = Promise.reject(new Error('manual analysis failed')); }
      Promise.resolve(result).finally(function () {
        button.disabled = false;
        button.textContent = originalText;
      }).catch(function () {
        showAnalysisFailure('整理失败，请稍后重试。');
      });
    });
    document.addEventListener('keydown', function(event) {
      if (el.storageWarningOverlay && !el.storageWarningOverlay.hidden) {
        if (event.key === 'Escape') { event.preventDefault(); closeStorageWarning(); }
        else if (event.key === 'Tab') {
          const storageNodes = [el.storageWarningExportButton, el.storageWarningCloseButton].filter(function(node) { return node && !node.disabled && !node.hidden; });
          if (storageNodes.length) {
            const storageFirst = storageNodes[0], storageLast = storageNodes[storageNodes.length - 1];
            if (event.shiftKey && document.activeElement === storageFirst) { event.preventDefault(); storageLast.focus(); }
            else if (!event.shiftKey && document.activeElement === storageLast) { event.preventDefault(); storageFirst.focus(); }
          }
        }
        return;
      }
      if (el.traceOverlay && !el.traceOverlay.hidden) {
        if (event.key === 'Escape') { event.preventDefault(); closeTrace(); return; }
        if (event.key !== 'Tab' || !el.traceOverlay.querySelectorAll) return;
        const traceNodes = Array.from(el.traceOverlay.querySelectorAll('button:not([disabled]),[tabindex]:not([tabindex="-1"])'))
          .filter(node => !(typeof node.closest === 'function' && node.closest('[hidden]')));
        if (!traceNodes.length) return;
        const traceFirst = traceNodes[0], traceLast = traceNodes[traceNodes.length - 1];
        if (event.shiftKey && document.activeElement === traceFirst) { event.preventDefault(); traceLast.focus(); }
        else if (!event.shiftKey && document.activeElement === traceLast) { event.preventDefault(); traceFirst.focus(); }
        return;
      }
      if (el.candidateSheet && !el.candidateSheet.hidden) {
        if (event.key === 'Escape') { event.preventDefault(); closeCandidateSheet(); return; }
        if (event.key !== 'Tab') return;
        const candidateNodes = candidateFocusable();
        if (!candidateNodes.length) return;
        const candidateFirst = candidateNodes[0], candidateLast = candidateNodes[candidateNodes.length - 1];
        if (event.shiftKey && document.activeElement === candidateFirst) { event.preventDefault(); candidateLast.focus(); }
        else if (!event.shiftKey && document.activeElement === candidateLast) { event.preventDefault(); candidateFirst.focus(); }
        return;
      }
      if (!el.overlay.classList.contains('active')) return;
      if (event.key === 'Escape') { event.preventDefault(); closeCenter(); return; }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(el.overlay.querySelectorAll('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'))
        .filter(node => !(typeof node.closest === 'function' && node.closest('[hidden]')));
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    return { render, openCenter, closeCenter, openCandidateSheet, closeCandidateSheet, openSource, openTrace, closeTrace, closeStorageWarning, showAnalysisFailure, showStorageWarning, on };
  }

  global.FonlingMemory = global.FonlingMemory || {};
  global.FonlingMemory.UI = { createMemoryUI };
})(globalThis);
