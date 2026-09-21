import { test, expect } from "bun:test";
import { drop, emptyBoard } from "../engine";
import { annotated } from "./annotated";
import type { AskFn, JevRound } from "./types";
import type { ChoiceQuestion, NoulAnswer } from "../../src/jev-client";

function fakeAsk(answers: Record<string, NoulAnswer>, log: JevRound[] = []): AskFn {
  return async (label, state, questions) => {
    const round: JevRound = { label, state, questions, answers, latencyMs: 1 };
    log.push(round);
    return round;
  };
}

const pick = (c: string, p = 0.9): Record<string, NoulAnswer> => ({
  move: { type: "choice", noul: 0, choice: c, probabilities: { [c]: p } },
});

test("annotated: one Choice over legal columns; win/block/blunder verdicts baked in", async () => {
  let b = emptyBoard();
  b = drop(b, 2, "yellow").board;
  b = drop(b, 2, "yellow").board;
  b = drop(b, 2, "yellow").board; // yellow wins by dropping col 2
  b = drop(b, 5, "red").board;
  b = drop(b, 5, "red").board;
  b = drop(b, 5, "red").board;    // red wins by dropping col 5 -> col 5 blocks
  const log: JevRound[] = [];
  const r = await annotated.pickMove(b, "yellow", fakeAsk(pick("col2"), log));

  expect(log.length).toBe(1);
  expect(log[0].label).toBe("annotated-choice");
  const q = log[0].questions.move as ChoiceQuestion;
  expect(Object.keys(q.criteria).sort()).toEqual(
    ["col0", "col1", "col2", "col3", "col4", "col5", "col6"]
  );
  expect(q.criteria.col2).toContain("WINS IMMEDIATELY");
  expect(q.criteria.col5).toContain("block");
  // with red's col-5 threat live, every neutral column hands red the win
  expect(q.criteria.col0).toContain("serious blunder");
  const state = log[0].state as { you: string; stacks: Record<string, string> };
  expect(state.you).toBe("yellow");
  expect(state.stacks.col2).toBe("YYY");
  expect((state as any).candidates).toBeUndefined(); // no lines payload — tiny state
  expect(r.column).toBe(2);
  expect(r.decision).toContain("annotated: col 2");
});

test("annotated: developing-threat facts and quiet moves annotate correctly", async () => {
  let b = emptyBoard();
  b = drop(b, 1, "yellow").board;
  b = drop(b, 2, "yellow").board; // yellow pair 1-2
  b = drop(b, 4, "red").board;
  b = drop(b, 5, "red").board;    // red pair 4-5
  const log: JevRound[] = [];
  await annotated.pickMove(b, "yellow", fakeAsk(pick("col3"), log));
  const q = log[0].questions.move as ChoiceQuestion;
  expect(q.criteria.col0).toContain("three in a line");   // extends yellow pair
  expect(q.criteria.col6).toContain("developing pair");   // caps red pair, touching
  expect(q.criteria.col6).not.toContain("three in a line");
});

test("annotated: quiet description on an empty board", async () => {
  const log: JevRound[] = [];
  await annotated.pickMove(emptyBoard(), "yellow", fakeAsk(pick("col3"), log));
  const q = log[0].questions.move as ChoiceQuestion;
  expect(q.criteria.col0).toContain("quiet");
  expect(q.criteria.col0).toContain("0/6");
});

test("annotated: excludes full columns and throws on unusable answers", async () => {
  let b = emptyBoard();
  for (let i = 0; i < 6; i++) b = drop(b, 0, i % 2 ? "red" : "yellow").board;
  const log: JevRound[] = [];
  await annotated.pickMove(b, "yellow", fakeAsk(pick("col3"), log));
  const q = log[0].questions.move as ChoiceQuestion;
  expect(Object.keys(q.criteria)).not.toContain("col0");

  await expect(
    annotated.pickMove(emptyBoard(), "yellow", fakeAsk({ move: { type: "choice", noul: 0, choice: "none" } as NoulAnswer }))
  ).rejects.toThrow(/no usable column/);
});
