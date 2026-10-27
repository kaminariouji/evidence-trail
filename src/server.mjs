import { createServer } from 'node:http'
import { Ledger } from './ledger.mjs'
import { replay } from './replay.mjs'
import { isMain } from './cli.mjs'

const LEDGER = process.env.LEDGER || 'data/demo.jsonl'
const PORT = Number(process.env.PORT || 8099)

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

function page(ledger, report) {
  const decisions = ledger.ofType('decision')
  const opens = ledger.ofType('trade_open')
  const closes = ledger.ofType('trade_close')
  const chainOk = report.chain.ok

  const rows = ledger.entries.map(r => {
    const p = r.payload
    let detail = ''
    if (r.type === 'decision') {
      detail = p.trace.map(t => '<span class="rule ' + (t.score > 0 ? 'pos' : t.score < 0 ? 'neg' : 'zero') + '">' + esc(t.rule) + ' ' + (t.score > 0 ? '+' : '') + t.score + '</span>').join(' ') +
        ' <b>' + esc(p.verdict) + '</b> ' + p.score
    } else if (r.type === 'evidence') {
      detail = 'close ' + p.last_close + ' · bars ' + p.bars + ' · sha ' + esc(p.candles_sha256.slice(0, 12)) + '…'
    } else if (r.type === 'trade_open') {
      detail = 'entry ' + p.entry + ' · stop ' + p.stop + ' · take ' + p.take + ' · size ' + p.size + ' · ' + p.mode
    } else if (r.type === 'trade_close') {
      detail = 'exit ' + p.exit + ' · ' + esc(p.reason) + ' · pnl ' + p.pnl_usd + ' (' + p.r_multiple + 'R)'
    }
    return '<tr><td class="seq">' + r.seq + '</td><td><span class="type t-' + r.type + '">' + r.type + '</span></td><td class="sym">' + esc(p.symbol || '') + '</td><td>' + detail + '</td><td class="hash">' + esc(r.hash.slice(0, 10)) + '…</td></tr>'
  }).join('')

  const pnl = closes.reduce((a, c) => a + Number(c.payload.pnl_usd || 0), 0)

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Evidence Trail</title>
<style>
 :root{--bg:#0b0e14;--panel:#121722;--line:#1e2635;--fg:#e6edf7;--dim:#8b98ab;--pos:#3ddc97;--neg:#ff6b6b;--acc:#6ea8ff}
 *{box-sizing:border-box}
 body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
 header{padding:22px 26px;border-bottom:1px solid var(--line);display:flex;gap:26px;align-items:baseline;flex-wrap:wrap}
 h1{font-size:17px;margin:0;letter-spacing:.4px}
 .stat{color:var(--dim);font-size:12px}
 .stat b{color:var(--fg);font-size:14px}
 .ok{color:var(--pos)} .bad{color:var(--neg)}
 main{padding:18px 26px}
 table{width:100%;border-collapse:collapse}
 th{text-align:left;color:var(--dim);font-weight:400;font-size:11px;text-transform:uppercase;letter-spacing:.8px;border-bottom:1px solid var(--line);padding:8px 10px}
 td{padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:top}
 tr:hover td{background:#151b28}
 .seq{color:var(--dim);width:44px}
 .sym{color:var(--acc)}
 .hash{color:#54617a;font-size:12px}
 .type{font-size:11px;padding:2px 7px;border-radius:20px;border:1px solid var(--line);color:var(--dim)}
 .t-decision{border-color:#2b4a7d;color:#9cc0ff}
 .t-trade_open{border-color:#1f5c45;color:var(--pos)}
 .t-trade_close{border-color:#6b4a1f;color:#ffc46b}
 .rule{font-size:11px;padding:1px 6px;border-radius:4px;background:#182031;color:var(--dim)}
 .rule.pos{color:var(--pos)} .rule.neg{color:var(--neg)}
 footer{padding:16px 26px;color:var(--dim);font-size:12px;border-top:1px solid var(--line);margin-top:20px}
 code{color:var(--acc)}
</style></head><body>
<header>
 <h1>EVIDENCE TRAIL</h1>
 <div class="stat">chain <b class="${chainOk ? 'ok' : 'bad'}">${chainOk ? 'VERIFIED' : 'BROKEN'}</b></div>
 <div class="stat">records <b>${ledger.entries.length}</b></div>
 <div class="stat">decisions <b>${decisions.length}</b></div>
 <div class="stat">replayed <b>${report.decisions.filter(d => d.match).length}/${report.decisions.length}</b></div>
 <div class="stat">practice trades <b>${opens.length}</b> closed <b>${closes.length}</b></div>
 <div class="stat">paper pnl <b class="${pnl >= 0 ? 'ok' : 'bad'}">${pnl.toFixed(2)} USD</b></div>
 <div class="stat">head <b>${report.chain.head.slice(0, 12)}…</b></div>
</header>
<main><table>
<thead><tr><th>#</th><th>type</th><th>symbol</th><th>payload</th><th>hash</th></tr></thead>
<tbody>${rows}</tbody>
</table></main>
<footer>Paper only — no exchange keys, no orders, no funds. Every row commits to the hash above it; run <code>npm run replay</code> to re-derive each decision from its own evidence.</footer>
</body></html>`
}

export function start(port = PORT, ledgerPath = LEDGER) {
  const server = createServer((req, res) => {
    const ledger = new Ledger(ledgerPath)
    const report = replay(ledgerPath, [])
    if (req.url.startsWith('/api/trail')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ chain: report.chain, decisions: report.decisions, entries: ledger.entries }))
      return
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(page(ledger, report))
  })
  return server
}

if (isMain(import.meta.url)) {
  const s = start()
  s.listen(PORT, () => console.log('evidence trail on http://127.0.0.1:' + PORT + ' (ledger ' + LEDGER + ')'))
}
