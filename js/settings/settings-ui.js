(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FonlingSettings = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  function clean(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  var DEFAULT_BACKGROUND_FOCUS = Object.freeze({ x: 50, y: 35 });

  function finiteNumber(value, fallback) {
    var number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function rounded(value) {
    return Math.round(value * 10000) / 10000;
  }

  function normalizeBackgroundFocus(value) {
    var source = value && typeof value === 'object' ? value : {};
    return {
      x: rounded(clamp(finiteNumber(source.x, DEFAULT_BACKGROUND_FOCUS.x), 0, 100)),
      y: rounded(clamp(finiteNumber(source.y, DEFAULT_BACKGROUND_FOCUS.y), 0, 100))
    };
  }

  function getCoverMetrics(input) {
    var source = input && typeof input === 'object' ? input : {};
    var imageWidth = Math.max(0, finiteNumber(source.imageWidth, 0));
    var imageHeight = Math.max(0, finiteNumber(source.imageHeight, 0));
    var frameWidth = Math.max(0, finiteNumber(source.frameWidth, 0));
    var frameHeight = Math.max(0, finiteNumber(source.frameHeight, 0));
    if (!imageWidth || !imageHeight || !frameWidth || !frameHeight) {
      return { scale: 0, renderedWidth: 0, renderedHeight: 0, overflowX: 0, overflowY: 0 };
    }
    var scale = Math.max(frameWidth / imageWidth, frameHeight / imageHeight);
    var renderedWidth = imageWidth * scale;
    var renderedHeight = imageHeight * scale;
    return {
      scale: rounded(scale),
      renderedWidth: rounded(renderedWidth),
      renderedHeight: rounded(renderedHeight),
      overflowX: rounded(Math.max(0, renderedWidth - frameWidth)),
      overflowY: rounded(Math.max(0, renderedHeight - frameHeight))
    };
  }

  function focusAfterDrag(input) {
    var source = input && typeof input === 'object' ? input : {};
    var focus = normalizeBackgroundFocus(source.focus);
    var metrics = source.metrics && typeof source.metrics === 'object' ? source.metrics : {};
    var overflowX = Math.max(0, finiteNumber(metrics.overflowX, 0));
    var overflowY = Math.max(0, finiteNumber(metrics.overflowY, 0));
    var x = overflowX ? focus.x - finiteNumber(source.deltaX, 0) / overflowX * 100 : focus.x;
    var y = overflowY ? focus.y - finiteNumber(source.deltaY, 0) / overflowY * 100 : focus.y;
    return normalizeBackgroundFocus({ x: x, y: y });
  }

  function getOverview(snapshot) {
    var source = snapshot && typeof snapshot === 'object' ? snapshot : {};
    var chapters = Array.isArray(source.chapters) ? source.chapters : [];
    var roles = Array.isArray(source.roles) ? source.roles : [];
    var active = chapters.find(function(chapter) {
      return chapter && chapter.id === source.activeChapterId && chapter.status === 'active';
    });
    var pending = chapters.filter(function(chapter) {
      var status = chapter && chapter.summary && chapter.summary.draftStatus;
      return chapter && chapter.status === 'ended' && ['ready', 'failed'].indexOf(status) !== -1;
    }).length;

    return {
      characterName: clean(source.currentCharacter) || '未登录',
      chapterText: '当前章节：' + (active && clean(active.name) ? clean(active.name) : '无'),
      identityDetail: roles.length ? '主控身份、' + roles.length + ' 个切换身份' : '主控身份、暂无切换身份',
      pendingSummaryCount: pending,
      chapterDetail: pending ? '有 ' + pending + ' 份新摘要待确认' : '章节、摘要与长期记忆'
    };
  }

  function createNavigator(viewNames) {
    var views = Array.isArray(viewNames) && viewNames.length ? viewNames.slice() : ['home'];
    var view = views.indexOf('home') === -1 ? views[0] : 'home';
    var editorState = { open: false, key: '', title: '', original: '', draft: '', dirty: false };

    function resetEditor() {
      editorState = { open: false, key: '', title: '', original: '', draft: '', dirty: false };
    }

    return {
      currentView: function() { return view; },
      openView: function(next) {
        if (views.indexOf(next) === -1) return false;
        view = next;
        return true;
      },
      goHome: function() { view = views.indexOf('home') === -1 ? views[0] : 'home'; },
      beginEdit: function(input) {
        var value = input && typeof input.value === 'string' ? input.value : '';
        editorState = {
          open: true,
          key: clean(input && input.key),
          title: clean(input && input.title),
          original: value,
          draft: value,
          dirty: false
        };
        return Object.assign({}, editorState);
      },
      updateDraft: function(value) {
        if (!editorState.open) return Object.assign({}, editorState);
        editorState.draft = typeof value === 'string' ? value : '';
        editorState.dirty = editorState.draft !== editorState.original;
        return Object.assign({}, editorState);
      },
      editor: function() { return Object.assign({}, editorState); },
      commitEditor: function() {
        var result = Object.assign({}, editorState);
        resetEditor();
        return result;
      },
      canCloseEditor: function(confirmDiscard) {
        if (!editorState.open) return true;
        if (editorState.dirty && typeof confirmDiscard === 'function' && !confirmDiscard()) return false;
        resetEditor();
        return true;
      }
    };
  }

  return {
    DEFAULT_BACKGROUND_FOCUS: DEFAULT_BACKGROUND_FOCUS,
    normalizeBackgroundFocus: normalizeBackgroundFocus,
    getCoverMetrics: getCoverMetrics,
    focusAfterDrag: focusAfterDrag,
    getOverview: getOverview,
    createNavigator: createNavigator
  };
});
