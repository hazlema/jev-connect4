import { test, expect } from "bun:test";
import { drop, emptyBoard, legalColumns } from "../engine";
import { radarSym, radarTrim } from "./lite";
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

function allCalm(): Record<string, NoulAnswer> {
  const answers: Record<string, NoulAnswer> = {
    pos: { type: "choice", noul: 0, choice: "col3", probabilities: { col3: 0.6 } },
  };
  for (const c of legalColumns(emptyBoard())) {
    for (const k of ["win", "block", "hand", "open3", "cap"]) answers[`${k}_${c}`] = noul(0.05);
  }
  return answers;
}

test("lite variants: radar's question ids, shared label, lean state", async () => {
  for (const strat of [radarTrim, radarSym]) {
    const log: JevRound[] = [];
    await strat.pickMove(emptyBoard(), "yellow", fakeAsk(allCalm(), log));
    expect(log[0].label).toBe("move-eval-spoonfed");
    const ids = Object.keys(log[0].questions);
    for (const c of [0, 3, 6]) {
      for (const k of ["win", "block", "hand", "open3", "cap"]) {
        expect(ids).toContain(`${k}_${c}`);
      }
    }
    const state = log[0].state as Record<string, unknown>;
    expect(state.reading).toBeTruthy();
    expect(state.stacks).toBeTruthy();
    expect(state.candidates).toBeTruthy();
    expect(state.rules).toBeUndefined();
    expect(state.grid_rows_top_to_bottom).toBeUndefined();
  }
});

test("radar-sym renders 4-char symbol lines with exactly one mark", async () => {
  let b = emptyBoard();
  b = drop(b, 3, "yellow").board;
  b = drop(b, 3, "red").board;
  const log: JevRound[] = [];
  await radarSym.pickMove(b, "yellow", fakeAsk(allCalm(), log));
  const cand = (log[0].state as any).candidates.col3;
  for (const line of cand.lines) {
    expect(typeof line).toBe("string");
    expect(line.length).toBe(4);
    expect(line.split("*").length - 1).toBe(1);
    expect(line).toMatch(/^[YR.*]{4}$/);
  }
  const vertical = cand.lines.find((l: string) => l.includes("Y") && l.includes("R"));
  expect(vertical).toBeTruthy(); // col-3 stack visible in some window
  for (const line of cand.lines_above) {
    expect(line.split("^").length - 1).toBe(1);
    expect(line).toMatch(/^[YR.^]{4}$/);
  }
  const stacks = (log[0].state as any).stacks;
  expect(stacks.col3).toBe("YR");
  expect(stacks.col0).toBe("");
});

test("radar-trim keeps word cells and the move mark", async () => {
  let b = emptyBoard();
  b = drop(b, 2, "yellow").board;
  const log: JevRound[] = [];
  await radarTrim.pickMove(b, "yellow", fakeAsk(allCalm(), log));
  const cand = (log[0].state as any).candidates.col2;
  for (const line of cand.lines) {
    expect(Array.isArray(line)).toBe(true);
    expect(line.length).toBe(4);
    expect(line.filter((x: string) => x === "(this move)").length).toBe(1);
  }
});

test("lite variants use radar's policy: cap outranks open3", async () => {
  const a = allCalm();
  a.open3_4 = noul(0.85);
  a.cap_1 = noul(0.9);
  for (const strat of [radarTrim, radarSym]) {
    const r = await strat.pickMove(emptyBoard(), "yellow", fakeAsk(a));
    expect(r.column).toBe(1);
    expect(r.decision).toContain(`${strat.name} cap`);
  }
});

test("lite variants omit hand_ for a nearly-full column", async () => {
  let b = emptyBoard();
  for (let i = 0; i < 5; i++) b = drop(b, 0, i % 2 ? "red" : "yellow").board;
  const log: JevRound[] = [];
  await radarTrim.pickMove(b, "yellow", fakeAsk(allCalm(), log));
  const ids = Object.keys(log[0].questions);
  expect(ids).toContain("win_0");
  expect(ids).not.toContain("hand_0");
  expect(ids).toContain("hand_1");
});
