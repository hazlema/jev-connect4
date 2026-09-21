import { test, expect } from "bun:test";
import { emptyBoard, drop, legalColumns } from "../engine";
import { decomposed } from "./decomposed";
import type { AskFn, JevRound } from "./types";
import type { NoulAnswer, NoulQuestion } from "../../src/jev-client";

function fakeAsk(answers: Record<string, NoulAnswer>, log: JevRound[] = []): AskFn {
  return async (label, state, questions) => {
    const round: JevRound = { label, state, questions, answers, latencyMs: 1 };
    log.push(round);
    return round;
  };
}

const noul = (p: number): NoulAnswer => ({ type: "noul", noul: p });

test("decomposed asks win/block/hand per legal column plus pos, in ONE round", async () => {
  const b = emptyBoard();
  const log: JevRound[] = [];
  const answers: Record<string, NoulAnswer> = {
    pos: { type: "choice", noul: 0, choice: "col3", probabilities: { col3: 0.5 } },
  };
  for (const c of legalColumns(b)) {
    answers[`win_${c}`] = noul(0.05);
    answers[`block_${c}`] = noul(0.05);
    answers[`hand_${c}`] = noul(0.05);
  }
  const result = await decomposed.pickMove(b, "yellow", fakeAsk(answers, log));

  expect(log.length).toBe(1); // batched: one request total
  const ids = Object.keys(log[0].questions);
  for (const c of [0, 1, 2, 3, 4, 5, 6]) {
    expect(ids).toContain(`win_${c}`);
    expect(ids).toContain(`block_${c}`);
    expect(ids).toContain(`hand_${c}`);
  }
  expect(ids).toContain("pos");
  // rules spelled out: state carries them AND each noul restates the win shape
  expect((log[0].state as { rules: string }).rules).toContain("Connect Four");
  const w0 = log[0].questions.win_0 as NoulQuestion;
  expect(w0.instructions).toContain("4");
  expect(w0.criteria?.true).toBeTruthy();
  expect(result.column).toBe(3); // no tactics fired -> positional
  expect(result.decision).toContain("positional");
});

test("decomposed plays the win over everything", async () => {
  const b = emptyBoard();
  const answers: Record<string, NoulAnswer> = {
    pos: { type: "choice", noul: 0, choice: "col3", probabilities: { col3: 0.9 } },
  };
  for (const c of legalColumns(b)) {
    answers[`win_${c}`] = noul(c === 5 ? 0.92 : 0.03);
    answers[`block_${c}`] = noul(c === 2 ? 0.95 : 0.03);
    answers[`hand_${c}`] = noul(0.03);
  }
  const result = await decomposed.pickMove(b, "yellow", fakeAsk(answers));
  expect(result.column).toBe(5);
  expect(result.decision).toContain("win");
});

test("decomposed blocks when no win exists", async () => {
  const b = emptyBoard();
  const answers: Record<string, NoulAnswer> = {
    pos: { type: "choice", noul: 0, choice: "col3", probabilities: { col3: 0.9 } },
  };
  for (const c of legalColumns(b)) {
    answers[`win_${c}`] = noul(0.05);
    answers[`block_${c}`] = noul(c === 6 ? 0.88 : 0.05);
    answers[`hand_${c}`] = noul(0.05);
  }
  const result = await decomposed.pickMove(b, "red", fakeAsk(answers));
  expect(result.column).toBe(6);
  expect(result.decision).toContain("block");
});

test("decomposed only asks about legal columns", async () => {
  let b = emptyBoard();
  for (let i = 0; i < 6; i++) b = drop(b, 3, i % 2 ? "red" : "yellow").board; // col 3 full
  const log: JevRound[] = [];
  const answers: Record<string, NoulAnswer> = {
    pos: { type: "choice", noul: 0, choice: "col2", probabilities: { col2: 1 } },
  };
  for (const c of legalColumns(b)) {
    answers[`win_${c}`] = noul(0.05);
    answers[`block_${c}`] = noul(0.05);
    answers[`hand_${c}`] = noul(0.05);
  }
  await decomposed.pickMove(b, "yellow", fakeAsk(answers, log));
  expect(Object.keys(log[0].questions)).not.toContain("win_3");
  expect(Object.keys(log[0].questions)).not.toContain("block_3");
  expect(Object.keys(log[0].questions)).not.toContain("hand_3");
});
