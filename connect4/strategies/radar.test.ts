import { test, expect } from "bun:test";
import { emptyBoard, legalColumns } from "../engine";
import { blocker, radar } from "./radar";
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
    answers[`win_${c}`] = noul(0.05);
    answers[`block_${c}`] = noul(0.05);
    answers[`hand_${c}`] = noul(0.05);
    answers[`open3_${c}`] = noul(0.05);
    answers[`cap_${c}`] = noul(0.05);
  }
  return answers;
}

test("radar asks spoonfed's questions PLUS open3/cap per column, one round", async () => {
  const log: JevRound[] = [];
  await radar.pickMove(emptyBoard(), "yellow", fakeAsk(allCalm(), log));
  expect(log.length).toBe(1);
  expect(log[0].label).toBe("move-eval-spoonfed"); // shared style keeps hand grading
  const ids = Object.keys(log[0].questions);
  for (const c of [0, 3, 6]) {
    expect(ids).toContain(`win_${c}`);
    expect(ids).toContain(`open3_${c}`);
    expect(ids).toContain(`cap_${c}`);
  }
  const state = log[0].state as { candidates: Record<string, unknown> };
  expect(state.candidates.col3).toBeTruthy();
});

test("radar priority: win beats everything, block beats open3", async () => {
  const a = allCalm();
  a.win_5 = noul(0.9);
  a.block_2 = noul(0.9);
  a.open3_4 = noul(0.9);
  const r1 = await radar.pickMove(emptyBoard(), "yellow", fakeAsk(a));
  expect(r1.column).toBe(5);
  expect(r1.decision).toContain("win");

  const b = allCalm();
  b.block_2 = noul(0.9);
  b.open3_4 = noul(0.9);
  const r2 = await radar.pickMove(emptyBoard(), "yellow", fakeAsk(b));
  expect(r2.column).toBe(2);
  expect(r2.decision).toContain("block");
});

test("radar caps their open two BEFORE extending its own (react at two)", async () => {
  const a = allCalm();
  a.open3_4 = noul(0.85);
  a.cap_1 = noul(0.9);
  const r = await radar.pickMove(emptyBoard(), "yellow", fakeAsk(a));
  expect(r.column).toBe(1);
  expect(r.decision).toContain("cap");
});

test("radar extends its own two only when nothing needs capping", async () => {
  const a = allCalm();
  a.open3_4 = noul(0.85);
  const r = await radar.pickMove(emptyBoard(), "yellow", fakeAsk(a));
  expect(r.column).toBe(4);
  expect(r.decision).toContain("open3");
});

test("radar caps when no open3 available, else positional", async () => {
  const a = allCalm();
  a.cap_1 = noul(0.88);
  const r1 = await radar.pickMove(emptyBoard(), "yellow", fakeAsk(a));
  expect(r1.column).toBe(1);
  expect(r1.decision).toContain("cap");

  const r2 = await radar.pickMove(emptyBoard(), "yellow", fakeAsk(allCalm()));
  expect(r2.column).toBe(3);
  expect(r2.decision).toContain("positional");
});

test("blocker (rebuilt on radar questions) reacts at two: block > cap > win", async () => {
  const a = allCalm();
  a.cap_1 = noul(0.9);
  a.win_5 = noul(0.9);
  const r1 = await blocker.pickMove(emptyBoard(), "yellow", fakeAsk(a));
  expect(r1.column).toBe(1); // caps the open two even over its own win
  expect(r1.decision).toContain("blocker cap");

  a.block_2 = noul(0.95);
  const r2 = await blocker.pickMove(emptyBoard(), "yellow", fakeAsk(a));
  expect(r2.column).toBe(2); // immediate block still outranks everything
  expect(r2.decision).toContain("blocker block");

  const calm = allCalm();
  calm.win_5 = noul(0.9);
  const r3 = await blocker.pickMove(emptyBoard(), "yellow", fakeAsk(calm));
  expect(r3.column).toBe(5); // with nothing to defend, it does take the win
  expect(r3.decision).toContain("blocker win");

  const log: JevRound[] = [];
  await blocker.pickMove(emptyBoard(), "yellow", fakeAsk(allCalm(), log));
  expect(Object.keys(log[0].questions)).toContain("cap_3"); // it now ASKS about twos
});
