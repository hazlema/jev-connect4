// connect4/server.test.ts
import { test, expect } from "bun:test";
import { emptyBoard, drop } from "./engine";
import { dropHandler, moveHandler, STRATEGIES, type Deps } from "./server";
import type { JevRound } from "./strategies/types";
import type { NoulAnswer } from "../src/jev-client";

function deps(answers: Record<string, NoulAnswer>, transcript: unknown[] = []): Deps {
  return {
    ask: async (label, state, questions) =>
      ({ label, state, questions, answers, latencyMs: 1 }) as JevRound,
    appendTranscript: (_gameId, entry) => transcript.push(entry),
  };
}

test("registry exposes all six strategies", () => {
  expect(Object.keys(STRATEGIES).sort()).toEqual(
    ["blocker", "decomposed", "naive", "radar", "spoonfed", "two-phase"]
  );
});

test("dropHandler applies a human move and reports status", () => {
  const transcript: unknown[] = [];
  const r = dropHandler(
    { gameId: "g1", board: emptyBoard(), column: 3, player: "yellow" },
    deps({}, transcript)
  );
  expect(r.status).toBe(200);
  const body = r.body as { board: unknown[][]; row: number; status: { state: string } };
  expect(body.row).toBe(0);
  expect((body.board as ("yellow" | "red" | null)[][])[0][3]).toBe("yellow");
  expect(body.status.state).toBe("ongoing");
  expect(transcript.length).toBe(1);
});

test("dropHandler rejects a full column with 400", () => {
  let b = emptyBoard();
  for (let i = 0; i < 6; i++) b = drop(b, 0, i % 2 ? "red" : "yellow").board;
  const r = dropHandler({ gameId: "g1", board: b, column: 0, player: "red" }, deps({}));
  expect(r.status).toBe(400);
  expect((r.body as { error: string }).error).toMatch(/full/);
});

test("dropHandler rejects malformed bodies and bad gameIds", () => {
  expect(dropHandler(null, deps({})).status).toBe(400);
  expect(dropHandler({ gameId: "../evil", board: emptyBoard(), column: 0, player: "yellow" }, deps({})).status).toBe(400);
  expect(dropHandler({ gameId: "g", board: [[null]], column: 0, player: "yellow" }, deps({})).status).toBe(400);
  expect(dropHandler({ gameId: "g", board: emptyBoard(), column: 0, player: "green" }, deps({})).status).toBe(400);
});

test("moveHandler runs the strategy and returns rounds + ground truth", async () => {
  const transcript: unknown[] = [];
  const d = deps(
    { move: { type: "choice", noul: 0, choice: "col3", probabilities: { col3: 0.9 } } },
    transcript
  );
  const r = await moveHandler(
    { gameId: "g1", board: emptyBoard(), strategy: "naive", aiPlayer: "red" },
    d
  );
  expect(r.status).toBe(200);
  const body = r.body as {
    column: number; row: number; status: { state: string };
    rounds: JevRound[]; decision: string;
    groundTruth: Array<{ column: number; winsNow: boolean }>;
  };
  expect(body.column).toBe(3);
  expect(body.row).toBe(0);
  expect(body.rounds.length).toBe(1);
  expect(body.decision).toContain("naive");
  expect(body.groundTruth.length).toBe(7);
  expect(transcript.length).toBe(1);
});

test("moveHandler: unknown strategy is 400", async () => {
  const r = await moveHandler(
    { gameId: "g1", board: emptyBoard(), strategy: "minimax", aiPlayer: "red" },
    deps({})
  );
  expect(r.status).toBe(400);
});

test("handlers reject a finished game with 400", async () => {
  let b = emptyBoard();
  b = drop(b, 0, "yellow").board; b = drop(b, 1, "red").board;
  b = drop(b, 0, "yellow").board; b = drop(b, 1, "red").board;
  b = drop(b, 0, "yellow").board; b = drop(b, 1, "red").board;
  b = drop(b, 0, "yellow").board; // yellow vertical four in col 0
  const r = dropHandler({ gameId: "g1", board: b, column: 2, player: "red" }, deps({}));
  expect(r.status).toBe(400);
  const m = await moveHandler({ gameId: "g1", board: b, strategy: "naive", aiPlayer: "red" }, deps({}));
  expect(m.status).toBe(400);
});

test("moveHandler: Jev failure returns 502 and NO move (no fallback)", async () => {
  const d: Deps = {
    ask: async () => { throw new Error("HTTP 500: boom"); },
    appendTranscript: () => {},
  };
  const r = await moveHandler(
    { gameId: "g1", board: emptyBoard(), strategy: "naive", aiPlayer: "red" },
    d
  );
  expect(r.status).toBe(502);
  expect((r.body as { error: string }).error).toContain("boom");
  expect((r.body as { column?: number }).column).toBeUndefined();
});
