import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Ledger, canonical, hashRecord, GENESIS } from '../src/ledger.mjs'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('canonical form ignores key order', () => {
  assert.equal(canonical({ a: 1, b: 2 }), canonical({ b: 2, a: 1 }))
  assert.notEqual(canonical({ a: 1 }), canonical({ a: 2 }))
})

test('first record chains to genesis', () => {
  const l = new Ledger()
  const r = l.append('note', { x: 1 })
  assert.equal(r.seq, 0)
  assert.equal(r.prev, GENESIS)
})

test('each record commits to the one before it', () => {
  const l = new Ledger()
  const a = l.append('note', { x: 1 })
  const b = l.append('note', { x: 2 })
  assert.equal(b.prev, a.hash)
})

test('verifying an untouched chain succeeds', () => {
  const l = new Ledger()
  l.append('note', { x: 1 })
  l.append('note', { x: 2 })
  assert.equal(l.verify().ok, true)
})

test('editing a payload breaks verification at that record', () => {
  const l = new Ledger()
  l.append('note', { x: 1 })
  l.append('note', { x: 2 })
  l.entries[0].payload.x = 99
  const v = l.verify()
  assert.equal(v.ok, false)
  assert.equal(v.at, 0)
})

test('dropping a record breaks verification', () => {
  const l = new Ledger()
  l.append('note', { x: 1 })
  l.append('note', { x: 2 })
  l.append('note', { x: 3 })
  l.entries.splice(1, 1)
  assert.equal(l.verify().ok, false)
})

test('re-hashing a tampered record still fails because prev no longer matches', () => {
  const l = new Ledger()
  l.append('note', { x: 1 })
  l.append('note', { x: 2 })
  l.entries[0].payload.x = 99
  l.entries[0].hash = hashRecord(l.entries[0])
  const v = l.verify()
  assert.equal(v.ok, false)
  assert.equal(v.at, 1)
  assert.equal(v.reason, 'prev hash mismatch')
})

test('ledger persists and reloads', () => {
  const dir = mkdtempSync(join(tmpdir(), 'et-'))
  const p = join(dir, 'trail.jsonl')
  const l = new Ledger(p)
  l.append('note', { x: 1 })
  l.append('note', { x: 2 })
  const again = new Ledger(p)
  assert.equal(again.entries.length, 2)
  assert.equal(again.verify().ok, true)
})
