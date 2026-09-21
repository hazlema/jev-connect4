import { test, expect } from "bun:test";
import { emptyBoard, drop } from "../engine";
import { naive } from "./naive";
import type { AskFn, JevRound } from "./types";
import type { ChoiceQuestion, NoulAnswer } from "../../src/jev-client";

function fakeAsk(answers: Record<string, NoulAnswer>, log: JevRound[] = []): AskFn {
  return async (label, state, questions) => {
    const round: JevRound = { label, state, questions, answers, latencyMs: 1 };
    log.push(round);
    return round;
  };
}

test("naive asks one Choice over only the legal columns, rules in state", async () => {
  let b = emptyBoard();
  for (let i = 0; i < 6; i++) b = drop(b, 0, i % 2 ? "red" : "yellow").board; // col 0 full
  const log: JevRound[] = [];
  const ask = fakeAsk(
    { move: { type: "choice", noul: 0, choice: "col3", probabilities: { col3: 1 } } },
    log
  );
  const result = await naive.pickMove(b, "red", ask);

  expect(log.length).toBe(1);
  const q = log[0].questions.move as ChoiceQuestion;
  expect(q.type).toBe("choice");
  expect(Object.keys(q.criteria)).not.toContain("col0"); // full column excluded
  expect(Object.keys(q.criteria)).toContain("col1");
  expect(q.instructions).toContain("red");
  expect((log[0].state as { rules: string }).rules).toContain("Connect Four");
  expect(result.column).toBe(3);
  expect(result.rounds.length).toBe(1);
  expect(result.decision).toContain("col 3");
});

test("naive falls back to probabilities when choice is illegal", async () => {
  const ask = fakeAsk({
    move: {
      type: "choice", noul: 0, choice: "col0",
      probabilities: { col0: 0.5, col4: 0.3, col5: 0.2 },
    },
  });
  let b = emptyBoard();
  for (let i = 0; i < 6; i++) b = drop(b, 0, i % 2 ? "red" : "yellow").board;
  const result = await naive.pickMove(b, "yellow", ask);
  expect(result.column).toBe(4);
});
