import { Ledger } from './ledger.mjs'
import { decide, planTrade } from './rules.mjs'
import { sha256 } from './evidence.mjs'
import { readFileSync, existsSync } from 'node:fs'
import { isMain } from './cli.mjs'

/**
 * Replay proves the trail is repeatable, in three independent layers:
 *
 *  1. chain   — every record still hashes to the hash it claims, and each one
 *               commits to its predecessor. Any edit breaks it.
 *  2. decision— re-running the rule engine on the stored features must produce
 *               the identical score and verdict. If a rule changed, this fails.
 *  3. evidence— where the original fixture is available, the candle series is
 *               re-hashed and compared with the hash recorded at decision time.
 *
 * A verdict you cannot re-derive is not evidence, it is an assertion.
 */

export function replay(ledgerPath, fixtures = []) {
  const ledger = new Ledger(ledgerPath)
  const report = { ledger: ledgerPath, records: ledger.entries.length, chain: ledger.verify(), decisions: [], evidence: [], ok: true }

  const fixtureIndex = new Map()
  for (const f of fixtures) {
    if (!existsSync(f)) continue
    const doc = JSON.parse(readFileSync(f, 'utf8'))
    for (const [symbol, ev] of Object.entries(doc)) {
      fixtureIndex.set(symbol + ':' + sha256(JSON.stringify(ev.candles)), { file: f, symbol })
    }
  }

  const evidenceBySeq = new Map(ledger.ofType('evidence').map(e => [e.seq, e]))

  for (const rec of ledger.ofType('decision')) {
    const p = rec.payload
    const again = decide(p.features)
    const scoreMatch = again.score === p.score
    const verdictMatch = again.verdict === p.verdict
    const traceMatch = JSON.stringify(again.trace) === JSON.stringify(p.trace)
    const ok = scoreMatch && verdictMatch && traceMatch
    if (!ok) report.ok = false
    report.decisions.push({
      seq: rec.seq, symbol: p.symbol, original: { score: p.score, verdict: p.verdict },
      replayed: { score: again.score, verdict: again.verdict }, match: ok,
    })
  }

  for (const ev of ledger.ofType('evidence')) {
    const p = ev.payload
    const key = p.symbol + ':' + p.candles_sha256
    const hit = fixtureIndex.get(key)
    const status = hit ? 'rehash-match' : 'source-not-supplied'
    report.evidence.push({ seq: ev.seq, symbol: p.symbol, candles_sha256: p.candles_sha256.slice(0, 16), status, file: hit?.file || null })
    if (hit === undefined) continue
  }

  if (!report.chain.ok) report.ok = false
  return report
}

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2)
  const ledgerPath = args.find(a => a.startsWith('--ledger='))?.split('=')[1] || 'data/demo.jsonl'
  const fixtures = args.filter(a => a.startsWith('--fixture=')).map(a => a.split('=')[1])
  const r = replay(ledgerPath, fixtures)
  console.log('ledger      ', r.ledger, '(' + r.records + ' records)')
  console.log('chain       ', r.chain.ok ? 'OK, head ' + r.chain.head.slice(0, 16) + '…' : 'BROKEN at ' + r.chain.at + ' — ' + r.chain.reason)
  let m = 0
  for (const d of r.decisions) {
    if (d.match) m++
    console.log('decision', String(d.seq).padEnd(4), d.symbol.padEnd(9), 'original', (d.original.verdict + ' ' + d.original.score).padEnd(18), d.match ? 're-derived identically' : 'MISMATCH -> ' + d.replayed.verdict + ' ' + d.replayed.score)
  }
  for (const e of r.evidence) console.log('evidence', String(e.seq).padEnd(4), e.symbol.padEnd(9), e.candles_sha256 + '…', e.status)
  console.log('')
  console.log(r.ok ? 'REPLAY OK — ' + m + '/' + r.decisions.length + ' decisions re-derived' : 'REPLAY FAILED')
  process.exit(r.ok ? 0 : 1)
}
