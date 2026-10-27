import { writeFileSync } from 'node:fs'
import { Ledger } from '../src/ledger.mjs'
import { replay } from '../src/replay.mjs'
import { page } from '../src/server.mjs'

/**
 * Renders the current ledger into a single static HTML file so the trail can be
 * hosted anywhere (no server, no build step, no dependencies).
 */

const ledgerPath = process.argv[2] || 'data/demo.jsonl'
const out = process.argv[3] || 'docs/index.html'

const ledger = new Ledger(ledgerPath)
const report = replay(ledgerPath, ['fixtures/btc-2026-08-20.json', 'fixtures/btc-2026-08-27.json'])
const html = page(ledger, report)
writeFileSync(out, html)
console.log('wrote', out, html.length, 'bytes | chain', report.chain.ok ? 'OK' : 'BROKEN', '| replayed', report.decisions.filter(d => d.match).length + '/' + report.decisions.length)
