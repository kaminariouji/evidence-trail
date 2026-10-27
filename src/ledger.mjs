import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * Append-only, hash-chained ledger.
 *
 * Every record commits to the hash of the record before it, so any edit to
 * history breaks every hash that follows. That is what makes the reasoning
 * trail auditable instead of just a log file.
 */

export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  const keys = Object.keys(value).sort()
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}'
}

export function hashRecord(rec) {
  const body = { seq: rec.seq, ts: rec.ts, type: rec.type, payload: rec.payload, prev: rec.prev }
  return createHash('sha256').update(canonical(body)).digest('hex')
}

export const GENESIS = '0'.repeat(64)

export class Ledger {
  constructor(path) {
    this.path = path
    this.entries = []
    if (path && existsSync(path)) {
      const raw = readFileSync(path, 'utf8').trim()
      this.entries = raw ? raw.split('\n').filter(Boolean).map(l => JSON.parse(l)) : []
    }
  }

  get last() { return this.entries[this.entries.length - 1] || null }
  get prevHash() { return this.last ? this.last.hash : GENESIS }

  append(type, payload, ts = new Date().toISOString()) {
    const rec = {
      seq: this.entries.length,
      ts,
      type,
      payload,
      prev: this.prevHash,
    }
    rec.hash = hashRecord(rec)
    this.entries.push(rec)
    if (this.path) {
      mkdirSync(dirname(this.path), { recursive: true })
      appendFileSync(this.path, JSON.stringify(rec) + '\n', 'utf8')
    }
    return rec
  }

  verify() {
    let prev = GENESIS
    for (let i = 0; i < this.entries.length; i++) {
      const rec = this.entries[i]
      if (rec.seq !== i) return { ok: false, at: i, reason: 'sequence gap' }
      if (rec.prev !== prev) return { ok: false, at: i, reason: 'prev hash mismatch' }
      if (rec.hash !== hashRecord(rec)) return { ok: false, at: i, reason: 'record hash mismatch' }
      prev = rec.hash
    }
    return { ok: true, count: this.entries.length, head: prev }
  }

  ofType(type) { return this.entries.filter(e => e.type === type) }
}

export function loadLedger(path) { return new Ledger(path) }
