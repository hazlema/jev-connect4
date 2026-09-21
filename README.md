# Connect Four vs Jev

Web Connect Four where the AI opponent is **Jev** — [TypeSafe's](https://typesafe.ai)
System One judgment model — with a live inspector that shows **every query
sent to the model and every reply**, graded ✓/✗ against engine ground
truth, with per-move byte counts and one-click JSON copy.

Built to answer one question: when an AI plays a board game badly, is it
the model — or the way you're asking? (Inspired by a checkers demo whose
author said his Jev opponent was easy to beat.)

**The short version: it was the queries.** Eight strategies play the
identical model with identical rules. The only variables are how the
question is asked and how the answers are prioritized — and that spans
"can't see three-in-a-row" to "we can't beat it anymore."

## The strategies

| strategy | shape | result |
| --- | --- | --- |
| `naive` | raw grid + one "pick the best move" Choice | blind — watched an open three get completed |
| `decomposed` | per-column win/block/hands-win Nouls, one batched request | ~90-95% tactical accuracy, blurry threat localization |
| `two-phase` | threat-perception request first, positional request only if calm | works; two round-trips |
| `spoonfed` | same Nouls over **pre-computed marked 4-cell lines** in state | ~99-100% accuracy — representation was the bottleneck |
| `blocker` | threat questions, pure-defense order: block > cap twos > win | a defender with two-in-a-row reflexes |
| `radar` | spoonfed + open-two detection: win > block > **cap** > **extend** | the champion — try to beat it |
| `radar-trim` | radar compressed: shared framing in state, lean questions | **−36% input tokens** for ~3-4 pts vs radar itself |
| `radar-sym` | radar with symbol lines (`YY*.`) instead of words | **−57% tokens but rejected**: symbols cost 6-8 pts of judgment |

## Findings from ~1,500 autoplayed games

- **spoonfed vs decomposed, 100 games:** 74.7% vs 22.2%. Same model — the
  query representation alone was worth ~52 points of win rate.
- **spoonfed mirror, 100 games:** first mover 68W / 3W / 29 draws —
  Connect Four's solved first-player advantage emerging from pure
  judgment calls.
- **radar vs spoonfed, 100 games:** radar 50/50 as first mover
  (undefeated); its react-at-two defense cuts the opponent's first-mover
  win rate from ~70% to ~40%.
- **radar mirror, 100 games:** 0 draws and the SECOND mover won 92/100 —
  reactive capping punishes commitment; every cap is defense +
  development in one move.
- **Token optimization (610-game validation):** a mid-game radar request
  is ~34 KB, and the *questions* (27.7 KB) dwarf the state (7.3 KB) —
  repetition of per-column preambles is the real cost. Moving shared
  framing into state once → `radar-trim` at ~22 KB/request (−36%) for
  ~3-4 pts vs full radar. Symbol lines (`radar-sym`, ~15 KB, −57%)
  measurably degrade block/cap judgment 6-8 pts: **words beat symbols**.
  Bonus findings: descriptive JSON key names are worth ~5 accuracy points
  by themselves, and verbose sibling questions in a batch lend context to
  the hardest judgment — aggressive batch-wide compression taxes counting
  questions ~10 pts.
- Question wording matters measurably everywhere: adding explicit valid
  orderings *and a named non-example* to one question lifted its accuracy
  92.0% → 96.6%.

## Setup

Requires [Bun](https://bun.sh) and a TypeSafe API key.

```bash
cp .env.sample .env     # then paste your key into .env
bun run c4              # → http://localhost:3444  (or PORT=4000 bun run c4)
```

Pick a strategy and a side, play. The right-hand inspector shows each Jev
round-trip: per-column probabilities with ✓/✗ ticks against engine ground
truth, the decision trace, latency, bytes sent/received, raw JSON with a
copy button. Games append JSONL transcripts under `connect4/transcripts/`.

Suggested route: beat `naive` (easy), then `decomposed` (doable), then try
`radar` (good luck — build two in a row and watch it land on you).

## Jev vs Jev

```bash
bun run c4:match <stratA> <stratB> <games> [--concurrency N]
bun run c4:match radar radar 100
```

Plays N games concurrently (first move alternates every game; mirrors
measure pure turn-order effects) and prints a live line per game plus a
final table: win% split by moved-first/second, draws, errored games (a
failed Jev call voids that game — no fallback), avg length, ms/move, and
per-question tactical accuracy. 100 games ≈ 60-100 seconds at the default
concurrency of 8.

## How it works

- `connect4/engine.ts` — pure rules + ground-truth tactics (never sent to
  Jev; used to grade its answers).
- `connect4/strategies/` — the eight strategies behind one interface.
  The model is never assumed to know Connect Four.
- `connect4/server.ts` — Bun server; your API key stays server-side.
- `connect4/match.ts` + `match-cli.ts` — the autoplay match runner.
- `src/jev-client.ts` — minimal TypeSafe systemone client (30s timeout,
  one retry).

No dependencies, no build step. Tests: `bun test` (83 across engine,
strategies, server, match — Jev is mocked; no API calls).
