(function (global) {
  'use strict';

  function cleanId(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function createController() {
    const entries = new Map();

    function snapshot(id) {
      const entry = entries.get(cleanId(id));
      return entry ? { ...entry } : null;
    }

    return Object.freeze({
      begin(id) {
        const key = cleanId(id);
        if (!key) return null;
        entries.set(key, { reasoning: '', status: 'active', expanded: true });
        return snapshot(key);
      },
      update(id, reasoning) {
        const key = cleanId(id);
        const entry = entries.get(key);
        if (!entry || entry.status !== 'active') return null;
        entry.reasoning = typeof reasoning === 'string' ? reasoning : '';
        return snapshot(key);
      },
      complete(id) {
        const key = cleanId(id);
        const entry = entries.get(key);
        if (!entry) return null;
        entry.status = 'complete';
        entry.expanded = false;
        return snapshot(key);
      },
      toggle(id) {
        const key = cleanId(id);
        const entry = entries.get(key);
        if (!entry) return null;
        entry.expanded = !entry.expanded;
        return snapshot(key);
      },
      remove(id) {
        return entries.delete(cleanId(id));
      },
      clear() {
        entries.clear();
      },
      snapshot,
    });
  }

  const api = Object.freeze({ createController });
  global.FonlingModels = global.FonlingModels || {};
  global.FonlingModels.ReasoningUI = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
