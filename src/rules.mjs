/**
 * Transparent rule engine.
 *
 * Every rule is a named, inspectable function that turns measurable evidence
 * into a signed weight plus a one-line rationale. No black boxes: given the
 * same evidence, the same verdict must come out. src/replay.mjs enforces that.
 */

export const RULES = [
  {
    id: 'trend_vs_sma20',
    weight: 1.0,
    describe: 'Close above/below the 20-period simple moving average.',
    evaluate: (f) => {
      if (f.sma20 == null) return { score: 0, note: 'not enough history for SMA20' }
      const dev = (f.close - f.sma20) / f.sma20
      if (dev >= 0.01) return { score: 1, note: 'close ' + pct(dev) + ' above SMA20' }
      if (dev <= -0.01) return { score: -1, note: 'close ' + pct(dev) + ' below SMA20' }
      return { score: 0, note: 'close within 1% of SMA20 (' + pct(dev) + ')' }
    },
  },
  {
    id: 'momentum_24h',
    weight: 1.0,
    describe: '24-hour return beyond +/-2%.',
    evaluate: (f) => {
      if (f.ret24h == null) return { score: 0, note: 'no 24h return available' }
      if (f.ret24h >= 0.02) return { score: 1, note: '24h return ' + pct(f.ret24h) }
      if (f.ret24h <= -0.02) return { score: -1, note: '24h return ' + pct(f.ret24h) }
      return { score: 0, note: '24h return flat (' + pct(f.ret24h) + ')' }
    },
  },
  {
    id: 'volume_confirmation',
    weight: 0.75,
    describe: 'Volume z-score above 1 confirms the direction of the 24h move.',
    evaluate: (f) => {
      if (f.volumeZ == null || f.ret24h == null) return { score: 0, note: 'volume history too short' }
      if (f.volumeZ < 1) return { score: 0, note: 'volume z ' + f.volumeZ.toFixed(2) + ' (no confirmation)' }
      const dir = f.ret24h > 0 ? 1 : f.ret24h < 0 ? -1 : 0
      return { score: 0.75 * dir, note: 'volume z ' + f.volumeZ.toFixed(2) + ' with ' + pct(f.ret24h) }
    },
  },
  {
    id: 'drawdown_contrarian',
    weight: 0.5,
    describe: 'A deep drawdown from the 30-period high scores contrarian only when price is already recovering.',
    evaluate: (f) => {
      if (f.drawdown == null) return { score: 0, note: 'no drawdown window' }
      if (f.drawdown <= -0.15 && f.close > f.sma20) {
        return { score: 0.5, note: 'drawdown ' + pct(f.drawdown) + ' but price back above SMA20' }
      }
      if (f.drawdown <= -0.15) {
        return { score: -0.5, note: 'drawdown ' + pct(f.drawdown) + ' with no recovery yet' }
      }
      return { score: 0, note: 'drawdown ' + pct(f.drawdown) + ' within normal range' }
    },
  },
  {
    id: 'funding_crowding',
    weight: 1.0,
    describe: 'Extreme positive funding means longs are crowded and the trade is expensive to hold.',
    evaluate: (f) => {
      if (f.funding8h == null) return { score: 0, note: 'no funding data for this venue' }
      if (f.funding8h >= 0.0005) return { score: -1, note: 'funding ' + (f.funding8h * 100).toFixed(4) + '%/8h is crowded long' }
      if (f.funding8h <= -0.0005) return { score: 0.5, note: 'funding ' + (f.funding8h * 100).toFixed(4) + '%/8h pays shorts' }
      return { score: 0, note: 'funding ' + (f.funding8h * 100).toFixed(4) + '%/8h is neutral' }
    },
  },
]

export function pct(x) { return (x * 100).toFixed(2) + '%' }

export function featuresFromCandles(candles, opts = {}) {
  const closes = candles.map(c => c.close)
  const volumes = candles.map(c => c.volume)
  if (closes.length < 2) throw new Error('need at least 2 candles')
  const close = closes[closes.length - 1]
  const win = Math.min(20, closes.length)
  const sma20 = closes.slice(-win).reduce((a, b) => a + b, 0) / win
  const prev = closes[closes.length - 2]
  const ret24h = prev ? (close - prev) / prev : null

  const vwin = volumes.slice(-20)
  const vmean = vwin.reduce((a, b) => a + b, 0) / vwin.length
  const vvar = vwin.reduce((a, b) => a + (b - vmean) ** 2, 0) / vwin.length
  const vsd = Math.sqrt(vvar)
  const volumeZ = vsd > 0 ? (volumes[volumes.length - 1] - vmean) / vsd : null

  const window30 = closes.slice(-30)
  const high30 = Math.max(...window30)
  const drawdown = (close - high30) / high30

  return {
    close, sma20, ret24h, volumeZ, drawdown,
    funding8h: opts.funding8h ?? null,
    bars: closes.length,
  }
}

export function decide(features, rules = RULES) {
  const trace = rules.map(r => {
    const out = r.evaluate(features)
    return { rule: r.id, weight: r.weight, score: Number(out.score.toFixed(4)), note: out.note }
  })
  const score = Number(trace.reduce((a, t) => a + t.score, 0).toFixed(4))
  let verdict = 'FLAT'
  if (score >= 2) verdict = 'STRONG_LONG'
  else if (score >= 1) verdict = 'LONG'
  else if (score <= -1.5) verdict = 'AVOID'
  else if (score <= -0.5) verdict = 'LEAN_SHORT'
  return { score, verdict, trace }
}

export function planTrade({ verdict, features, equity, riskPerTrade = 0.01, atr, maxNotionalFrac = 0.2 }) {
  if (verdict !== 'LONG' && verdict !== 'STRONG_LONG') {
    return { action: 'NO_TRADE', reason: 'verdict ' + verdict + ' does not open a practice position' }
  }
  if (!atr || atr <= 0) return { action: 'NO_TRADE', reason: 'ATR unavailable, cannot size a stop' }

  const entry = features.close
  const stopDist = 1.5 * atr
  const stop = entry - stopDist
  const take = entry + 2 * stopDist
  const riskAmount = equity * riskPerTrade
  const rawSize = riskAmount / stopDist
  const notionalCap = equity * maxNotionalFrac
  const size = Math.min(rawSize, notionalCap / entry)

  return {
    action: 'OPEN_PRACTICE_LONG',
    entry: round(entry),
    stop: round(stop),
    take: round(take),
    size: Number(size.toFixed(8)),
    notional: round(size * entry),
    risk_amount: round(size * stopDist),
    r_multiple_target: 2,
    reason: 'risk ' + pct(riskPerTrade) + ' of equity, stop 1.5xATR, target 2R, notional capped at ' + pct(maxNotionalFrac),
  }
}

export function atrFromCandles(candles, period = 14) {
  if (candles.length < period + 1) return null
  const slice = candles.slice(-(period + 1))
  let sum = 0
  for (let i = 1; i < slice.length; i++) {
    const c = slice[i], p = slice[i - 1]
    sum += Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close))
  }
  return sum / period
}

function round(x) { return Number(x.toPrecision(8)) }
