import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RULES, decide, featuresFromCandles, planTrade, atrFromCandles } from '../src/rules.mjs'

function series(start, step, n = 40) {
  const out = []
  let p = start
  for (let i = 0; i < n; i++) {
    p = p * (1 + step)
    out.push({ open: p * 0.995, high: p * 1.01, low: p * 0.99, close: p, volume: 1000 + i * 10 })
  }
  return out
}

test('every rule returns a finite score and a note', () => {
  const f = featuresFromCandles(series(100, 0.005), { funding8h: 0.0001 })
  for (const r of RULES) {
    const out = r.evaluate(f)
    assert.equal(typeof out.score, 'number')
    assert.ok(Number.isFinite(out.score), r.id + ' produced non-finite score')
    assert.equal(typeof out.note, 'string')
  }
})

test('a clean uptrend is not a short', () => {
  const f = featuresFromCandles(series(100, 0.01))
  assert.ok(decide(f).score > 0)
})

test('a clean downtrend is not a long', () => {
  const f = featuresFromCandles(series(100, -0.01))
  assert.ok(decide(f).score < 0)
})

test('decisions are deterministic', () => {
  const f = featuresFromCandles(series(100, 0.004), { funding8h: 0.0002 })
  const a = decide(f)
  const b = decide(f)
  assert.deepEqual(a, b)
})

test('crowded funding lowers the score', () => {
  const c = series(100, 0.005)
  const neutral = decide(featuresFromCandles(c, { funding8h: 0 })).score
  const crowded = decide(featuresFromCandles(c, { funding8h: 0.001 })).score
  assert.ok(crowded < neutral)
})

test('a short series is rejected instead of guessed at', () => {
  assert.throws(() => featuresFromCandles([{ close: 1, volume: 1 }]))
})

test('no position is opened without a stop distance', () => {
  const f = featuresFromCandles(series(100, 0.005))
  const plan = planTrade({ verdict: 'LONG', features: f, equity: 1000, atr: 0 })
  assert.equal(plan.action, 'NO_TRADE')
})

test('position size respects the notional cap', () => {
  const f = featuresFromCandles(series(100, 0.005))
  const atr = atrFromCandles(series(100, 0.005))
  const plan = planTrade({ verdict: 'LONG', features: f, equity: 1000, atr })
  assert.ok(plan.notional <= 1000 * 0.2 + 1e-6)
  assert.ok(plan.stop < plan.entry)
  assert.ok(plan.take > plan.entry)
})

test('a non-long verdict never opens a practice position', () => {
  const f = featuresFromCandles(series(100, -0.005))
  const atr = atrFromCandles(series(100, -0.005))
  for (const v of ['FLAT', 'LEAN_SHORT', 'AVOID']) {
    assert.equal(planTrade({ verdict: v, features: f, equity: 1000, atr }).action, 'NO_TRADE')
  }
})
