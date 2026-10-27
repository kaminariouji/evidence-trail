/**
 * Multi-KOL narrative agent.
 *
 * The bounty's spotlight asks for an agent that watches a set of market voices,
 * extracts what they say about a token, and turns agreement between them into a
 * practice position with transparent rules and user-defined risk limits. This is
 * that agent, and it is built the same way as src/rules.mjs: every step is a
 * named rule with a one-line rationale, and the same posts must always produce
 * the same signal. No model, no scoring hidden in a weight file.
 *
 * Pipeline: parse each post -> find convergence inside a time window -> size the
 * practice position from the user's own limits -> append the whole thing to the
 * hash-chained ledger, including a sha256 of every post that was used.
 */
import { createHash } from 'node:crypto'

export const BULL = ['bullish', 'buy', 'long', 'accumulate', 'accumulating', 'loading', 'add', 'adding', 'breakout', 'moon', 'higher', 'up only', 'bid']
export const BEAR = ['bearish', 'sell', 'short', 'dump', 'exit', 'exiting', 'down', 'lower', 'risk off', 'fade']
export const HEDGE = ['maybe', 'not sure', 'unsure', 'small', 'tiny', 'watching', 'watching only', 'no position', 'could go either way']
export const STRONG = ['high conviction', 'conviction', 'all in', 'heavy', 'size', 'sizing up', 'adding more', 'max', 'core']
export const URGENT = ['now', 'today', 'right now', 'before', 'this week', 'breaking', 'immediately', 'asap']

const has = (text, words) => words.some(w => text.includes(w))

export function sha256(text) {
  return createHash('sha256').update(String(text), 'utf8').digest('hex')
}

/**
 * One post -> one observation. Everything here is a string match or a count, so
 * a reader can re-derive it by hand.
 */
export function parsePost(post, { tokens = [] } = {}) {
  const text = String(post.text || '').toLowerCase()
  const found = new Set()
  for (const m of String(post.text || '').matchAll(/\$([A-Za-z]{2,10})/g)) found.add(m[1].toUpperCase())
  for (const t of tokens) {
    const re = new RegExp('\\b' + t.toLowerCase() + '\\b')
    if (re.test(text)) found.add(t.toUpperCase())
  }
  const bull = BULL.filter(w => text.includes(w))
  const bear = BEAR.filter(w => text.includes(w))
  const hedge = HEDGE.filter(w => text.includes(w))
  const strong = STRONG.filter(w => text.includes(w))
  const urgent = URGENT.filter(w => text.includes(w))
  const direction = bull.length === bear.length ? 0 : bull.length > bear.length ? 1 : -1
  // Conviction starts at 0.5 and moves with the language actually used, then a
  // hedge halves it. A post that hedges cannot outvote one that does not.
  let conviction = 0.5 + 0.2 * Math.min(strong.length, 2) - 0.15 * Math.max(bear.length - bull.length, 0)
  if (hedge.length) conviction *= 0.5
  conviction = Math.max(0, Math.min(1, Number(conviction.toFixed(2))))
  const urgency = Math.min(1, Number((0.25 * urgent.length).toFixed(2)))
  return {
    kol: String(post.kol || ''),
    ts: post.ts,
    tokens: [...found],
    direction,
    bull,
    bear,
    hedge,
    strong,
    urgent,
    conviction,
    urgency,
    textHash: sha256(post.text || ''),
  }
}

/**
 * Convergence: distinct voices, same token, same direction, inside a window.
 * Score is the sum of conviction * (1 + urgency) over the posts, so three calm
 * posts can outrank one loud one, and the count of distinct KOLs is a hard gate
 * rather than something folded into the score.
 */
export function convergence(observations, config) {
  const { windowHours = 6, minKols = 3, minScore = 1.2 } = config
  const out = []
  const byToken = new Map()
  for (const o of observations) {
    for (const t of o.tokens) {
      if (!byToken.has(t)) byToken.set(t, [])
      byToken.get(t).push(o)
    }
  }
  for (const [token, all] of byToken) {
    const bull = all.filter(o => o.direction > 0)
    if (!bull.length) continue
    const latest = Math.max(...bull.map(o => Date.parse(o.ts)))
    const inWindow = bull.filter(o => latest - Date.parse(o.ts) <= windowHours * 3600 * 1000)
    const kols = [...new Set(inWindow.map(o => o.kol))]
    const score = Number(inWindow.reduce((s, o) => s + o.conviction * (1 + o.urgency), 0).toFixed(2))
    const bearInWindow = all.filter(o => o.direction < 0 && latest - Date.parse(o.ts) <= windowHours * 3600 * 1000)
    const bearKols = [...new Set(bearInWindow.map(o => o.kol))]
    const passed = kols.length >= minKols && score >= minScore
    out.push({
      token,
      direction: 'long',
      distinctKols: kols.length,
      kols,
      bearKols,
      score,
      passed,
      reason: passed
        ? kols.length + ' distinct voices agree, weighted score ' + score + ' >= ' + minScore
        : kols.length + '/' + minKols + ' distinct voices, score ' + score + '/' + minScore,
      evidence: inWindow.map(o => ({ kol: o.kol, ts: o.ts, textHash: o.textHash, conviction: o.conviction, urgency: o.urgency })),
    })
  }
  return out.sort((a, b) => b.score - a.score)
}

/**
 * Sizing is the user's, not the agent's: risk per trade is a fraction of equity,
 * the stop sets the distance, and the notional cap is absolute. If the cap binds,
 * the position shrinks; it never silently raises risk.
 */
export function sizePosition(signal, price, risk) {
  const { equityUsd, riskFraction = 0.01, stopPct = 0.03, targetR = 2, maxNotionalUsd = 500 } = risk
  const riskUsd = Number((equityUsd * riskFraction).toFixed(2))
  const stopDistance = price * stopPct
  const rawQty = riskUsd / stopDistance
  const rawNotional = rawQty * price
  const capped = rawNotional > maxNotionalUsd
  const notional = Math.min(rawNotional, maxNotionalUsd)
  const qty = Number((notional / price).toFixed(8))
  return {
    token: signal.token,
    side: 'long',
    price,
    qty,
    notional: Number(notional.toFixed(2)),
    riskUsd,
    stop: Number((price * (1 - stopPct)).toFixed(8)),
    target: Number((price * (1 + stopPct * targetR)).toFixed(8)),
    capped,
    note: capped
      ? 'notional capped at ' + maxNotionalUsd + ' USDC; risk on this trade is below ' + riskUsd + ' USDC'
      : 'risk ' + riskUsd + ' USDC at a ' + (stopPct * 100).toFixed(1) + '% stop',
  }
}

/**
 * One full cycle: observe, decide, size, record. Returns the summary and appends
 * three record types to the ledger so a judge can replay the reasoning later.
 */
export function runKolCycle({ posts, prices, config, ledger, now = () => new Date().toISOString() }) {
  const observations = posts.map(p => parsePost(p, config))
  for (const o of observations) {
    ledger.append('kol_observation', o, o.ts || now())
  }
  const signals = convergence(observations, config)
  const taken = signals.filter(s => s.passed && prices[s.token] != null)
  const decisions = []
  for (const s of signals) {
    const price = prices[s.token]
    const decision = {
      token: s.token,
      passed: s.passed,
      score: s.score,
      distinctKols: s.distinctKols,
      reason: s.reason,
      price: price == null ? null : price,
      evidence: s.evidence,
    }
    if (s.passed && price != null) {
      const position = sizePosition(s, price, config.risk)
      decision.position = position
      ledger.append('kol_position', position, now())
      decisions.push({ token: s.token, action: 'PAPER_LONG', notional: position.notional })
    } else {
      decisions.push({ token: s.token, action: s.passed ? 'NO_PRICE' : 'NO_TRADE' })
    }
    ledger.append('kol_decision', decision, now())
  }
  return { observations: observations.length, signals, decisions }
}
