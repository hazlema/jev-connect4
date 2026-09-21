import { test, expect } from "bun:test";
import { emptyBoard } from "../engine";
import { twoPhase } from "./two-phase";
import type { AskFn, JevRound } from "./types";
import type { ChoiceQuestion, NoulAnswer } from "../../src/jev-client";

// Sequenced fake: answers[0] for the first call, answers[1] for the second.
function seqAsk(perCall: Record<string, NoulAnswer>[], log: JevRound[] = []): AskFn {
  let i = 0;
  return async (label, state, questions) => {
    const round: JevRound = { label, state, questions, answers: perCall[i++], latencyMs: 1 };
    log.push(round);
    return round;
  };
}

const choice = (c: string, p: number): NoulAnswer => ({
  type: "choice", noul: 0, choice: c, probabilities: { [c]: p },
});

test("phase 1 scans both players' threats; own win beats opponent block", async () => {
  const log: JevRound[] = [];
  const ask = seqAsk([{ my_threat: choice("col4", 0.9), opp_threat: choice("col1", 0.8) }], log);
  const result = await twoPhase.pickMove(emptyBoard(), "yellow", ask);

  expect(log.length).toBe(1); // no phase 2 needed
  expect(log[0].label).toBe("threat-scan");
  const q = log[0].questions.my_threat as ChoiceQuestion;
  expect(Object.keys(q.criteria)).toContain("none");
  expect(q.instructions).toContain("yellow");
  const oq = log[0].questions.opp_threat as ChoiceQuestion;
  expect(oq.instructions).toContain("red");
  expect(result.column).toBe(4);
  expect(result.decision).toContain("win");
});

test("blocks opponent threat when own scan says none", async () => {
  const ask = seqAsk([{ my_threat: choice("none", 0.9), opp_threat: choice("col1", 0.8) }]);
  const result = await twoPhase.pickMove(emptyBoard(), "yellow", ask);
  expect(result.column).toBe(1);
  expect(result.decision).toContain("block");
});

test("falls through to positional phase when no threats detected", async () => {
  const log: JevRound[] = [];
  const ask = seqAsk(
    [
      { my_threat: choice("none", 0.95), opp_threat: choice("none", 0.9) },
      { pos: choice("col3", 0.7) },
    ],
    log
  );
  const result = await twoPhase.pickMove(emptyBoard(), "yellow", ask);
  expect(log.length).toBe(2);
  expect(log[1].label).toBe("position");
  expect(result.column).toBe(3);
  expect(result.decision).toContain("positional");
});

test("low-confidence threat is ignored (below THREAT_THRESHOLD)", async () => {
  const ask = seqAsk([
    { my_threat: choice("col4", 0.3), opp_threat: choice("none", 0.9) },
    { pos: choice("col2", 0.6) },
  ]);
  const result = await twoPhase.pickMove(emptyBoard(), "yellow", ask);
  expect(result.column).toBe(2); // 0.3 < 0.5 -> not trusted, went positional
});
