// frosty's threat model: see the open two before it becomes an open three.
// Spoonfed's state and questions plus per-column developing-threat Nouls;
// the if-chain lives in code: win > block > extend own open two (open3) >
// cap theirs > avoid hands-win > positional.

import type { NoulQuestion, Question } from "../../src/jev-client";
import {
  landingRow, legalColumns, opponent, ROWS,
  type Board, type Player,
} from "../engine";
import { positionalQuestion } from "./decomposed";
import { candidate, MOVE_MARK, tacticQuestions } from "./spoonfed";
import {
  boardState, BLOCK_THRESHOLD, colKey, HANDS_THRESHOLD, pickFromChoice,
  RULES, WIN_THRESHOLD,
  type Strategy,
} from "./types";

export const OPEN3_THRESHOLD = 0.7;
export const CAP_THRESHOLD = 0.7;

function radarQuestions(me: Player, c: number): Record<string, NoulQuestion> {
  const opp = opponent(me);
  const path = `\`candidates.${colKey(c)}.lines_through_landing_cell\``;
  const preamble =
    `Connect Four. Each entry in ${path} is one straight line of 4 adjacent ` +
    `cells (in board order) through the cell where a piece dropped into ` +
    `column ${c} lands; "${MOVE_MARK}" marks that landing cell.`;
  return {
    [`open3_${c}`]: {
      type: "noul",
      instructions:
        `${preamble} If the "${MOVE_MARK}" cell becomes a ${me} piece, does at ` +
        `least one listed line then hold exactly THREE ${me} pieces plus one ` +
        `"empty" cell — a developing line one move away from four?`,
      criteria: {
        true: `Some listed line consists of "${MOVE_MARK}" plus exactly 2 cells reading "${me}" and exactly 1 cell reading "empty".`,
        false: `No listed line becomes three ${me} pieces with a single empty remainder.`,
      },
    },
    [`cap_${c}`]: {
      type: "noul",
      instructions:
        `${preamble} Does at least one listed line read, in order, ` +
        `"${MOVE_MARK}" DIRECTLY NEXT TO two adjacent ${opp} pieces, with the ` +
        `remaining cell "empty"? The "${MOVE_MARK}" cell must touch the ${opp} ` +
        `pair with NO gap — the orders that count are ` +
        `["${MOVE_MARK}", ${opp}, ${opp}, empty] or [empty, ${opp}, ${opp}, "${MOVE_MARK}"]. ` +
        `A line like ["${MOVE_MARK}", empty, ${opp}, ${opp}] does NOT count: the ` +
        `gap leaves the ${opp} pair free to extend. (A touching cap kills the ` +
        `developing ${opp} line before it becomes an open three.)`,
      criteria: {
        true: `Some listed line is exactly ["${MOVE_MARK}", ${opp}, ${opp}, "empty"] or ["empty", ${opp}, ${opp}, "${MOVE_MARK}"] — the mark touches the pair.`,
        false: `No such line; lines where an "empty" cell separates "${MOVE_MARK}" from the ${opp} pair do not count.`,
      },
    },
  };
}

type Rung = "win" | "block" | "open3" | "cap";
const RUNG_DEFS: Record<Rung, { prefix: string; threshold: number }> = {
  win: { prefix: "win_", threshold: WIN_THRESHOLD },
  block: { prefix: "block_", threshold: BLOCK_THRESHOLD },
  open3: { prefix: "open3_", threshold: OPEN3_THRESHOLD },
  cap: { prefix: "cap_", threshold: CAP_THRESHOLD },
};

// Both threat-aware strategies ask the same batch (spoonfed's questions +
// open3/cap); only the code-side rung order differs.
function makeThreatStrategy(name: string, rungs: Rung[]): Strategy {
  return {
    name,
    async pickMove(board: Board, me: Player, ask) {
      const legal = legalColumns(board);
      const candidates: Record<string, unknown> = {};
      const questions: Record<string, Question> = { pos: positionalQuestion(me, legal) };
      for (const c of legal) {
        candidates[colKey(c)] = candidate(board, me, c);
        const hasAbove = landingRow(board, c) + 1 < ROWS;
        Object.assign(questions, tacticQuestions(me, c, hasAbove), radarQuestions(me, c));
      }

      const round = await ask(
        "move-eval-spoonfed",
        { rules: RULES, ...boardState(board), candidates },
        questions
      );

      const noulAt = (id: string) => round.answers[id]?.noul ?? 0;
      const best = (prefix: string) =>
        legal.map((c) => ({ c, p: noulAt(`${prefix}${c}`) })).sort((a, b) => b.p - a.p)[0];

      for (const kind of rungs) {
        const { prefix, threshold } = RUNG_DEFS[kind];
        const top = best(prefix);
        if (top.p >= threshold) {
          return {
            column: top.c,
            rounds: [round],
            decision: `${name} ${kind}: col ${top.c} @ ${top.p.toFixed(2)}`,
          };
        }
      }

      const safe = legal.filter((c) => noulAt(`hand_${c}`) < HANDS_THRESHOLD);
      const pool = safe.length > 0 ? safe : legal;
      const pos = pickFromChoice(round.answers.pos, pool);
      const avoided = legal.length - pool.length;
      const note = avoided > 0 ? ` (avoided ${avoided} losing col(s))` : "";
      return {
        column: pos.column,
        rounds: [round],
        decision: `${name} positional: col ${pos.column} @ ${pos.p.toFixed(2)}${note}`,
      };
    },
  };
}

// React at two: cap their developing pair before extending our own.
// (Original open3-before-cap ordering lost to a human building an open
// three — cap was unreachable because some extendable pair always exists.)
export const radar = makeThreatStrategy("radar", ["win", "block", "cap", "open3"]);
// Pure defender, now with two-in-a-row reflexes; still takes an
// unconditional win when nothing needs defending.
export const blocker = makeThreatStrategy("blocker", ["block", "cap", "win"]);
