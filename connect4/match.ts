// Jev-vs-Jev match engine. Pure logic, AskFn injected — no server, no I/O.

import {
  drop, emptyBoard, groundTruth, opponent, status,
  type ColumnTruth, type Player,
} from "./engine";
import type { AskFn, JevRound, Strategy } from "./strategies/types";

export interface MoveRecord {
  game: number;
  moveNo: number;
  strategy: string;
  player: Player;
  column: number;
  row: number;
  decision: string;
  rounds: JevRound[];
  groundTruth: ColumnTruth[];
}

export interface GameResult {
  game: number;      // 1-based game number within the match
  yellow: string;    // strategy name that played yellow (moved first)
  red: string;
  winner: "yellow" | "red" | "draw" | "error";
  moves: MoveRecord[];
  error?: string;
}

export async function playGame(
  yellow: Strategy,
  red: Strategy,
  ask: AskFn,
  game: number
): Promise<GameResult> {
  const strat: Record<Player, Strategy> = { yellow, red };
  const base = { game, yellow: yellow.name, red: red.name };
  let board = emptyBoard();
  let current: Player = "yellow";
  const moves: MoveRecord[] = [];
  try {
    for (;;) {
      const st = status(board);
      if (st.state === "won") return { ...base, winner: st.winner, moves };
      if (st.state === "draw") return { ...base, winner: "draw", moves };
      const s = strat[current];
      const truth = groundTruth(board, current);
      const picked = await s.pickMove(board, current, ask);
      const applied = drop(board, picked.column, current); // throws on illegal
      moves.push({
        game, moveNo: moves.length + 1, strategy: s.name, player: current,
        column: picked.column, row: applied.row, decision: picked.decision,
        rounds: picked.rounds, groundTruth: truth,
      });
      board = applied.board;
      current = opponent(current);
    }
  } catch (e) {
    // No fallback: one bad turn voids this game only.
    return { ...base, winner: "error", moves, error: (e as Error).message };
  }
}

export interface StrategyTally {
  wins: number; losses: number; draws: number;
  firstGames: number; secondGames: number;
  winsFirst: number; winsSecond: number;
  moves: number; latencyMs: number;
}

export interface Tally {
  games: number;
  completed: number;   // non-error games
  errored: number;
  draws: number;
  avgMoves: number;    // over completed games
  byStrategy: Record<string, StrategyTally>;
}

// Per-seat counts: in a mirror match the one strategy accrues both seats'
// numbers (a decisive mirror game adds one win AND one loss).
export function tallyResults(results: GameResult[]): Tally {
  const byStrategy: Record<string, StrategyTally> = {};
  const get = (n: string) =>
    (byStrategy[n] ??= {
      wins: 0, losses: 0, draws: 0,
      firstGames: 0, secondGames: 0, winsFirst: 0, winsSecond: 0,
      moves: 0, latencyMs: 0,
    });
  let errored = 0, draws = 0, completed = 0, movesSum = 0;
  for (const r of results) {
    if (r.winner === "error") { errored++; continue; }
    completed++;
    movesSum += r.moves.length;
    const first = get(r.yellow);
    const second = get(r.red);
    first.firstGames++;
    second.secondGames++;
    if (r.winner === "draw") { draws++; first.draws++; second.draws++; }
    else if (r.winner === "yellow") { first.wins++; first.winsFirst++; second.losses++; }
    else { second.wins++; second.winsSecond++; first.losses++; }
    for (const m of r.moves) {
      const st = get(m.strategy);
      st.moves++;
      st.latencyMs += m.rounds.reduce((s, x) => s + x.latencyMs, 0);
    }
  }
  return {
    games: results.length, completed, errored, draws,
    avgMoves: completed > 0 ? movesSum / completed : 0,
    byStrategy,
  };
}

export type TacticKind = "win" | "block" | "hand" | "open3" | "cap";

// Same grading rules as the inspector: noul >= 0.5 vs ground truth;
// spoonfed's hand question is narrower, so it grades vs handsWinAbove.
export function accuracy(
  results: GameResult[]
): Record<string, Record<TacticKind, { agree: number; total: number }>> {
  const out: Record<string, Record<TacticKind, { agree: number; total: number }>> = {};
  for (const r of results) {
    for (const m of r.moves) {
      const acc = (out[m.strategy] ??= {
        win: { agree: 0, total: 0 }, block: { agree: 0, total: 0 }, hand: { agree: 0, total: 0 },
        open3: { agree: 0, total: 0 }, cap: { agree: 0, total: 0 },
      });
      const gt = new Map(m.groundTruth.map((t) => [t.column, t]));
      for (const round of m.rounds) {
        for (const [id, a] of Object.entries(round.answers)) {
          const match = /^(win|block|hand|open3|cap)_([0-6])$/.exec(id);
          if (!match) continue;
          const t = gt.get(Number(match[2]));
          if (!t) continue;
          const kind = match[1] as TacticKind;
          const truth =
            kind === "win" ? t.winsNow :
            kind === "block" ? t.blocksWin :
            kind === "open3" ? t.makesThree :
            kind === "cap" ? t.capsTwo :
            // spoonfed-style rounds ask the narrower above-cell question;
            // keyed off the label so variants (blocker, radar) grade correctly too
            round.label === "move-eval-spoonfed" ? t.handsWinAbove : t.handsWin;
          acc[kind].total++;
          if ((a.noul >= 0.5) === truth) acc[kind].agree++;
        }
      }
    }
  }
  return out;
}

export interface MatchOpts {
  concurrency?: number;
  onGameEnd?: (r: GameResult, done: number, total: number) => void;
}

// Factories, not instances: concurrent games must not share stateful
// strategy objects. Game i (0-based): even -> A plays yellow (first).
export async function runMatch(
  a: () => Strategy,
  b: () => Strategy,
  games: number,
  ask: AskFn,
  opts: MatchOpts = {}
): Promise<{ results: GameResult[]; tally: Tally }> {
  const concurrency = Math.min(opts.concurrency ?? 8, games);
  const results: GameResult[] = new Array(games);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < games) {
      const i = next++;
      const yellow = i % 2 === 0 ? a() : b();
      const red = i % 2 === 0 ? b() : a();
      const r = await playGame(yellow, red, ask, i + 1);
      results[i] = r;
      done++;
      opts.onGameEnd?.(r, done, games);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return { results, tally: tallyResults(results) };
}
