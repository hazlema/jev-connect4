# Connect Four vs Jev

Web Connect Four where the AI opponent is **Jev** — [TypeSafe's](https://typesafe.ai)
System One judgment model — with a live inspector that shows **every query
sent to the model and every reply**, graded ✓/✗ against engine ground truth.

Built to answer one question: when an AI plays a board game badly, is it
the model — or the way you're asking? (Inspired by a checkers demo whose
author said his Jev opponent was easy to beat.)

**The short version: it was the queries.** Six strategies play the
identical model with identical rules text. The only variable is how the
question is asked — and it spans the range from "can't see three-in-a-row"
to "we can't beat it anymore."

## The strategies

| strategy | shape | result |
| --- | --- | --- |
| `naive` | raw grid + one "pick the best move" Choice | blind — watched an open three get completed |
| `decomposed` | per-column win/block/hands-win Nouls, one batched request | ~90-95% tactical accuracy, blurry threat localization |
| `two-phase` | threat-perception request first, positional request only if calm | works; two round-trips |
| `spoonfed` | same Nouls over **pre-computed marked 4-cell lines** in state | ~99-100% accuracy — representation was the bottleneck |
| `blocker` | threat questions, pure-defense order: block > cap twos > win | a defender with two-in-a-row reflexes |
| `radar` | spoonfed + open-two detection: win > block > **cap** > **extend** | the champion — try to beat it |

## Findings from ~600 autoplayed games

- **spoonfed vs decomposed, 100 games:** 74.7% vs 22.2%. Same model — the
  query representation alone was worth ~52 points of win rate.
- **spoonfed mirror, 100 games:** first mover 68W, second mover 3W, 29
  draws. Connect Four's solved first-player advantage emerges from pure
  judgment calls. Block-detection accuracy: 11,331/11,351.
- **radar vs spoonfed, 100 games:** radar 50/50 as first mover
  (undefeated) — and its react-at-two defense cuts the opponent's
  first-mover win rate from ~70% to ~40%. Defense at the open-two stage is
  the first thing that ever broke the serve advantage.
- Question wording matters measurably: adding explicit valid orderings
  *and a named non-example* to one question lifted its accuracy 92.0% →
  96.6%.

## Setup

Requires [Bun](https://bun.sh) and a TypeSafe API key.

```bash
cp .env.sample .env     # then paste your key into .env
bun run c4              # → http://localhost:3444
```

Pick a strategy and a side, play. The right-hand inspector shows each Jev
round-trip: per-column probabilities with ✓/✗ ticks against engine ground
truth, the decision trace, latency, and raw request/response JSON. Games
append JSONL transcripts under `connect4/transcripts/`.

Suggested route: beat `naive` (easy), then `decomposed` (doable), then try
`radar` (good luck — build two in a row and watch it land on you).

## Jev vs Jev

```bash
bun run c4:match <stratA> <stratB> <games> [--concurrency N]
bun run c4:match radar spoonfed 100
```

Plays N games concurrently (first move alternates every game; mirrors like
`radar radar` measure pure first-move advantage) and prints a live line per
game plus a final table: win% split by moved-first/second, draws, errored
games (a failed Jev call voids that game — no fallback), avg length,
ms/move, and per-question tactical accuracy. 100 games ≈ 60-100 seconds at
the default concurrency of 8 (~2,000 API calls).

## How it works

- `connect4/engine.ts` — pure rules + ground-truth tactics (never sent to
  Jev; used to grade its answers).
- `connect4/strategies/` — the six strategies behind one interface. Every
  question spells out the rules inline; the model is never assumed to know
  Connect Four.
- `connect4/server.ts` — Bun server; your API key stays server-side.
- `connect4/match.ts` + `match-cli.ts` — the autoplay match runner.
- `src/jev-client.ts` — minimal TypeSafe systemone client (30s timeout,
  one retry).

No dependencies, no build step. Tests: `bun test` (78 across engine,
strategies, server, match — Jev is mocked; no API calls).
