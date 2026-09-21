// connect4/server.ts
// Bun server: static page + two JSON endpoints. Handlers are plain
// functions with injected deps so tests never touch the network or disk.

import { appendFileSync, mkdirSync } from "node:fs";
import {
  COLS, ROWS, drop, groundTruth, legalColumns, status,
  type Board, type Cell, type Player,
} from "./engine";
import { makeAsk } from "./jev";
import { decomposed } from "./strategies/decomposed";
import { naive } from "./strategies/naive";
import { blocker, radar } from "./strategies/radar";
import { spoonfed } from "./strategies/spoonfed";
import { twoPhase } from "./strategies/two-phase";
import type { AskFn, Strategy } from "./strategies/types";

export const STRATEGIES: Record<string, Strategy> = {
  naive,
  decomposed,
  "two-phase": twoPhase,
  spoonfed,
  blocker,
  radar,
};

export interface Deps {
  ask: AskFn;
  appendTranscript: (gameId: string, entry: unknown) => void;
}

type Handled = { status: number; body: unknown };
type Common = { ok: true; gameId: string; board: Board } | { ok: false; handled: Handled };

const GAME_ID = /^[A-Za-z0-9-]{1,64}$/;

function err(status: number, message: string): Handled {
  return { status, body: { error: message } };
}

function parseBoard(raw: unknown): Board | null {
  if (!Array.isArray(raw) || raw.length !== ROWS) return null;
  const board: Board = [];
  for (const row of raw) {
    if (!Array.isArray(row) || row.length !== COLS) return null;
    for (const cell of row) {
      if (cell !== null && cell !== "yellow" && cell !== "red") return null;
    }
    board.push(row as Cell[]);
  }
  return board;
}

function parsePlayer(raw: unknown): Player | null {
  return raw === "yellow" || raw === "red" ? raw : null;
}

function parseCommon(body: unknown): Common {
  if (typeof body !== "object" || body === null) return { ok: false, handled: err(400, "malformed body") };
  const { gameId, board } = body as { gameId?: unknown; board?: unknown };
  if (typeof gameId !== "string" || !GAME_ID.test(gameId)) return { ok: false, handled: err(400, "bad gameId") };
  const parsed = parseBoard(board);
  if (!parsed) return { ok: false, handled: err(400, "bad board: expected 6 rows x 7 cols of yellow|red|null") };
  return { ok: true, gameId, board: parsed };
}

export function dropHandler(body: unknown, deps: Deps): Handled {
  const common = parseCommon(body);
  if (!common.ok) return common.handled;
  const { gameId, board } = common;
  if (status(board).state !== "ongoing") return err(400, "game is already over");
  const { column, player } = body as { column?: unknown; player?: unknown };
  const p = parsePlayer(player);
  if (p === null) return err(400, "bad player");
  if (typeof column !== "number" || !legalColumns(board).includes(column)) {
    return err(400, `column ${String(column)} is not a legal move (full or out of range)`);
  }
  const applied = drop(board, column, p);
  const st = status(applied.board);
  deps.appendTranscript(gameId, {
    kind: "human-move", player: p, column, row: applied.row, status: st,
  });
  return { status: 200, body: { board: applied.board, row: applied.row, status: st } };
}

export async function moveHandler(body: unknown, deps: Deps): Promise<Handled> {
  const common = parseCommon(body);
  if (!common.ok) return common.handled;
  const { gameId, board } = common;
  if (status(board).state !== "ongoing") return err(400, "game is already over");
  const { strategy: stratName, aiPlayer } = body as { strategy?: unknown; aiPlayer?: unknown };
  const me = parsePlayer(aiPlayer);
  if (me === null) return err(400, "bad aiPlayer");
  const strategy = typeof stratName === "string" ? STRATEGIES[stratName] : undefined;
  if (!strategy) return err(400, `unknown strategy: ${String(stratName)}`);
  const legal = legalColumns(board);
  if (legal.length === 0) return err(400, "no legal moves");

  const truth = groundTruth(board, me);

  let result;
  try {
    result = await strategy.pickMove(board, me, deps.ask);
  } catch (e) {
    return err(502, `Jev call failed: ${(e as Error).message}`);
  }
  if (!legal.includes(result.column)) {
    // Spec: no fallback — surface the bug instead of hiding it.
    return err(502, `strategy returned illegal column ${result.column}`);
  }

  const applied = drop(board, result.column, me);
  const st = status(applied.board);
  const entry = {
    kind: "ai-move", strategy: strategy.name, player: me,
    column: result.column, row: applied.row, decision: result.decision,
    rounds: result.rounds, groundTruth: truth, status: st,
  };
  deps.appendTranscript(gameId, entry);
  return {
    status: 200,
    body: {
      column: result.column, row: applied.row, board: applied.board, status: st,
      rounds: result.rounds, decision: result.decision, groundTruth: truth,
    },
  };
}

// ---------- wiring (not under test) ----------

const TRANSCRIPT_DIR = new URL("./transcripts/", import.meta.url).pathname;

function appendTranscript(gameId: string, entry: unknown): void {
  try {
    mkdirSync(TRANSCRIPT_DIR, { recursive: true });
    appendFileSync(
      `${TRANSCRIPT_DIR}${gameId}.jsonl`,
      JSON.stringify({ ts: new Date().toISOString(), ...(entry as object) }) + "\n"
    );
  } catch (e) {
    console.error(`transcript write failed for ${gameId}: ${(e as Error).message}`);
  }
}

if (import.meta.main) {
  if (!process.env.TYPESAFE_API_KEY) {
    console.error("TYPESAFE_API_KEY is not set — put it in jav/.env");
    process.exit(1);
  }
  const deps: Deps = { ask: makeAsk(), appendTranscript };
  const indexPath = new URL("./public/index.html", import.meta.url).pathname;

  Bun.serve({
    port: 3444,
    // Must outlive jev-client's 30s timeout × 2 attempts so a slow Jev turn
    // returns a real 502 instead of a dropped socket.
    idleTimeout: 150,
    async fetch(req) {
      const url = new URL(req.url);
      const json = (h: Handled) =>
        new Response(JSON.stringify(h.body), {
          status: h.status,
          headers: { "Content-Type": "application/json" },
        });
      if (req.method === "GET" && url.pathname === "/") {
        return new Response(Bun.file(indexPath));
      }
      if (req.method === "POST" && url.pathname === "/api/drop") {
        return json(dropHandler(await req.json().catch(() => null), deps));
      }
      if (req.method === "POST" && url.pathname === "/api/move") {
        return json(await moveHandler(await req.json().catch(() => null), deps));
      }
      return new Response("not found", { status: 404 });
    },
  });
  console.log("Connect Four vs Jev → http://localhost:3444");
}
