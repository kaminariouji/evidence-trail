import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runOnce } from '../src/agent.mjs'
import { replay } from '../src/replay.mjs'
import { Ledger } from '../src/ledger.mjs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crossCheck } from '../src/evidence.mjs'

const F1 = 'fixtures/btc-2026-08-20.json'
const F2 = 'fixtures/btc-2026-08-27.json'

test('a full cycle opens a practice trade and the trail replays', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'et-e2e-'))
  const path = join(dir, 'trail.jsonl')

  await runOnce({ symbols: ['BTCUSDT'], ledger: path, equity: 10000, fixture: F1 })
  const l1 = new Ledger(path)
  assert.equal(l1.verify().ok, true)
  const opens = l1.ofType('trade_open')
  assert.equal(opens.length, 1)
  assert.equal(opens[0].payload.mode, 'paper')
  assert.ok(opens[0].payload.stop < opens[0].payload.entry)
  assert.ok(opens[0].payload.take > opens[0].payload.entry)

  await runOnce({ symbols: ['BTCUSDT'], ledger: path, equity: 10000, fixture: F2 })
  const l2 = new Ledger(path)
  assert.equal(l2.verify().ok, true)
  const closes = l2.ofType('trade_close')
  assert.equal(closes.length, 1, 'the open position should settle once price crosses stop or target')
  assert.ok(Number.isFinite(closes[0].payload.pnl_usd))

  const r = replay(path, [F1, F2])
  assert.equal(r.chain.ok, true)
  assert.equal(r.ok, true)
  assert.ok(r.decisions.every(d => d.match))
  assert.ok(r.evidence.every(e => e.status === 'rehash-match'))
})

test('the decision record points back at the evidence it used', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'et-link-'))
  const path = join(dir, 'trail.jsonl')
  await runOnce({ symbols: ['BTCUSDT'], ledger: path, equity: 10000, fixture: F1 })
  const l = new Ledger(path)
  const ev = l.ofType('evidence')[0]
  const dec = l.ofType('decision')[0]
  assert.equal(dec.payload.evidence_seq, ev.seq)
  assert.ok(ev.payload.provenance.length > 0)
  assert.match(ev.payload.candles_sha256, /^[0-9a-f]{64}$/)
})

test('venue divergence is surfaced, not silently ignored', () => {
  const ok = crossCheck(100, 100.5)
  assert.equal(ok.ok, true)
  const bad = crossCheck(100, 130)
  assert.equal(bad.ok, false)
  const missing = crossCheck(100, null)
  assert.equal(missing.ok, null)
})
