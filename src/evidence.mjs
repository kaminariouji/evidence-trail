import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

/**
 * Evidence collection.
 *
 * Every observation carries its own provenance: where it came from, when it was
 * read, and a sha256 of the exact bytes received. The ledger then commits to
 * those hashes, so a verdict can be traced back to the raw data behind it.
 */

const UA = { 'user-agent': 'evidence-trail/1.0 (+practice-trade-research)' }

export function sha256(text) {
  return createHash('sha256').update(text).digest('hex')
}

async function getJson(url, timeoutMs = 15000) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { headers: UA, signal: ctl.signal })
    const text = await res.text()
    if (!res.ok) throw new Error('HTTP ' + res.status + ' from ' + url)
    return { json: JSON.parse(text), raw: text, url, fetched_at: new Date().toISOString() }
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchCandles(symbol, interval = '1d', limit = 60) {
  const url = 'https://api.binance.com/api/v3/klines?symbol=' + encodeURIComponent(symbol) + '&interval=' + interval + '&limit=' + limit
  const { json, raw, fetched_at } = await getJson(url)
  const candles = json.map(k => ({
    open_time: Number(k[0]),
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]),
  }))
  return { candles, provenance: { kind: 'ohlcv', source: 'binance-spot', url, fetched_at, raw_sha256: sha256(raw), bars: candles.length } }
}

export async function fetchFunding(symbol) {
  const url = 'https://fapi.binance.com/fapi/v1/premiumIndex?symbol=' + encodeURIComponent(symbol)
  try {
    const { json, raw, fetched_at } = await getJson(url)
    const rate = Number(json.lastFundingRate)
    if (!Number.isFinite(rate)) throw new Error('lastFundingRate missing')
    return { funding8h: rate, provenance: { kind: 'funding', source: 'binance-usdm-futures', url, fetched_at, raw_sha256: sha256(raw) } }
  } catch (err) {
    return { funding8h: null, provenance: { kind: 'funding', source: 'binance-usdm-futures', url, error: String(err.message || err) } }
  }
}

export async function fetchSpotCrossCheck(symbol) {
  const base = symbol.replace(/USDT$|USD$/, '')
  const url = 'https://api.coinbase.com/v2/prices/' + base + '-USD/spot'
  try {
    const { json, raw, fetched_at } = await getJson(url)
    return { price: Number(json?.data?.amount), provenance: { kind: 'spot_crosscheck', source: 'coinbase-spot', url, fetched_at, raw_sha256: sha256(raw) } }
  } catch (err) {
    return { price: null, provenance: { kind: 'spot_crosscheck', source: 'coinbase-spot', url, error: String(err.message || err) } }
  }
}

/** Divergence between the venue we trade and an independent venue. Large gaps mean the reading is unsafe. */
export function crossCheck(candleClose, otherPrice) {
  if (otherPrice == null || !candleClose) return { ok: null, divergence: null, note: 'cross-check unavailable' }
  const divergence = (candleClose - otherPrice) / otherPrice
  const ok = Math.abs(divergence) < 0.01
  return { ok, divergence, note: ok ? 'venues agree within 1%' : 'venues diverge ' + (divergence * 100).toFixed(2) + '% — evidence treated as unreliable' }
}

export async function collect(symbol) {
  const [c, f, x] = await Promise.all([fetchCandles(symbol), fetchFunding(symbol), fetchSpotCrossCheck(symbol)])
  return { symbol, candles: c.candles, funding8h: f.funding8h, crosscheck: x.price, provenance: [c.provenance, f.provenance, x.provenance] }
}

/** Offline replay of a recorded evidence file. No network access at all. */
export function collectFromFixture(path) {
  const doc = JSON.parse(readFileSync(path, 'utf8'))
  return doc
}
