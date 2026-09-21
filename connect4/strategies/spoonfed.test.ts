import { test, expect } from "bun:test";
import { emptyBoard, drop, legalColumns, ROWS } from "../engine";
import { spoonfed } from "./spoonfed";
import type { AskFn, JevRound } from "./types";
import type { NoulAnswer } from "../../src/jev-client";

function fakeAsk(answers: Record<string, NoulAnswer>, log: JevRound[] = []): AskFn {
  return async (label, state, questions) => {
    const round: JevRound = { label, state, questions, answers, latencyMs: 1 };
    log.push(round);
    return round;
  };
}

const noul = (p: number): NoulAnswer => ({ type: "noul", noul: p });

function allCalm(b: ReturnType<typeof emptyBoard>): Record<string, NoulAnswer> {
  const answers: Record<string, NoulAnswer> = {
    pos: { type: "choice", noul: 0, choice: "col3", probabilities: { col3: 0.6 } },
  };
  for (const c of legalColumns(b)) {
    answers[`win_${c}`] = noul(0.05);
    answers[`block_${c}`] = noul(0.05);
    answers[`hand_${c}`] = noul(0.05);
  }
  return answers;
}

test("spoonfed state pre-computes marked lines per candidate column", async () => {
  let b = emptyBoard();
  b = drop(b, 3, "yellow").board;
  b = drop(b, 3, "yellow").board;
  b = drop(b, 3, "yellow").board; // yellow stack of 3 in col 3
  const log: JevRound[] = [];
  await spoonfed.pickMove(b, "yellow", fakeAsk(allCalm(b), log));

  const state = log[0].state as {
    rules: string;
    candidates: Record<string, {
      landing_cell: string;
      lines_through_landing_cell: string[][];
      lines_after_my_drop_through_cell_above?: string[][];
    }>;
  };
  expect(state.rules).toContain("Connect Four");
  const cand = state.candidates.col3;
  expect(cand.landing_cell).toContain("column 3");
  // the vertical window [row0..row3] through the landing cell must read
  // yellow,yellow,yellow,(this move)
  const vertical = cand.lines_through_landing_cell.find(
    (line) => line.filter((x) => x === "yellow").length === 3 && line.includes("(this move)")
  );
  expect(vertical).toBeTruthy();
  // every line has exactly 4 entries and exactly one marker
  for (const line of cand.lines_through_landing_cell) {
    expect(line.length).toBe(4);
    expect(line.filter((x) => x === "(this move)").length).toBe(1);
  }
  // cell-above lines exist for a column with room, marked for the opponent
  expect(cand.lines_after_my_drop_through_cell_above).toBeTruthy();
  for (const line of cand.lines_after_my_drop_through_cell_above!) {
    expect(line.filter((x) => x === "(opponent's next piece)").length).toBe(1);
  }
});

test("hand question omitted for a column with exactly one empty slot", async () => {
  let b = emptyBoard();
  for (let i = 0; i < ROWS - 1; i++) b = drop(b, 0, i % 2 ? "red" : "yellow").board;
  const log: JevRound[] = [];
  await spoonfed.pickMove(b, "yellow", fakeAsk(allCalm(b), log));
  const ids = Object.keys(log[0].questions);
  expect(ids).toContain("win_0");
  expect(ids).toContain("block_0");
  expect(ids).not.toContain("hand_0"); // no cell above -> no hands-win question
  expect(ids).toContain("hand_1");
});

test("spoonfed combines with the same win > block > positional policy", async () => {
  const b = emptyBoard();
  const answers = allCalm(b);
  answers.win_6 = noul(0.9);
  const result = await spoonfed.pickMove(b, "yellow", fakeAsk(answers));
  expect(result.column).toBe(6);
  expect(result.decision).toContain("win");
});

// blocker moved to radar.ts (it needs the cap question to react at two);
// its behavior tests live in radar.test.ts. This checks the shared trait:
import { blocker } from "./radar";

test("blocker: identical round label, but blocks instead of winning", async () => {
  const b = emptyBoard();
  const answers = allCalm(b);
  answers.win_6 = noul(0.9);
  answers.block_1 = noul(0.92);
  const log: JevRound[] = [];
  const result = await blocker.pickMove(b, "yellow", fakeAsk(answers, log));
  expect(blocker.name).toBe("blocker");
  expect(log[0].label).toBe("move-eval-spoonfed"); // shared question style
  expect(result.column).toBe(1); // block beats the available win
  expect(result.decision).toContain("blocker block");
  // spoonfed itself still takes the win with the same answers
  const s = await spoonfed.pickMove(b, "yellow", fakeAsk(answers));
  expect(s.column).toBe(6);
});
