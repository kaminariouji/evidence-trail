import { writeFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { featuresFromCandles, decide } from '../src/rules.mjs'

/**
 * Builds an offline evidence fixture from real exchange history.
 * Used so the demo and the tests never need the network, and so a past
 * decision can be re-derived months later from the exact same bytes.
 */

const UA = { 'user-agent': 'evidence-trail/1.0 (+practice-trade-research)' }
const sha = t => createHash('sha256').update(t).digest('hex')

async function klines(symbol, endTime, limit = 90) {
  const url = 'https://api.binance.com/api/v3/klines?symbol=' + symbol + '&interval=1d&limit=' + limit + '&endTime=' + endTime
  const r = await fetch(url, { headers: UA })
  const raw = await r.text()
  if (!r.ok) throw new Error('HTTP ' + r.status)
  const candles = JSON.parse(raw).map(k => ({ open_time: Number(k[0]), open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]), volume: Number(k[5]) }))
  return { candles, provenance: { kind: 'ohlcv', source: 'binance-spot', url, fetched_at: new Date().toISOString(), raw_sha256: sha(raw), bars: candles.length } }
}

const symbol = process.argv[2] || 'BTCUSDT'
const iso = process.argv[3] || '2026-09-01T00:00:00Z'
const out = process.argv[4]
const endTime = Date.parse(iso)

const k = await klines(symbol, endTime)
const f = featuresFromCandles(k.candles, { funding8h: null })
const d = decide(f)
const doc = { [symbol]: { symbol, candles: k.candles, funding8h: null, crosscheck: null, provenance: [k.provenance], asof: new Date(endTime).toISOString() } }
const text = JSON.stringify(doc, null, 1)
if (out) { mkdirSync('fixtures', { recursive: true }); writeFileSync(out, text) }
console.log(symbol, 'asof', new Date(endTime).toISOString().slice(0,10), 'bars', k.candles.length, 'score', d.score, d.verdict, out ? '-> ' + out : '')
