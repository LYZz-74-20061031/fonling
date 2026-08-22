(function (global) {
  'use strict';

  function createSession(onChange) {
    let armed = false;
    let active = null;
    let sequence = 0;
    let epoch = 0;

    function snapshot() {
      return {
        armed,
        busy: Boolean(active),
        activeTier: active ? active.tier : 'free',
      };
    }

    function notify() {
      if (typeof onChange === 'function') onChange(snapshot());
    }

    function armAir() {
      if (active) return false;
      armed = !armed;
      notify();
      return true;
    }

    function cancelPending() {
      if (active) return false;
      if (!armed) return true;
      armed = false;
      notify();
      return true;
    }

    function begin(method, forcedTier) {
      if (active) return null;
      sequence += 1;
      const tier = forcedTier || (armed ? 'air' : 'free');
      armed = false;
      active = Object.freeze({ id: `${epoch}:${sequence}`, epoch, tier, method });
      notify();
      return active;
    }

    function beginSend() {
      return begin('send');
    }

    function beginAirRegenerate() {
      return begin('regenerate', 'air');
    }

    function finish(token) {
      if (!active || !token || token.id !== active.id || token.epoch !== active.epoch) return false;
      active = null;
      armed = false;
      notify();
      return true;
    }

    function reset() {
      epoch += 1;
      armed = false;
      active = null;
      notify();
    }

    return Object.freeze({
      snapshot,
      armAir,
      cancelPending,
      beginSend,
      beginAirRegenerate,
      finish,
      reset,
    });
  }

  function timestamp(now) {
    if (typeof now === 'string' && now.trim()) return now.trim();
    const date = now instanceof Date ? now : new Date(now === undefined ? Date.now() : now);
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
  }

  function createGenerationMetadata(plan, method, now) {
    const source = plan && typeof plan === 'object' ? plan : {};
    return {
      provider: typeof source.provider === 'string' ? source.provider : '',
      model: typeof source.model === 'string' ? source.model : '',
      tier: source.tier === 'air' ? 'air' : (typeof source.tier === 'string' ? source.tier : 'free'),
      method: method === 'regenerate' ? 'regenerate' : 'send',
      generatedAt: timestamp(now),
    };
  }

  function isAirGeneration(value) {
    return Boolean(value && typeof value === 'object' && value.tier === 'air');
  }

  const api = Object.freeze({ createSession, createGenerationMetadata, isAirGeneration });
  global.FonlingModels = global.FonlingModels || {};
  global.FonlingModels.Session = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
