import { test, expect } from "bun:test";
import { emptyBoard, drop } from "../engine";
import {
  boardState, colKey, parseCol, pickFromChoice, combineTactics,
  WIN_THRESHOLD, RULES,
} from "./types";
import { makeAsk } from "../jev";
import type { NoulAnswer } from "../../src/jev-client";

test("boardState renders grid and column stacks", () => {
  let b = emptyBoard();
  b = drop(b, 3, "yellow").board;
  b = drop(b, 3, "red").board;
  b = drop(b, 0, "yellow").board;
  const s = boardState(b);
  expect(s.grid_rows_top_to_bottom.length).toBe(6);
  expect(s.grid_rows_top_to_bottom[5]).toBe("Y . . Y . . ."); // bottom row printed last
  expect(s.grid_rows_top_to_bottom[4]).toBe(". . . R . . .");
  expect(s.columns_bottom_to_top.col3).toEqual(["yellow", "red"]);
  expect(s.columns_bottom_to_top.col0).toEqual(["yellow"]);
  expect(s.columns_bottom_to_top.col6).toEqual([]);
  expect(s.grid_legend).toContain("Y = yellow");
});

test("colKey/parseCol round-trip; parseCol rejects junk", () => {
  expect(colKey(4)).toBe("col4");
  expect(parseCol("col4")).toBe(4);
  expect(parseCol("none")).toBeNull();
  expect(parseCol("col12")).toBeNull();
});

test("pickFromChoice prefers the stated choice when legal", () => {
  const ans = {
    type: "choice", noul: 0, choice: "col2",
    probabilities: { col2: 0.6, col3: 0.4 },
  } as NoulAnswer;
  expect(pickFromChoice(ans, [2, 3])).toEqual({ column: 2, p: 0.6 });
});

test("pickFromChoice falls back to highest legal probability", () => {
  const ans = {
    type: "choice", noul: 0, choice: "col0", // col0 not legal
    probabilities: { col0: 0.5, col3: 0.3, col4: 0.2 },
  } as NoulAnswer;
  expect(pickFromChoice(ans, [3, 4]).column).toBe(3);
});

test("pickFromChoice throws when the answer is missing or unusable", () => {
  expect(() => pickFromChoice(undefined, [5, 6])).toThrow(/no usable column/);
  expect(() =>
    pickFromChoice({ type: "choice", noul: 0, choice: "col0", probabilities: { col0: 1 } } as NoulAnswer, [5, 6])
  ).toThrow(/no usable column/);
});

test("combineTactics: win beats block beats positional", () => {
  const probs: Record<string, number> = {
    win_2: 0.9, win_3: 0.1, block_3: 0.95, hand_4: 0.9,
  };
  const noulAt = (id: string) => probs[id] ?? 0;
  const pos = {
    type: "choice", noul: 0, choice: "col4",
    probabilities: { col4: 0.8, col2: 0.2 },
  } as NoulAnswer;

  const win = combineTactics([2, 3, 4], noulAt, pos);
  expect(win.column).toBe(2);
  expect(win.decision).toContain("win");

  const noWin = combineTactics([3, 4], (id) => (id === "block_3" ? 0.95 : 0), pos);
  expect(noWin.column).toBe(3);
  expect(noWin.decision).toContain("block");
});

test("combineTactics avoids hands-win columns in positional play", () => {
  const noulAt = (id: string) => (id === "hand_4" ? 0.9 : 0);
  const pos = {
    type: "choice", noul: 0, choice: "col4",
    probabilities: { col4: 0.8, col2: 0.2 },
  } as NoulAnswer;
  const r = combineTactics([2, 4], noulAt, pos);
  expect(r.column).toBe(2); // col4 filtered out despite higher preference
  expect(r.decision).toContain("avoided");
});

test("combineTactics: if every column hands a win, play best positional anyway", () => {
  const noulAt = (id: string) => (id.startsWith("hand_") ? 0.9 : 0);
  const pos = {
    type: "choice", noul: 0, choice: "col2",
    probabilities: { col2: 0.9, col4: 0.1 },
  } as NoulAnswer;
  expect(combineTactics([2, 4], noulAt, pos).column).toBe(2);
});

test("makeAsk packages a JevRound", async () => {
  process.env.TYPESAFE_API_KEY = "test-key";
  const fake = (async () =>
    new Response(
      JSON.stringify({ answers: { q: { type: "noul", noul: 0.7 } } }),
      { status: 200 }
    )) as typeof fetch;
  const ask = makeAsk(fake);
  const round = await ask("test-round", { rules: RULES }, {
    q: { type: "noul", instructions: "test?" },
  });
  expect(round.label).toBe("test-round");
  expect(round.answers.q.noul).toBe(0.7);
  expect(round.latencyMs).toBeGreaterThanOrEqual(0);
  expect((round.state as { rules: string }).rules).toBe(RULES);
});

test("combineTactics throws clearly on empty legal array", () => {
  expect(() => combineTactics([], () => 0, undefined)).toThrow(/no legal moves/);
});

test("thresholds are sane", () => {
  expect(WIN_THRESHOLD).toBeGreaterThan(0.5);
});

test("combineTactics block-first priority blocks even when a win is available", () => {
  const probs: Record<string, number> = { win_2: 0.9, block_3: 0.95 };
  const noulAt = (id: string) => probs[id] ?? 0;
  const winFirst = combineTactics([2, 3], noulAt, undefined, "win-first");
  expect(winFirst.column).toBe(2);
  expect(winFirst.decision).toContain("win");
  const blockFirst = combineTactics([2, 3], noulAt, undefined, "block-first");
  expect(blockFirst.column).toBe(3);
  expect(blockFirst.decision).toContain("block");
});
