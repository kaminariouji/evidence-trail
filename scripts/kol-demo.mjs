/**
 * One Multi-KOL cycle over a fixed, dated set of posts.
 *
 * The posts are a fixture, not a live feed: the point of the demo is that the
 * same posts always produce the same signal and the same ledger head, which is
 * what makes the reasoning checkable. A live collector would only change where
 * the posts come from.
 *
 *   node scripts/kol-demo.mjs
 *   node scripts/kol-demo.mjs --posts=data/kol-demo.jsonl --ledger=data/kol-ledger.jsonl
 */
import { readFileSync, existsSync, rmSync } from 'node:fs'
import { Ledger } from '../src/ledger.mjs'
import { runKolCycle } from '../src/kol.mjs'

const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const hit = args.find(a => a.startsWith('--' + name + '='))
  return hit ? hit.split('=').slice(1).join('=') : fallback
}

const postsPath = arg('posts', 'data/kol-demo.jsonl')
const pricesPath = arg('prices', 'data/kol-prices.json')
const configPath = arg('config', 'data/kol.config.json')
const ledgerPath = arg('ledger', 'data/kol-ledger.jsonl')

const posts = readFileSync(postsPath, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
const prices = JSON.parse(readFileSync(pricesPath, 'utf8'))
const config = JSON.parse(readFileSync(configPath, 'utf8'))

if (existsSync(ledgerPath)) rmSync(ledgerPath)
const ledger = new Ledger(ledgerPath)
const out = runKolCycle({ posts, prices, config, ledger })

const pad = (s, n) => String(s).padEnd(n)
console.log('posts        ' + out.observations + ' from ' + new Set(posts.map(p => p.kol)).size + ' voices, window ' + config.windowHours + 'h')
console.log('gate         ' + config.minKols + ' distinct voices and score >= ' + config.minScore)
console.log('')
console.log(pad('token', 8) + pad('kols', 6) + pad('score', 8) + pad('passed', 8) + 'reason')
for (const s of out.signals) {
  console.log(pad(s.token, 8) + pad(s.distinctKols, 6) + pad(s.score, 8) + pad(s.passed, 8) + s.reason)
}
console.log('')
for (const d of out.decisions) {
  if (d.action === 'PAPER_LONG') console.log('position     ' + d.token + ' paper long ' + d.notional + ' USDC')
  else console.log('decision     ' + d.token + ' ' + d.action)
}
const v = ledger.verify()
console.log('')
console.log('ledger       ' + ledgerPath + ' (' + v.count + ' records)')
console.log('chain        ' + (v.ok ? 'OK, head ' + v.head.slice(0, 16) + '…' : 'BROKEN at ' + v.at + ': ' + v.reason))
console.log('modes        every position is paper; no order routing, no keys, no custody')
