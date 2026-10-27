import test from 'node:test'
import assert from 'node:assert/strict'
import { Ledger } from '../src/ledger.mjs'
import { parsePost, convergence, sizePosition, runKolCycle } from '../src/kol.mjs'

const CFG = {
  tokens: ['SOL', 'ARB', 'ETH'],
  windowHours: 6,
  minKols: 3,
  minScore: 1.2,
  risk: { equityUsd: 1000, riskFraction: 0.01, stopPct: 0.03, targetR: 2, maxNotionalUsd: 300 },
}

const post = (kol, ts, text) => ({ kol, ts, text })

test('a post is parsed into token, direction, conviction and urgency', () => {
  const o = parsePost(post('alice', '2026-10-27T10:00:00Z', '$SOL breakout now, adding more, high conviction'), CFG)
  assert.deepEqual(o.tokens, ['SOL'])
  assert.equal(o.direction, 1)
  assert.equal(o.conviction, 0.9)
  assert.equal(o.urgency, 0.25)
  assert.equal(o.textHash.length, 64)
})

test('a hedged post carries less conviction than the same post without the hedge', () => {
  const plain = parsePost(post('bob', '2026-10-27T10:00:00Z', 'SOL breakout, adding'), CFG)
  const hedged = parsePost(post('bob', '2026-10-27T10:00:00Z', 'SOL breakout, adding, maybe, not sure'), CFG)
  assert.ok(hedged.conviction < plain.conviction, 'hedge must lower conviction')
  assert.equal(hedged.conviction, Number((plain.conviction * 0.5).toFixed(2)))
})

test('three distinct voices pass the gate, two do not', () => {
  const three = ['a', 'b', 'c'].map(k => post(k, '2026-10-27T10:0' + k.charCodeAt(0) % 10 + ':00Z', '$SOL breakout, adding'))
  const obs3 = three.map(p => parsePost(p, CFG))
  const sig3 = convergence(obs3, CFG).find(s => s.token === 'SOL')
  assert.equal(sig3.distinctKols, 3)
  assert.equal(sig3.passed, true)

  const obs2 = obs3.slice(0, 2)
  const sig2 = convergence(obs2, CFG).find(s => s.token === 'SOL')
  assert.equal(sig2.distinctKols, 2)
  assert.equal(sig2.passed, false)
  assert.match(sig2.reason, /2\/3/)
})

test('bearish agreement never produces a long signal', () => {
  const posts = ['a', 'b', 'c'].map(k => post(k, '2026-10-27T10:00:00Z', 'ETH bearish, fading, risk off'))
  const sig = convergence(posts.map(p => parsePost(p, CFG)), CFG)
  assert.equal(sig.find(s => s.token === 'ETH' && s.direction === 'long'), undefined)
})

test('sizing follows the user risk limit and the notional cap binds', () => {
  const signal = { token: 'SOL', score: 3, distinctKols: 4, evidence: [] }
  const sized = sizePosition(signal, 190.5, CFG.risk)
  assert.equal(sized.notional, 300)
  assert.equal(sized.capped, true)
  assert.ok(sized.riskUsd <= 10, 'risk per trade stays at 1% of equity')
  assert.ok(sized.stop < 190.5 && sized.target > 190.5)
  assert.match(sized.note, /capped/)

  const small = sizePosition(signal, 190.5, { ...CFG.risk, maxNotionalUsd: 5000 })
  assert.equal(small.capped, false)
  assert.ok(Math.abs(small.notional - 333.33) < 0.5)
})

test('one cycle records observations, a decision and a position, and the chain verifies', () => {
  const posts = [
    post('a', '2026-10-27T10:00:00Z', '$SOL breakout, adding'),
    post('b', '2026-10-27T10:10:00Z', 'SOL strong, accumulating'),
    post('c', '2026-10-27T10:20:00Z', 'SOL bid, up only'),
    post('d', '2026-10-27T10:30:00Z', 'ARB bullish, small size'),
  ]
  const run = () => {
    const ledger = new Ledger(null)
    const out = runKolCycle({ posts, prices: { SOL: 190.5, ARB: 0.62 }, config: CFG, ledger, now: () => '2026-10-27T10:35:00Z' })
    return { ledger, out }
  }
  const a = run()
  const b = run()
  assert.equal(a.out.decisions.find(d => d.token === 'SOL').action, 'PAPER_LONG')
  assert.equal(a.out.decisions.find(d => d.token === 'ARB').action, 'NO_TRADE')
  assert.equal(a.ledger.ofType('kol_observation').length, 4)
  assert.equal(a.ledger.ofType('kol_decision').length, 2)
  assert.equal(a.ledger.ofType('kol_position').length, 1)
  const v = a.ledger.verify()
  assert.equal(v.ok, true)
  // Determinism: same posts, same rules, same head.
  assert.equal(a.ledger.verify().head, b.ledger.verify().head)
})
