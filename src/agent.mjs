import { Ledger } from './ledger.mjs'
import { collect, collectFromFixture, crossCheck, sha256 } from './evidence.mjs'
import { featuresFromCandles, decide, planTrade, atrFromCandles } from './rules.mjs'
import { isMain } from './cli.mjs'

/**
 * One agent cycle:
 *   observe evidence -> derive features -> apply rules -> size a practice trade
 *   -> settle any open practice positions -> write everything to the ledger.
 *
 * Nothing here touches a real exchange. Positions are paper only; the point is
 * the recorded chain of cause and effect, not a P&L claim.
 */

const DEFAULT_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']

export function parseArgs(argv) {
  const out = { symbols: DEFAULT_SYMBOLS, ledger: 'data/trail.jsonl', equity: 10000, fixture: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--symbols') out.symbols = argv[++i].split(',').map(s => s.trim().toUpperCase())
    else if (a === '--ledger') out.ledger = argv[++i]
    else if (a === '--equity') out.equity = Number(argv[++i])
    else if (a === '--fixture') out.fixture = argv[++i]
  }
  return out
}

export function settleOpenPositions(ledger, prices) {
  const closed = []
  for (const entry of ledger.ofType('trade_open')) {
    const id = entry.payload.trade_id
    const already = ledger.ofType('trade_close').some(c => c.payload.trade_id === id)
    if (already) continue
    const p = entry.payload
    const price = prices[p.symbol]
    if (price == null) continue
    let exit = null, why = null
    if (price <= p.stop) { exit = p.stop; why = 'stop hit (daily close ' + price + ')' }
    else if (price >= p.take) { exit = p.take; why = 'target hit (daily close ' + price + ')' }
    if (exit == null) continue
    const pnl = (exit - p.entry) * p.size
    closed.push(ledger.append('trade_close', {
      trade_id: id, symbol: p.symbol, exit: Number(exit.toFixed(8)), reason: why,
      pnl_usd: Number(pnl.toFixed(4)), r_multiple: Number((pnl / p.risk_amount).toFixed(4)),
    }))
  }
  return closed
}

export async function runOnce(opts) {
  const ledger = new Ledger(opts.ledger)
  const cycleTs = new Date().toISOString()

  const observations = []
  for (const symbol of opts.symbols) {
    let ev
    if (opts.fixture) {
      const doc = collectFromFixture(opts.fixture)
      ev = Array.isArray(doc) ? doc.find(d => d.symbol === symbol) : doc[symbol]
      if (!ev) throw new Error('fixture has no entry for ' + symbol)
    } else {
      ev = await collect(symbol)
    }
    observations.push(ev)
  }

  const prices = {}
  for (const ev of observations) prices[ev.symbol] = ev.candles[ev.candles.length - 1].close
  settleOpenPositions(ledger, prices)

  for (const ev of observations) {
    const last = ev.candles[ev.candles.length - 1]
    const evidencePayload = {
      symbol: ev.symbol,
      last_close: last.close,
      bars: ev.candles.length,
      funding8h: ev.funding8h ?? null,
      crosscheck_price: ev.crosscheck ?? null,
      provenance: ev.provenance,
      // commit to the exact candle series so a later edit is detectable
      candles_sha256: sha256(JSON.stringify(ev.candles)),
    }
    const evidenceRec = ledger.append('evidence', evidencePayload)

    const features = featuresFromCandles(ev.candles, { funding8h: ev.funding8h })
    const check = crossCheck(last.close, ev.crosscheck ?? null)
    const decision = decide(features)
    const atr = atrFromCandles(ev.candles)

    let plan
    if (check.ok === false) {
      plan = { action: 'NO_TRADE', reason: 'cross-venue divergence — evidence unreliable: ' + check.note }
    } else {
      plan = planTrade({ verdict: decision.verdict, features, equity: opts.equity, atr })
    }

    const decisionRec = ledger.append('decision', {
      symbol: ev.symbol,
      evidence_seq: evidenceRec.seq,
      features: {
        close: features.close, sma20: Number(features.sma20.toFixed(8)),
        ret24h: features.ret24h == null ? null : Number(features.ret24h.toFixed(6)),
        volumeZ: features.volumeZ == null ? null : Number(features.volumeZ.toFixed(4)),
        drawdown: Number(features.drawdown.toFixed(6)),
        funding8h: features.funding8h, atr: atr == null ? null : Number(atr.toFixed(8)),
      },
      score: decision.score,
      verdict: decision.verdict,
      trace: decision.trace,
      crosscheck: check,
      plan,
    })

    if (plan.action === 'OPEN_PRACTICE_LONG') {
      const id = 'pt-' + decisionRec.seq + '-' + ev.symbol
      const open = ledger.ofType('trade_open').some(t => t.payload.trade_id === id)
      if (!open) {
        ledger.append('trade_open', {
          trade_id: id, symbol: ev.symbol, decision_seq: decisionRec.seq,
          entry: plan.entry, stop: plan.stop, take: plan.take, size: plan.size,
          notional: plan.notional, risk_amount: plan.risk_amount, mode: 'paper',
        })
      }
    }

    console.log(
      (ev.symbol + '            ').slice(0, 10),
      ('score ' + decision.score).padEnd(11),
      decision.verdict.padEnd(12),
      plan.action,
      plan.action === 'OPEN_PRACTICE_LONG' ? ('entry ' + plan.entry + ' stop ' + plan.stop + ' take ' + plan.take) : ('— ' + plan.reason)
    )
  }

  const v = ledger.verify()
  console.log('')
  console.log('cycle', cycleTs)
  console.log('ledger records', ledger.entries.length, '| chain', v.ok ? 'OK' : 'BROKEN at ' + v.at, '| head', v.head.slice(0, 16) + '…')
  return ledger
}

if (isMain(import.meta.url)) {
  const opts = parseArgs(process.argv.slice(2))
  await runOnce(opts)
}
