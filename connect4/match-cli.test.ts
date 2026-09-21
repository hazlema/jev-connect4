import { test, expect } from "bun:test";
import { formatLive, formatTally, parseCliArgs } from "./match-cli";
import { tallyResults, accuracy, type GameResult } from "./match";

test("parseCliArgs: happy path and concurrency flag", () => {
  expect(parseCliArgs(["spoonfed", "decomposed", "100"])).toEqual({
    a: "spoonfed", b: "decomposed", games: 100, concurrency: 8,
  });
  expect(parseCliArgs(["naive", "naive", "4", "--concurrency", "2"])).toEqual({
    a: "naive", b: "naive", games: 4, concurrency: 2,
  });
});

test("parseCliArgs: rejects unknown strategies and bad counts", () => {
  expect(parseCliArgs(["minimax", "naive", "4"])).toMatchObject({ error: expect.stringContaining("minimax") });
  expect(parseCliArgs(["naive", "naive", "0"])).toMatchObject({ error: expect.stringContaining("positive") });
  expect(parseCliArgs(["naive", "naive", "ten"])).toMatchObject({ error: expect.stringContaining("positive") });
  expect(parseCliArgs(["naive"])).toMatchObject({ error: expect.stringContaining("usage") });
  expect(parseCliArgs(["naive", "naive", "4", "--concurrency", "0"])).toMatchObject({ error: expect.stringContaining("concurrency") });
});

const win: GameResult = {
  game: 1, yellow: "spoonfed", red: "decomposed", winner: "yellow",
  moves: new Array(17).fill(null).map((_, i) => ({
    game: 1, moveNo: i + 1, strategy: i % 2 ? "decomposed" : "spoonfed",
    player: i % 2 ? "red" : "yellow", column: 0, row: 0, decision: "d",
    rounds: [], groundTruth: [],
  })) as GameResult["moves"],
};

test("formatLive covers win, draw, error", () => {
  expect(formatLive(win, 41, 100)).toBe("game 41/100 · spoonfed (yellow) beats decomposed in 17 moves");
  expect(formatLive({ ...win, winner: "draw" }, 2, 4)).toBe("game 2/4 · draw after 17 moves");
  expect(formatLive({ ...win, winner: "error", error: "boom" }, 3, 4)).toBe("game 3/4 · ERROR after 17 moves: boom");
});

test("formatTally shows seat splits and accuracy", () => {
  const tally = tallyResults([win]);
  const out = formatTally(tally, accuracy([win]));
  expect(out).toContain("spoonfed");
  expect(out).toContain("first: 1W/1");
  expect(out).toContain("second: 0W/0");
  expect(out).toContain("1 games · 0 draws · 0 errored");
  expect(out).toContain("(100.0%)");
  expect(out).toContain("ms/move");
});

test("formatTally: errored-only strategy appears with accuracy", () => {
  const mkRound = (latencyMs: number) => ({
    label: "l", state: {}, questions: {}, answers: {
      win_3: { type: "noul" as const, noul: 0.8 },
    }, latencyMs,
  });
  const erroredGame: GameResult = {
    game: 1, yellow: "bomb", red: "x", winner: "error",
    moves: [{
      game: 1, moveNo: 1, strategy: "bomb", player: "yellow", column: 3, row: 0,
      decision: "d",
      groundTruth: [{ column: 3, winsNow: true, blocksWin: false, handsWin: false, handsWinAbove: false }],
      rounds: [mkRound(50)],
    }],
  };
  const tally = tallyResults([erroredGame]);
  const acc = accuracy([erroredGame]);
  const out = formatTally(tally, acc);
  expect(out).toContain("bomb");
  expect(out).toContain("errored games only");
});
