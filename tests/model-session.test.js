const test = require('node:test');
const assert = require('node:assert/strict');

const Session = require('../js/model/model-session.js');

test('Air can be armed for exactly one send and is consumed when the request starts', () => {
  const session = Session.createSession();
  assert.deepEqual(session.snapshot(), { armed: false, busy: false, activeTier: 'free' });
  assert.equal(session.armAir(), true);
  assert.deepEqual(session.snapshot(), { armed: true, busy: false, activeTier: 'free' });

  const token = session.beginSend();
  assert.equal(token.tier, 'air');
  assert.equal(token.method, 'send');
  assert.deepEqual(session.snapshot(), { armed: false, busy: true, activeTier: 'air' });
  assert.equal(session.finish(token), true);
  assert.deepEqual(session.snapshot(), { armed: false, busy: false, activeTier: 'free' });

  const next = session.beginSend();
  assert.equal(next.tier, 'free');
});

test('validation before beginSend does not consume an armed Air request', () => {
  const session = Session.createSession();
  session.armAir();
  assert.equal(session.snapshot().armed, true);
  session.cancelPending();
  assert.equal(session.snapshot().armed, false);
});

test('finish restores free state after success, failure, timeout, cancellation, or save failure', () => {
  for (const outcome of ['success', 'failure', 'timeout', 'cancelled', 'save_failure']) {
    const session = Session.createSession();
    session.armAir();
    const token = session.beginSend();
    assert.equal(session.finish(token, outcome), true, outcome);
    assert.deepEqual(session.snapshot(), { armed: false, busy: false, activeTier: 'free' }, outcome);
  }
});

test('role or character reset cancels pending Air and invalidates active tokens', () => {
  const session = Session.createSession();
  session.armAir();
  session.reset();
  assert.deepEqual(session.snapshot(), { armed: false, busy: false, activeTier: 'free' });

  session.armAir();
  const stale = session.beginSend();
  session.reset();
  assert.equal(session.finish(stale), false);
  const fresh = session.beginSend();
  assert.equal(fresh.tier, 'free');
});

test('explicit deep regenerate always captures Air without arming the composer', () => {
  const session = Session.createSession();
  const token = session.beginAirRegenerate();
  assert.equal(token.tier, 'air');
  assert.equal(token.method, 'regenerate');
  assert.deepEqual(session.snapshot(), { armed: false, busy: true, activeTier: 'air' });
  session.finish(token);
  assert.deepEqual(session.snapshot(), { armed: false, busy: false, activeTier: 'free' });
});

test('a busy session rejects duplicate operations and stale finishes', () => {
  const session = Session.createSession();
  const active = session.beginSend();
  assert.equal(session.beginSend(), null);
  assert.equal(session.beginAirRegenerate(), null);
  assert.equal(session.armAir(), false);
  assert.equal(session.finish({ id: 'stale' }), false);
  assert.equal(session.finish(active), true);
});

test('generation provenance records actual provider model tier method and time', () => {
  const metadata = Session.createGenerationMetadata({
    provider: 'glm', model: 'glm-4.5-air', tier: 'air',
  }, 'regenerate', '2026-08-23T10:00:00.000Z');
  assert.deepEqual(metadata, {
    provider: 'glm', model: 'glm-4.5-air', tier: 'air',
    method: 'regenerate', generatedAt: '2026-08-23T10:00:00.000Z',
  });
  assert.equal(Session.isAirGeneration(metadata), true);
  assert.equal(Session.isAirGeneration({ tier: 'free' }), false);
});
