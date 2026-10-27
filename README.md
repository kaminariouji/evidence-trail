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

## Quick start

```bash
git clone <this repo>
cd evidence-trail
node --version        # 20 or newer
npm test              # 20 tests, no network required
npm run demo          # replay a recorded two-cycle demo into data/demo.jsonl
npm run replay        # verify the chain and re-derive every decision
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
src/server.mjs    dependency-free dashboard over the ledger
scripts/          fixture builder (pulls real history into an offline fixture)
test/             20 tests, including a full open-then-settle cycle
```

Zero runtime dependencies. Node 20+ standard library only.

## License

MIT
