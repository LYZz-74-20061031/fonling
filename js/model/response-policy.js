(function (global) {
  'use strict';

  const ordinaryLimits = Object.freeze({
    recentMessages: 14,
    narrativeCharacters: 6000,
    memoryCharacters: 8000,
  });
  const airLimits = Object.freeze({
    recentMessages: 24,
    narrativeCharacters: 10000,
    memoryCharacters: 12000,
  });

  const ordinaryInstruction = [
    '本次为普通回复，请整体保持精炼并自然结束，不要为了篇幅补充无意义内容。',
    '将括号内的动作、神态、心理和环境描写控制在以往默认密度的一半到三分之二。',
    '优先保留对白、关键动作和实际剧情推进；不要用心理、动作和对白连续重复表达同一种情绪或信息。',
  ].join('');

  const airInstruction = [
    '本次为深度思考回复。请在作答前综合人物动机、潜台词、关系变化、前文承诺与冲突、伏笔、场景连续性和行为后果。',
    '必须维持既有人设和剧情事实，不要为了戏剧性制造矛盾。',
    '禁止重复堆砌动作或心理描写，但可为重要判断保留必要细节；内容充分时自然结束，不必填满输出上限。',
  ].join('');

  function forPlan(plan) {
    const air = Boolean(plan && plan.task === 'chat' && plan.tier === 'air');
    return Object.freeze({
      depth: air ? 'air' : 'ordinary',
      limits: air ? airLimits : ordinaryLimits,
      instruction: air ? airInstruction : ordinaryInstruction,
    });
  }

  const api = Object.freeze({ forPlan });
  global.FonlingModels = global.FonlingModels || {};
  global.FonlingModels.ResponsePolicy = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
