import { rmSync, existsSync } from 'node:fs'
import { runOnce } from '../src/agent.mjs'

/**
 * Rebuilds data/demo.jsonl from scratch: two real cycles over recorded
 * historical candles, then leaves the ledger ready for `npm run replay`.
 */

const LEDGER = 'data/demo.jsonl'
if (existsSync(LEDGER)) rmSync(LEDGER)

console.log('cycle 1 — evidence as of 2026-08-20')
await runOnce({ symbols: ['BTCUSDT'], ledger: LEDGER, equity: 10000, fixture: 'fixtures/btc-2026-08-20.json' })

console.log('')
console.log('cycle 2 — evidence as of 2026-08-27')
await runOnce({ symbols: ['BTCUSDT'], ledger: LEDGER, equity: 10000, fixture: 'fixtures/btc-2026-08-27.json' })
