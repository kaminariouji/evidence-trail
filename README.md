# Evidence Trail

An agent that reads market evidence, decides whether a trade is justified, records the practice trade it *would* take, and keeps a hash-chained trail that anyone can re-derive later.

No exchange keys. No orders. No funds. Every position in this repository is paper.

---

## Why this exists

Most "AI trading agent" demos show a P&L chart and ask you to trust it. That is unfalsifiable: you cannot tell whether the result came from a rule, a lucky window, or a number typed into a spreadsheet.

Evidence Trail inverts the burden of proof. It does not ask you to believe a result. It hands you a ledger where every decision points at the exact evidence that produced it, and a replay command that recomputes the decision from that evidence. If the rule changed, replay fails. If a record was edited, the chain breaks.

The claim is not "this makes money". The claim is: **every decision here is reproducible from its own recorded evidence, or the tool tells you it is not.**

## How a cycle works

```
observe  ->  derive features  ->  apply rules  ->  size a practice trade  ->  record
```

1. **Observe.** Pull daily candles from Binance spot, the current funding rate from Binance USD-M futures, and an independent spot price from Coinbase.
2. **Derive features.** SMA20, 24h return, volume z-score, drawdown from the 30-period high, funding, ATR(14).
3. **Apply rules.** Five named rules, each returning a signed weight and a one-line rationale.
4. **Size.** Risk a fixed fraction of equity, stop at 1.5x ATR, target 2R, with a hard notional cap.
5. **Record.** Evidence, decision, and trade are appended to a hash-chained ledger. Each record commits to the hash of the one before it.

Before any of that, a **cross-venue check** compares the venue we read against an independent venue. If the two disagree by more than 1%, the evidence is treated as unreliable and no position is opened — the agent records the refusal instead of trading on a bad reading.

## The five rules

| Rule | Weight | What it asks |
|---|---|---|
| `trend_vs_sma20` | 1.00 | Is price above or below its 20-period mean? |
| `momentum_24h` | 1.00 | Did the last day move more than +/-2%? |
| `volume_confirmation` | 0.75 | Is above-average volume backing that move? |
| `drawdown_contrarian` | 0.50 | Is a deep drawdown already recovering, or still falling? |
| `funding_crowding` | 1.00 | Is the long side crowded and expensive to hold? |

Score maps to a verdict: `>= 2` STRONG_LONG, `>= 1` LONG, `<= -0.5` LEAN_SHORT, `<= -1.5` AVOID, otherwise FLAT. Only LONG and STRONG_LONG open a practice position.

The rules are deliberately simple and readable. The interesting part is not the alpha — it is that you can check the reasoning.

## Three layers of verification

`npm run replay` checks three independent things:

1. **Chain.** Every record still hashes to the hash it claims, and each one commits to its predecessor. Editing a payload breaks the record's own hash. Re-hashing the edited record then breaks the *next* record's `prev` link. There is no way to rewrite history without breaking the chain.
2. **Decision.** The rule engine is re-run on the features stored in the decision record. Score, verdict, and the full per-rule trace must come out identical. If someone changes a rule threshold, this fails loudly.
3. **Evidence.** Where the original fixture is available, the candle series is re-hashed and compared against the hash recorded at decision time. This catches edited market data.

```
$ npm run replay
ledger       data/demo.jsonl (7 records)
chain        OK, head 8344162ac78b8c2b…
decision 1   BTCUSDT  original STRONG_LONG 2.75   re-derived identically
decision 5   BTCUSDT  original LONG 1             re-derived identically
evidence 0   BTCUSDT  7e6855abbab585bc… rehash-match
evidence 4   BTCUSDT  76f6012ade8e9514… rehash-match

REPLAY OK — 2/2 decisions re-derived
```

## Live trail

The current demo ledger, rendered as a static page (no server, no build step):

**https://kaminariouji.github.io/evidence-trail/**

It shows the chain status, every record with its hash, the per-rule trace behind each decision, and the practice trades that were opened and settled. Regenerate it with `node scripts/build-static.mjs`.

## Quick start

```bash
git clone <this repo>
cd evidence-trail
node --version        # 20 or newer
npm test              # 26 tests, no network required
npm run demo          # replay a recorded two-cycle demo into data/demo.jsonl
npm run replay        # verify the chain and re-derive every decision
npm run kol           # one Multi-KOL cycle over the fixture posts
npm run serve         # dashboard on http://127.0.0.1:8099
```

Live cycle against real public endpoints (still paper, still no keys):

```bash
node src/agent.mjs --symbols BTCUSDT,ETHUSDT,SOLUSDT --ledger data/trail.jsonl
```

Offline cycle from a recorded fixture:

```bash
node src/agent.mjs --fixture fixtures/btc-2026-08-20.json --symbols BTCUSDT --ledger data/offline.jsonl
```

## The demo ledger, explained

`data/demo.jsonl` is a real two-cycle run over real historical Binance candles, recorded as fixtures so it works with no network:

- **2026-08-20** — BTC closes 5.3% up on volume z-score 3.15, price 13% above SMA20. Score 2.75, STRONG_LONG. Opens a practice long: entry 73,025.15, stop 70,573.37, target 77,928.70.
- **2026-08-27** — price has crossed the target. The position settles at 77,928.70 for +134.30 USD (2R) on 10,000 USD of paper equity. A new cycle then opens a second practice position.

That is a **paper** result on a hand-picked historical window, and it is presented as a demonstration of the mechanism, not as evidence of an edge. The rule set is trend-following; it will lose money in a choppy market, and nothing here has been validated on out-of-sample data.

## Fit with the Autonomous Agents bounty

The bounty asks for agents that "interpret market evidence and record the practice trades they would make",
where strong entries "show cause and effect and preserve a repeatable reasoning trail". This repository maps
to that sentence one clause at a time:

| Bounty clause | Where it lives |
| --- | --- |
| interpret market evidence | `src/evidence.mjs` pulls Binance klines, Binance USD-M funding and a Coinbase spot cross-check. Every observation stores `raw_sha256`, and `crossCheck` refuses to emit evidence when the two venues diverge by more than 1%. |
| record the practice trades | `src/agent.mjs` runs observe -> features -> decide -> size -> settle, and appends an evidence record, a decision record and (when a signal fires) a trade record to the ledger. |
| show cause and effect | Each decision record stores the signed weight and a one-line rationale from every rule that fired (`src/rules.mjs`), so the reader can see which inputs pushed the call and by how much. |
| repeatable reasoning trail | `src/ledger.mjs` chains records by canonical-JSON sha256 with a `prev` pointer; `src/replay.mjs` re-derives the chain, re-runs the decision from the stored features and re-hashes the stored evidence, exiting non-zero on any mismatch. |

`npm run replay` is the shortest demonstration: it recomputes the whole trail from bytes and fails loudly
if a single field was edited after the fact.



## The bounty spotlight: a Multi-KOL narrative agent

The bounty names a spotlight direction - watch up to 20 market voices, work out what they are saying about a
token, detect when they converge, and open a practice position under user-defined risk limits. `src/kol.mjs`
is that agent, built the same way as the price rules: every step is a named rule, and the same posts always
produce the same signal and the same ledger head.

| Step | Rule | Where |
| --- | --- | --- |
| What is being talked about | cashtags (`$SOL`) plus a configured token list, word-boundary matched | `parsePost` |
| Direction | bull and bear lexicons; a tie scores 0 and can never open a position | `parsePost` |
| Conviction | starts at 0.5, +0.2 per strong phrase (capped at two), -0.15 per excess bear word, then halved if the post hedges ("maybe", "not sure", "small") | `parsePost` |
| Urgency | 0.25 per urgency phrase ("now", "today", "before"), capped at 1 | `parsePost` |
| Convergence | distinct KOLs inside a 6h window, same token, same direction; score is the sum of conviction x (1 + urgency) | `convergence` |
| Gate | at least 3 distinct voices **and** score >= 1.2; both are hard, and the count is not folded into the score | `convergence` |
| Sizing | risk per trade is a fraction of equity, the stop sets the distance, the notional cap binds before risk does | `sizePosition` |

```bash
npm run kol
```

On the fixture (12 posts, 8 voices, 3 tokens) the cycle finds one signal: **SOL, 4 distinct voices, score 3.27**,
a 300 USDC paper long capped by `maxNotionalUsd` even though 1% of 1,000 USDC at a 3% stop would allow 333.
ARB is mentioned by one voice and is not traded; ETH is only talked about bearishly, and this agent does not
short. Every post that fed the decision is stored with its sha256, so the signal can be re-derived from the
posts alone - the same property `npm run replay` enforces on the price trail.

**What is a fixture and what is not.** The posts are a dated fixture, not a live feed: a collector would change
where posts come from, not what the rules do. No X, Discord or Telegram credentials are used anywhere in this
repository, and no position is real - `mode` is paper, there is no order routing, no keys and no custody.


## What is real and what is not

**Real:** the market data (Binance and Coinbase public endpoints), the arithmetic, the position sizing, the hash chain, the replay verification, the tests.

**Not real:** the money. There is no order routing, no API key, no wallet, no custody. `mode` is `paper` on every trade record.

**Not claimed:** that this strategy is profitable. No backtest edge is asserted anywhere in this repository, and no return figure in this README should be read as a forecast.

## Layout

```
src/ledger.mjs    append-only hash-chained log, canonical JSON hashing, chain verification
src/evidence.mjs  public data collection, provenance hashes, cross-venue check
src/rules.mjs     the five rules, feature derivation, deterministic scoring, sizing
src/agent.mjs     one cycle: observe -> decide -> size -> settle -> record
src/replay.mjs    three-layer verification
src/kol.mjs       Multi-KOL narrative agent: parse, convergence, sizing, recorded cycle
src/server.mjs    dependency-free dashboard over the ledger
scripts/          fixture builder (pulls real history into an offline fixture)
test/             26 tests, including a full open-then-settle cycle
scripts/kol-demo.mjs  one recorded Multi-KOL cycle over data/kol-demo.jsonl
```

Zero runtime dependencies. Node 20+ standard library only.

## License

MIT