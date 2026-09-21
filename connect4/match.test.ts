import { test, expect } from "bun:test";
import { legalColumns, type Board, type Player } from "./engine";
import { accuracy, playGame, runMatch, tallyResults, type GameResult } from "./match";
import type { AskFn, Strategy } from "./strategies/types";

// ask must never be reached: stub strategies never call it.
export const noAsk: AskFn = async () => {
  throw new Error("ask should not be called by stub strategies");
};

// Plays a fixed column sequence (one entry per own move). Stateful — use a
// fresh instance per game.
function scripted(name: string, cols: number[]): Strategy {
  let i = 0;
  return {
    name,
    async pickMove() {
      const column = cols[i++];
      if (column === undefined) throw new Error(`${name}: script exhausted`);
      return { column, rounds: [], decision: `${name} plays ${column}` };
    },
  };
}

test("playGame: vertical yellow win, records every move", async () => {
  const r = await playGame(scripted("A", [2, 2, 2, 2]), scripted("B", [5, 5, 5]), noAsk, 7);
  expect(r.winner).toBe("yellow");
  expect(r.yellow).toBe("A");
  expect(r.red).toBe("B");
  expect(r.game).toBe(7);
  expect(r.moves.length).toBe(7);
  expect(r.moves.map((m) => m.player)).toEqual([
    "yellow", "red", "yellow", "red", "yellow", "red", "yellow",
  ]);
  expect(r.moves[0]).toMatchObject({ moveNo: 1, strategy: "A", column: 2, row: 0 });
  expect(r.moves[1]).toMatchObject({ moveNo: 2, strategy: "B", column: 5, row: 0 });
  expect(r.moves[6].decision).toBe("A plays 2");
  // ground truth captured on the pre-move board: yellow's 7th move is a win
  expect(r.moves[6].groundTruth.find((t) => t.column === 2)?.winsNow).toBe(true);
});

test("playGame: full-board draw", async () => {
  // Pair motif fills two columns as YYRRYY / RRYYRR with strict alternation;
  // three motifs cover cols 0-5, then col 6 fills YRYRYR. Proven drawn
  // pattern (see engine.test.ts draw test) with an alternating-turn ordering.
  const yellowCols = [0, 0, 1, 1, 0, 0,  2, 2, 3, 3, 2, 2,  4, 4, 5, 5, 4, 4,  6, 6, 6];
  const redCols    = [1, 1, 0, 0, 1, 1,  3, 3, 2, 2, 3, 3,  5, 5, 4, 4, 5, 5,  6, 6, 6];
  const r = await playGame(scripted("A", yellowCols), scripted("B", redCols), noAsk, 1);
  expect(r.winner).toBe("draw");
  expect(r.moves.length).toBe(42);
});

test("playGame: strategy throw aborts the game as an error", async () => {
  const bomb: Strategy = {
    name: "bomb",
    async pickMove() { throw new Error("Jev request timed out after 30000ms"); },
  };
  const r = await playGame(scripted("A", [0, 1]), bomb, noAsk, 1);
  expect(r.winner).toBe("error");
  expect(r.error).toContain("timed out");
  expect(r.moves.length).toBe(1); // A's opening move was recorded
});

test("playGame: illegal column from a strategy is an error, not a crash", async () => {
  const cheat: Strategy = {
    name: "cheat",
    async pickMove() { return { column: 9, rounds: [], decision: "cheat" }; },
  };
  const r = await playGame(cheat, scripted("B", [0]), noAsk, 1);
  expect(r.winner).toBe("error");
  expect(r.error).toMatch(/range|full/);
  expect(r.moves.length).toBe(0);
});

// Stateless: always plays the lowest legal column. Both sides doing this
// ends with yellow winning on the bottom row in exactly 19 moves.
function firstLegal(name: string): Strategy {
  return {
    name,
    async pickMove(board: Board) {
      return { column: legalColumns(board)[0], rounds: [], decision: "first legal" };
    },
  };
}

test("runMatch alternates first move and tallies per seat", async () => {
  const ends: number[] = [];
  const { results, tally } = await runMatch(
    () => firstLegal("A"), () => firstLegal("B"), 4, noAsk,
    { concurrency: 2, onGameEnd: (_r, done, total) => { ends.push(done); expect(total).toBe(4); } }
  );
  expect(results.length).toBe(4);
  expect(results.map((r) => r.yellow)).toEqual(["A", "B", "A", "B"]);
  expect(results.every((r) => r.winner === "yellow" && r.moves.length === 19)).toBe(true);
  expect(ends.sort((x, y) => x - y)).toEqual([1, 2, 3, 4]);

  expect(tally.games).toBe(4);
  expect(tally.completed).toBe(4);
  expect(tally.errored).toBe(0);
  expect(tally.avgMoves).toBe(19);
  expect(tally.byStrategy.A).toMatchObject({
    wins: 2, losses: 2, winsFirst: 2, winsSecond: 0, firstGames: 2, secondGames: 2,
  });
  expect(tally.byStrategy.B).toMatchObject({ wins: 2, winsFirst: 2, winsSecond: 0 });
});

test("runMatch: an erroring strategy voids its games but the match completes", async () => {
  const bombFactory = (): Strategy => ({
    name: "bomb",
    async pickMove() { throw new Error("boom"); },
  });
  const { results, tally } = await runMatch(() => firstLegal("A"), bombFactory, 3, noAsk, { concurrency: 3 });
  expect(results.length).toBe(3);
  expect(tally.errored).toBe(3);
  expect(tally.completed).toBe(0);
  expect(Object.keys(tally.byStrategy)).toEqual([]); // errored games count for nobody
});

test("tallyResults: draws count for both seats", () => {
  const draw: GameResult = { game: 1, yellow: "A", red: "B", winner: "draw", moves: [] };
  const t = tallyResults([draw]);
  expect(t.draws).toBe(1);
  expect(t.byStrategy.A.draws).toBe(1);
  expect(t.byStrategy.B.draws).toBe(1);
});

test("tallyResults: accumulates per-strategy moves and latencyMs", () => {
  const mkRound = (latencyMs: number) => ({
    label: "l", state: {}, questions: {}, answers: {}, latencyMs,
  });
  const result: GameResult = {
    game: 1, yellow: "X", red: "Y", winner: "yellow",
    moves: [
      {
        game: 1, moveNo: 1, strategy: "X", player: "yellow", column: 0, row: 0,
        decision: "d", groundTruth: [],
        rounds: [mkRound(100), mkRound(150)],
      },
      {
        game: 1, moveNo: 2, strategy: "Y", player: "red", column: 1, row: 0,
        decision: "d", groundTruth: [],
        rounds: [mkRound(200)],
      },
    ],
  };
  const t = tallyResults([result]);
  expect(t.byStrategy.X).toMatchObject({ moves: 1, latencyMs: 250 });
  expect(t.byStrategy.Y).toMatchObject({ moves: 1, latencyMs: 200 });
});

test("accuracy grades nouls against ground truth; spoonfed-labeled rounds use handsWinAbove", () => {
  const mk = (strategy: string, noul: number, id: string, gt: object, label = "L"): GameResult => ({
    game: 1, yellow: strategy, red: "x", winner: "yellow",
    moves: [{
      game: 1, moveNo: 1, strategy, player: "yellow", column: 3, row: 0,
      decision: "d", groundTruth: [{ column: 3, winsNow: false, blocksWin: true, handsWin: true, handsWinAbove: false, ...gt } as any],
      rounds: [{ label, state: {}, questions: {}, latencyMs: 1,
        answers: { [id]: { type: "noul", noul } as any } }],
    }],
  });
  // block: 0.9 vs blocksWin true -> agree
  const a1 = accuracy([mk("decomposed", 0.9, "block_3", {})]);
  expect(a1.decomposed.block).toEqual({ agree: 1, total: 1 });
  // hand for decomposed grades vs handsWin (true): 0.2 -> disagree
  const a2 = accuracy([mk("decomposed", 0.2, "hand_3", {})]);
  expect(a2.decomposed.hand).toEqual({ agree: 0, total: 1 });
  // hand in a spoonfed-labeled round grades vs handsWinAbove (false): 0.2 -> agree
  const a3 = accuracy([mk("spoonfed", 0.2, "hand_3", {}, "move-eval-spoonfed")]);
  expect(a3.spoonfed.hand).toEqual({ agree: 1, total: 1 });
  // keyed off the round label, NOT the strategy name: blocker shares the label
  const a5 = accuracy([mk("blocker", 0.2, "hand_3", {}, "move-eval-spoonfed")]);
  expect(a5.blocker.hand).toEqual({ agree: 1, total: 1 });
  // open3/cap grade vs makesThree/capsTwo
  const a6 = accuracy([mk("radar", 0.9, "open3_3", { makesThree: true, capsTwo: false }, "move-eval-spoonfed")]);
  expect(a6.radar.open3).toEqual({ agree: 1, total: 1 });
  const a7 = accuracy([mk("radar", 0.9, "cap_3", { makesThree: false, capsTwo: false }, "move-eval-spoonfed")]);
  expect(a7.radar.cap).toEqual({ agree: 0, total: 1 });
  // non-tactic ids ignored
  const a4 = accuracy([mk("naive", 0.9, "pos", {})]);
  expect(a4.naive?.win.total ?? 0).toBe(0);
});
