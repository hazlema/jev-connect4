// Shared strategy contract, rules text, board serialization, and the
// tactical combination policy used by decomposed-style strategies.

import type { NoulAnswer, Question } from "../../src/jev-client";
import { COLS, ROWS, type Board, type Player } from "../engine";

export interface JevRound {
  label: string;
  state: unknown;
  questions: Record<string, Question>;
  answers: Record<string, NoulAnswer>;
  latencyMs: number;
}

export type AskFn = (
  label: string,
  state: unknown,
  questions: Record<string, Question>
) => Promise<JevRound>;

export interface StrategyResult {
  column: number;
  rounds: JevRound[];
  decision: string;
}

export interface Strategy {
  name: string;
  pickMove(board: Board, me: Player, ask: AskFn): Promise<StrategyResult>;
}

// Assume Jev has never heard of Connect Four: full rules ride in state as
// `rules`; each question also restates the win condition it depends on.
export const RULES =
  "Connect Four is played on a vertical grid 7 columns wide and 6 rows tall. " +
  "Two players, yellow and red, alternate turns. On a turn a player drops one " +
  "piece of their color into a column; the piece falls to the lowest empty cell " +
  "of that column, resting on top of any pieces already there. A column holding " +
  "6 pieces is full and cannot be played. The first player to have 4 of their " +
  "own pieces in an adjacent straight line — horizontal, vertical, or diagonal — " +
  "wins immediately. Columns are numbered 0 (leftmost) to 6 (rightmost).";

export const WIN_CONDITION =
  "4 adjacent pieces of one color in a straight line (horizontal, vertical, or diagonal) wins immediately";

export function boardState(board: Board) {
  const rows: string[] = [];
  for (let r = ROWS - 1; r >= 0; r--) {
    rows.push(
      board[r].map((c) => (c === "yellow" ? "Y" : c === "red" ? "R" : ".")).join(" ")
    );
  }
  const columns: Record<string, string[]> = {};
  for (let c = 0; c < COLS; c++) {
    const stack: string[] = [];
    for (let r = 0; r < ROWS; r++) {
      const cell = board[r][c];
      if (cell) stack.push(cell);
    }
    columns[colKey(c)] = stack;
  }
  return {
    grid_rows_top_to_bottom: rows,
    grid_legend:
      "Y = yellow piece, R = red piece, . = empty cell. Columns are numbered 0 " +
      "(left) to 6 (right). The last row listed is the bottom of the grid; " +
      "pieces rest at the bottom. columns_bottom_to_top lists each column's " +
      "pieces from bottom to top.",
    columns_bottom_to_top: columns,
  };
}

export function colKey(c: number): string {
  return `col${c}`;
}

export function parseCol(key: string): number | null {
  const m = /^col([0-6])$/.exec(key);
  return m ? Number(m[1]) : null;
}

// Resolve a Choice answer over colN options to a legal column.
export function pickFromChoice(
  ans: NoulAnswer | undefined,
  legal: number[]
): { column: number; p: number } {
  if (ans) {
    const direct = parseCol(ans.choice ?? "");
    if (direct !== null && legal.includes(direct)) {
      return { column: direct, p: ans.probabilities?.[colKey(direct)] ?? ans.confidence ?? 0 };
    }
    const ranked = Object.entries(ans.probabilities ?? {})
      .map(([k, p]) => ({ c: parseCol(k), p }))
      .filter((e): e is { c: number; p: number } => e.c !== null && legal.includes(e.c))
      .sort((a, b) => b.p - a.p);
    if (ranked.length > 0) return { column: ranked[0].c, p: ranked[0].p };
  }
  throw new Error("pickFromChoice: no usable column in answer");
}

// Starting thresholds — tune against inspector evidence, not in the dark.
export const WIN_THRESHOLD = 0.7;
export const BLOCK_THRESHOLD = 0.7;
export const HANDS_THRESHOLD = 0.5;

export type TacticPriority = "win-first" | "block-first";

// Priority: win > block (or flipped for "block-first" — a deliberately
// defensive policy that declines wins) > avoid handing a win > positional.
export function combineTactics(
  legal: number[],
  noulAt: (id: string) => number,
  posAnswer: NoulAnswer | undefined,
  priority: TacticPriority = "win-first"
): { column: number; decision: string } {
  if (legal.length === 0) throw new Error("combineTactics: no legal moves");

  const best = (prefix: string) =>
    legal
      .map((c) => ({ c, p: noulAt(`${prefix}${c}`) }))
      .sort((a, b) => b.p - a.p)[0];

  const tactic = (kind: "win" | "block") => {
    const threshold = kind === "win" ? WIN_THRESHOLD : BLOCK_THRESHOLD;
    const top = best(`${kind}_`);
    return top.p >= threshold
      ? { column: top.c, decision: `${kind}: col ${top.c} @ ${top.p.toFixed(2)}` }
      : null;
  };

  const order: Array<"win" | "block"> =
    priority === "win-first" ? ["win", "block"] : ["block", "win"];
  for (const kind of order) {
    const hit = tactic(kind);
    if (hit) return hit;
  }

  const safe = legal.filter((c) => noulAt(`hand_${c}`) < HANDS_THRESHOLD);
  const pool = safe.length > 0 ? safe : legal;
  const pos = pickFromChoice(posAnswer, pool);
  const avoided = legal.length - pool.length;
  const note = avoided > 0 ? ` (avoided ${avoided} losing col(s))` : "";
  return {
    column: pos.column,
    decision: `positional: col ${pos.column} @ ${pos.p.toFixed(2)}${note}`,
  };
}
